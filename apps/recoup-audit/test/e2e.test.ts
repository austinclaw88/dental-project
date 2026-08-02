import { describe, expect, it } from "vitest";
import { runDemoPipeline } from "../src/demo.js";
import { generateDataset } from "../src/synthetic.js";
import { findingsToCsv, findingsToJson } from "../src/output.js";
import { FINDING_TYPES } from "../src/types.js";

/** One expensive run shared by the suite. */
const run = runDemoPipeline();

describe("end to end — synthetic dataset with a known answer key", () => {
  it("audits a full year of claims", () => {
    expect(run.dataset.lineCount).toBeGreaterThanOrEqual(1500);
    expect(run.result.totals.linesAudited).toBe(run.dataset.lineCount);
    expect(run.dataset.payerNames).toHaveLength(5);
    expect(run.result.window.minDate).toBe("2025-07-01");
    expect(run.result.window.maxDate).toBe("2026-06-30");
  });

  it("recovers at least 90% of the seeded dollars", () => {
    expect(run.reconciliation.seededCents).toBeGreaterThan(0);
    expect(run.reconciliation.recall).toBeGreaterThanOrEqual(0.9);
  });

  it("keeps false positives to no more than 5% of flagged dollars", () => {
    expect(run.reconciliation.flaggedCents).toBeGreaterThan(0);
    expect(run.reconciliation.falsePositiveRate).toBeLessThanOrEqual(0.05);
  });

  it("exercises every detector", () => {
    const seen = new Set(run.result.findings.map((f) => f.type));
    for (const type of FINDING_TYPES) {
      expect(seen, `detector ${type} produced no findings`).toContain(type);
    }
  });

  it("leaves the legitimate adjudication alone", () => {
    // The dataset is full of deductibles, coinsurance, secondary claims, annual
    // maximums and non-covered services. None of them may be the reason a line
    // is flagged, so every flagged line must trace to a seeded leak or to the one
    // deliberately ambiguous case (the second contracted schedule).
    const l = run.dataset.legitimateCounts;
    expect(l.ordinary_coinsurance).toBeGreaterThan(200);
    expect(l.deductible_applied).toBeGreaterThan(20);
    expect(l.secondary_claim).toBeGreaterThan(20);
    expect(l.annual_max_met).toBeGreaterThan(2);
    expect(l.non_covered_billed_to_patient).toBeGreaterThan(10);
    expect(run.reconciliation.falsePositiveLines).toBeLessThanOrEqual(
      l.second_contracted_schedule!,
    );
  });

  it("is deterministic — same seed, same dollars, same findings", () => {
    const again = runDemoPipeline();
    expect(again.result.totals.candidateTotal).toBe(run.result.totals.candidateTotal);
    expect(again.reconciliation.recall).toBe(run.reconciliation.recall);
    expect(findingsToCsv(again.result.findings)).toBe(findingsToCsv(run.result.findings));
    expect(generateDataset().csv).toBe(run.dataset.csv);
  });

  it("never leaks a raw subscriber id into any output", () => {
    const outputs = findingsToCsv(run.result.findings) + findingsToJson(run.result) + run.html;
    expect(outputs).not.toMatch(/SUB-\d+/);
    expect(run.result.findings.every((f) => /^[0-9a-f]{10}$/.test(f.patientHash ?? ""))).toBe(true);
  });

  it("keeps every finding's arithmetic internally consistent", () => {
    for (const f of run.result.findings) {
      expect(f.delta).toBe(f.expected - f.actual);
      expect(f.delta).toBeGreaterThan(0);
      expect(Number.isInteger(f.delta)).toBe(true);
      expect(f.evidence.rows.length).toBeGreaterThan(0);
      expect(f.why.length).toBeGreaterThan(40);
    }
    const summed = run.result.findings.reduce((t, f) => t + f.delta, 0);
    expect(summed).toBe(run.result.totals.candidateTotal);
  });

  it("reports honest coverage rather than judging what it cannot price", () => {
    expect(run.result.coverage.pairsReconstructed).toBeGreaterThan(50);
    expect(run.result.coverage.pairsFromContract).toBe(0);
    expect(run.result.unschedulable.length).toBeGreaterThan(0);
    const unpriced = new Set(run.result.unschedulable.map((u) => `${u.payerKey}|${u.cdtCode}`));
    for (const f of run.result.findings) {
      if (f.type === "zero_paid_no_reason" || f.evidence.rateBasis === "cross_payer_median") continue;
      expect(unpriced.has(`${f.payerKey}|${f.cdtCode}`)).toBe(false);
    }
  });
});

describe("end to end — findings exports", () => {
  it("writes one CSV row per finding with evidence references", () => {
    const csv = findingsToCsv(run.result.findings);
    const rows = csv.trimEnd().split("\n");
    expect(rows).toHaveLength(run.result.findings.length + 1);
    expect(rows[0]).toContain("evidence_rows");
    expect(rows[0]).toContain("rate_statement");
    expect(rows[0]).toContain("confidence");
  });

  it("writes JSON carrying totals, coverage and unschedulable pairs", () => {
    const parsed = JSON.parse(findingsToJson(run.result));
    expect(parsed.tool).toBe("@nightshift/recoup-audit");
    expect(parsed.findings).toHaveLength(run.result.findings.length);
    expect(parsed.totals.candidateUnderpayment).toBeCloseTo(run.result.totals.candidateTotal / 100, 2);
    expect(parsed.coverage.pairsTotal).toBeGreaterThan(0);
    expect(Array.isArray(parsed.unschedulable)).toBe(true);
    expect(parsed.tolerance.rule).toMatch(/max/);
  });
});
