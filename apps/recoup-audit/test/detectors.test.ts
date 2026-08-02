import { beforeEach, describe, expect, it } from "vitest";
import { runAudit } from "../src/engine.js";
import { parseFeeSchedule } from "../src/schedule.js";
import { baseline, line, resetRows } from "./helpers.js";

beforeEach(resetRows);

const d = (cents: number) => cents / 100;

describe("below_schedule", () => {
  it("finds the shortfall and quantifies it exactly", () => {
    const lines = [
      ...baseline("D1110", 92, 8, "Delta Dental", 125),
      line({ cdt: "D1110", payer: "Delta Dental", billed: 125, allowed: 78, paid: 78 }),
    ];
    const result = runAudit(lines);
    expect(result.findings).toHaveLength(1);
    const f = result.findings[0]!;
    expect(f.type).toBe("below_schedule");
    expect(d(f.expected)).toBe(92);
    expect(d(f.actual)).toBe(78);
    expect(d(f.delta)).toBe(14);
    expect(f.confidence).toBe("medium");
    expect(f.evidence.rows).toEqual([9]);
    expect(f.evidence.rateStatement).toMatch(/most common amount/);
  });

  it("stays silent inside the tolerance band and speaks just outside it", () => {
    const inside = runAudit([
      ...baseline("D1110", 92, 8),
      line({ cdt: "D1110", billed: 125, allowed: 91.5, paid: 91.5 }),
    ]);
    expect(inside.findings).toHaveLength(0);

    const outside = runAudit([
      ...baseline("D1110", 92, 8),
      line({ cdt: "D1110", billed: 125, allowed: 90.5, paid: 90.5 }),
    ]);
    expect(outside.findings).toHaveLength(1);
    expect(d(outside.findings[0]!.delta)).toBe(1.5);
  });

  it("uses percentage tolerance on large amounts", () => {
    // 1% of $1,000 is $10, so a $6 gap is noise and a $14 gap is not.
    const near = runAudit([
      ...baseline("D2740", 1000, 8, "Delta Dental", 1450),
      line({ cdt: "D2740", payer: "Delta Dental", billed: 1450, allowed: 994, paid: 497 }),
    ]);
    expect(near.findings).toHaveLength(0);

    const far = runAudit([
      ...baseline("D2740", 1000, 8, "Delta Dental", 1450),
      line({ cdt: "D2740", payer: "Delta Dental", billed: 1450, allowed: 986, paid: 493 }),
    ]);
    expect(far.findings).toHaveLength(1);
  });

  it("honours a custom tolerance", () => {
    const lines = [
      ...baseline("D1110", 92, 8),
      line({ cdt: "D1110", billed: 125, allowed: 87, paid: 87 }),
    ];
    expect(runAudit(lines).findings).toHaveLength(1);
    expect(runAudit(lines, { tolerance: { absCents: 1000, pct: 0.01 } }).findings).toHaveLength(0);
  });
});

describe("downgrade_suspect", () => {
  const composites = () => [
    ...baseline("D2391", 180, 8, "Cigna DPPO", 245),
    ...baseline("D2140", 130, 8, "Cigna DPPO", 195),
  ];

  it("recognises a composite paid at the payer's own amalgam rate", () => {
    const lines = [
      ...composites(),
      line({ cdt: "D2391", payer: "Cigna DPPO", billed: 245, allowed: 130, paid: 104, tooth: "30" }),
    ];
    const result = runAudit(lines);
    expect(result.findings).toHaveLength(1);
    const f = result.findings[0]!;
    expect(f.type).toBe("downgrade_suspect");
    expect(d(f.expected)).toBe(180);
    expect(d(f.actual)).toBe(130);
    expect(d(f.delta)).toBe(50);
    expect(f.confidence).toBe("medium");
    expect(f.evidence.relatedCodes).toEqual(["D2140"]);
    expect(f.why).toMatch(/alternate-benefit downgrade/i);
    expect(f.why).toMatch(/contract/i);
  });

  it("claims the line so the shortfall is never counted twice", () => {
    const result = runAudit([
      ...composites(),
      line({ cdt: "D2391", payer: "Cigna DPPO", billed: 245, allowed: 130, paid: 104 }),
    ]);
    expect(result.findings.map((f) => f.type)).toEqual(["downgrade_suspect"]);
    expect(d(result.totals.candidateTotal)).toBe(50);
  });

  it("falls back to a plain shortfall when the partner code has no established rate", () => {
    const result = runAudit([
      ...baseline("D2391", 180, 8, "Cigna DPPO", 245),
      line({ cdt: "D2391", payer: "Cigna DPPO", billed: 245, allowed: 130, paid: 104 }),
    ]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.type).toBe("below_schedule");
    expect(d(result.findings[0]!.delta)).toBe(50);
  });

  it("does not call it a downgrade when the amount matches nothing", () => {
    const result = runAudit([
      ...composites(),
      line({ cdt: "D2391", payer: "Cigna DPPO", billed: 245, allowed: 155, paid: 124 }),
    ]);
    expect(result.findings[0]!.type).toBe("below_schedule");
  });
});

describe("bundled_to_zero", () => {
  const crownWorld = (payer = "Aetna PPO") => [
    ...baseline("D2950", 280, 6, payer, 385),
    ...baseline("D2740", 950, 6, payer, 1450),
  ];

  it("flags a build-up zeroed on the same tooth and date as a paid crown", () => {
    const result = runAudit([
      ...crownWorld(),
      line({ cdt: "D2740", payer: "Aetna PPO", claim: "CLM-X", billed: 1450, allowed: 950, paid: 475, tooth: "19" }),
      line({ cdt: "D2950", payer: "Aetna PPO", claim: "CLM-X", billed: 385, allowed: 0, paid: 0, tooth: "19", adjustments: ["CARC 97 BENEFIT INCLUDED IN ANOTHER SERVICE"] }),
    ]);
    const bundled = result.findings.filter((f) => f.type === "bundled_to_zero");
    expect(bundled).toHaveLength(1);
    expect(d(bundled[0]!.expected)).toBe(280);
    expect(d(bundled[0]!.delta)).toBe(280);
    expect(bundled[0]!.confidence).toBe("medium");
    expect(bundled[0]!.evidence.relatedCodes).toEqual(["D2740"]);
  });

  it("does not flag a build-up on a different tooth from the crown", () => {
    const result = runAudit([
      ...crownWorld(),
      line({ cdt: "D2740", payer: "Aetna PPO", claim: "CLM-X", billed: 1450, allowed: 950, paid: 475, tooth: "19" }),
      line({ cdt: "D2950", payer: "Aetna PPO", claim: "CLM-X", billed: 385, allowed: 0, paid: 0, tooth: "3" }),
    ]);
    expect(result.findings.filter((f) => f.type === "bundled_to_zero")).toHaveLength(0);
  });

  it("does not flag a build-up when the crown itself was never allowed", () => {
    const result = runAudit([
      ...crownWorld(),
      line({ cdt: "D2740", payer: "Aetna PPO", claim: "CLM-X", billed: 1450, allowed: 0, paid: 0, tooth: "19" }),
      line({ cdt: "D2950", payer: "Aetna PPO", claim: "CLM-X", billed: 385, allowed: 0, paid: 0, tooth: "19" }),
    ]);
    expect(result.findings.filter((f) => f.type === "bundled_to_zero")).toHaveLength(0);
  });

  it("flags periapical films zeroed alongside a limited exam", () => {
    const result = runAudit([
      ...baseline("D0220", 28, 6, "Delta Dental", 38),
      ...baseline("D0140", 68, 6, "Delta Dental", 95),
      line({ cdt: "D0140", payer: "Delta Dental", claim: "CLM-Y", billed: 95, allowed: 68, paid: 68 }),
      line({ cdt: "D0220", payer: "Delta Dental", claim: "CLM-Y", billed: 38, allowed: 0, paid: 0 }),
    ]);
    const bundled = result.findings.filter((f) => f.type === "bundled_to_zero");
    expect(bundled).toHaveLength(1);
    expect(d(bundled[0]!.delta)).toBe(28);
  });

  it("flags SRP zeroed alongside perio maintenance", () => {
    const result = runAudit([
      ...baseline("D4341", 240, 6, "MetLife PDP", 325),
      ...baseline("D4910", 110, 6, "MetLife PDP", 155),
      line({ cdt: "D4910", payer: "MetLife PDP", claim: "CLM-Z", billed: 155, allowed: 110, paid: 88 }),
      line({ cdt: "D4341", payer: "MetLife PDP", claim: "CLM-Z", billed: 325, allowed: 0, paid: 0 }),
    ]);
    const bundled = result.findings.filter((f) => f.type === "bundled_to_zero");
    expect(bundled).toHaveLength(1);
    expect(d(bundled[0]!.delta)).toBe(240);
  });

  it("drops to low confidence when the amount must be sized from other payers", () => {
    // This payer zeroes every build-up, so it never priced one; the median of the
    // other payers' rates is used, and the finding says so.
    const result = runAudit([
      ...baseline("D2950", 280, 6, "Delta Dental", 385),
      ...baseline("D2950", 300, 6, "MetLife PDP", 385),
      ...baseline("D2740", 950, 6, "Aetna PPO", 1450),
      line({ cdt: "D2740", payer: "Aetna PPO", claim: "CLM-Q", billed: 1450, allowed: 950, paid: 475, tooth: "14" }),
      line({ cdt: "D2950", payer: "Aetna PPO", claim: "CLM-Q", billed: 385, allowed: 0, paid: 0, tooth: "14" }),
    ]);
    const bundled = result.findings.filter((f) => f.type === "bundled_to_zero");
    expect(bundled).toHaveLength(1);
    expect(bundled[0]!.confidence).toBe("low");
    expect(bundled[0]!.evidence.rateBasis).toBe("cross_payer_median");
    expect(d(bundled[0]!.delta)).toBe(290);
  });
});

describe("repriced_rate_cluster", () => {
  const crowns = (n: number, allowed: number) =>
    Array.from({ length: n }, () =>
      line({ cdt: "D2740", payer: "MetLife PDP", billed: 1450, allowed, paid: allowed / 2, network: "Careington" }),
    );

  it("flags three or more identical amounts sitting 10%+ below the rate", () => {
    const result = runAudit([...baseline("D2740", 1000, 8, "MetLife PDP", 1450), ...crowns(3, 850)]);
    const cluster = result.findings.filter((f) => f.type === "repriced_rate_cluster");
    expect(cluster).toHaveLength(3);
    expect(d(cluster[0]!.delta)).toBe(150);
    expect(cluster[0]!.evidence.clusterSize).toBe(3);
    expect(cluster[0]!.confidence).toBe("low");
    expect(cluster[0]!.why).toMatch(/leased\/rented network/i);
    expect(cluster[0]!.why).toMatch(/Careington/);
  });

  it("calls two identical amounts a shortfall, not a cluster", () => {
    const result = runAudit([...baseline("D2740", 1000, 8, "MetLife PDP", 1450), ...crowns(2, 850)]);
    expect(result.findings.every((f) => f.type === "below_schedule")).toBe(true);
    expect(result.findings).toHaveLength(2);
  });

  it("ignores a repeated amount that is only just below the rate", () => {
    // 5% under is a shortfall, not a second fee schedule.
    const result = runAudit([...baseline("D2740", 1000, 8, "MetLife PDP", 1450), ...crowns(4, 950)]);
    expect(result.findings.every((f) => f.type === "below_schedule")).toBe(true);
  });

  it("reaches medium confidence when the rate came from a contract", () => {
    const contract = parseFeeSchedule(`payer_name,cdt_code,contracted_rate\nMetLife PDP,D2740,1000.00\n`);
    const result = runAudit([...baseline("D2740", 1000, 8, "MetLife PDP", 1450), ...crowns(3, 850)], {
      contractRates: contract,
    });
    expect(result.findings.filter((f) => f.type === "repriced_rate_cluster")[0]!.confidence).toBe("medium");
  });
});

describe("zero_paid_no_reason", () => {
  it("flags an allowed amount that was simply never paid", () => {
    const result = runAudit([
      ...baseline("D1110", 92, 8),
      line({ cdt: "D1110", billed: 125, allowed: 92, paid: 0 }),
    ]);
    expect(result.findings).toHaveLength(1);
    const f = result.findings[0]!;
    expect(f.type).toBe("zero_paid_no_reason");
    expect(d(f.delta)).toBe(92);
    expect(f.confidence).toBe("medium");
    expect(f.why).toMatch(/check the EOB/i);
  });

  it("subtracts patient responsibility that IS documented before claiming a shortfall", () => {
    const result = runAudit([
      ...baseline("D1110", 92, 8),
      line({ cdt: "D1110", billed: 125, allowed: 92, paid: 0, patientPortion: 20, deductible: 30 }),
    ]);
    expect(result.findings).toHaveLength(1);
    expect(d(result.findings[0]!.delta)).toBe(42);
  });

  it("measures dollars disjoint from a rate finding on the same line", () => {
    // $92 rate, $80 allowed, $0 paid: $12 of shortfall and $80 unpaid — different
    // money, counted once each.
    const result = runAudit([
      ...baseline("D1110", 92, 8),
      line({ cdt: "D1110", billed: 125, allowed: 80, paid: 0 }),
    ]);
    const types = result.findings.map((f) => f.type).sort();
    expect(types).toEqual(["below_schedule", "zero_paid_no_reason"]);
    expect(d(result.totals.candidateTotal)).toBe(92);
  });
});

describe("engine totals", () => {
  it("summarises by type and by payer without double counting", () => {
    const result = runAudit([
      ...baseline("D1110", 92, 8, "Delta Dental", 125),
      line({ cdt: "D1110", payer: "Delta Dental", billed: 125, allowed: 78, paid: 78 }),
      ...baseline("D1110", 88, 8, "MetLife PDP", 125),
      line({ cdt: "D1110", payer: "MetLife PDP", billed: 125, allowed: 70, paid: 70 }),
    ]);
    expect(result.totals.byType.below_schedule.count).toBe(2);
    expect(d(result.totals.byType.below_schedule.dollars)).toBe(32);
    expect(d(result.totals.candidateTotal)).toBe(32);
    const byPayer = Object.fromEntries(result.totals.byPayer.map((p) => [p.payerName, d(p.dollars)]));
    expect(byPayer).toEqual({ "Delta Dental": 14, "MetLife PDP": 18 });
  });

  it("respects --since / --until on both the findings and the rate book", () => {
    const lines = [
      ...baseline("D1110", 92, 8, "Delta Dental", 125),
      line({ cdt: "D1110", payer: "Delta Dental", billed: 125, allowed: 60, paid: 60, date: "2024-02-01" }),
    ];
    expect(runAudit(lines).findings).toHaveLength(1);
    const windowed = runAudit(lines, { since: "2025-01-01" });
    expect(windowed.findings).toHaveLength(0);
    expect(windowed.excludedByWindow).toBe(1);
    expect(windowed.totals.linesAudited).toBe(8);
  });
});
