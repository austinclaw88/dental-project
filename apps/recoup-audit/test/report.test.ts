import { beforeEach, describe, expect, it } from "vitest";
import { runAudit } from "../src/engine.js";
import { consoleSummary } from "../src/output.js";
import { renderReport } from "../src/report.js";
import { runDemoPipeline } from "../src/demo.js";
import { baseline, line, resetRows } from "./helpers.js";

beforeEach(resetRows);

function smallReport(payer = "Delta Dental Premier"): string {
  const result = runAudit([
    ...baseline("D1110", 92, 8, payer, 125),
    line({ cdt: "D1110", payer, billed: 125, allowed: 78, paid: 78 }),
    line({ cdt: "D1110", payer, billed: 125, allowed: 92, paid: 0 }),
  ]);
  return renderReport(result, { practiceName: "Bridge Street Dental", sourceFile: "claims.csv" });
}

describe("report.html", () => {
  const html = smallReport();

  it("is a complete standalone document", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("</html>");
    expect(html).toContain("<title>Recoup Audit");
  });

  it("references no external assets — it must open from an email attachment", () => {
    const refs = [...html.matchAll(/(?:src|href)="(?!#)([^"]+)"/g)].map((m) => m[1]);
    expect(refs).toEqual([]);
    expect(html).not.toMatch(/<script/i);
  });

  it("leads with the headline number", () => {
    expect(html).toContain("Candidate underpayments identified");
    expect(html).toMatch(/\$106\.00/); // $14 shortfall + $92 never paid
    expect(html).toContain("claim lines");
  });

  it("carries the by-payer and by-mechanism tables", () => {
    expect(html).toContain("Where the money is — by payer");
    expect(html).toContain("How the money leaks — by mechanism");
    expect(html).toContain("Delta Dental Premier");
    expect(html).toContain("Paid below contracted/observed rate");
    expect(html).toContain("Allowed but not paid, no stated reason");
  });

  it("lists dispute candidates with expected, actual, delta, confidence and a reason", () => {
    expect(html).toMatch(/Top \d+ dispute candidates/);
    expect(html).toContain("Shortfall");
    expect(html).toContain("Confidence");
    expect(html).toContain('class="chip chip-medium"');
    expect(html).toContain("hash0001");
  });

  it("states the methodology, the confidence meanings and the honest caveats", () => {
    expect(html).toContain("Methodology, and what this report cannot tell you");
    expect(html).toContain("most common allowed");
    expect(html).toContain("reconstructed from your own");
    expect(html).toContain("Candidate ≠ collectable");
    expect(html).toContain("What this audit cannot see");
    expect(html).toMatch(/underpaid a code more than half the time/);
    expect(html).toContain("Next steps");
  });

  it("says plainly when no fee schedule was supplied", () => {
    expect(html).toContain("No contracted fee schedule was supplied");
  });

  it("styles for print and for both colour schemes", () => {
    expect(html).toContain("@media print");
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).toContain('data-theme="dark"');
    expect(html).toContain("print-color-adjust: exact");
  });

  it("escapes anything that came out of the practice's file", () => {
    const nasty = smallReport('Acme <script>alert("x")</script> Dental');
    expect(nasty).not.toContain("<script>alert");
    expect(nasty).toContain("&lt;script&gt;");
  });

  it("renders the demo report with its answer-key section", () => {
    const run = runDemoPipeline();
    expect(run.html).toContain("Answer key — this dataset is synthetic");
    expect(run.html).toContain("Seeded lines");
    expect(run.html).toContain("Reconciliation");
    expect(run.html.length).toBeGreaterThan(20_000);
  });
});

describe("console summary", () => {
  it("prints totals, mechanisms, payers and coverage", () => {
    const result = runAudit([
      ...baseline("D1110", 92, 8, "Delta Dental Premier", 125),
      line({ cdt: "D1110", payer: "Delta Dental Premier", billed: 125, allowed: 78, paid: 78 }),
    ]);
    const text = consoleSummary(result);
    expect(text).toContain("CANDIDATE UNDERPAYMENTS: $14.00");
    expect(text).toContain("By mechanism");
    expect(text).toContain("By payer");
    expect(text).toContain("Rate coverage");
    expect(text).toContain("Lines with a usable rate : 9 of 9 (100.0%)");
    expect(text).toContain("Candidate is not collectable");
  });
});
