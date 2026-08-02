/**
 * Demo mode: generate a synthetic 12-month dataset with known seeded leakage,
 * run the real engine over it end-to-end (CSV -> mapping -> detectors -> report),
 * and print how much of the planted money the engine actually found — and how
 * much of what it flagged was never there.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runAudit } from "./engine.js";
import { mapTable, resolveMapping } from "./mapping.js";
import { parseCsv } from "./csv.js";
import { fmtMoney, fmtPct } from "./money.js";
import { consoleSummary, findingsToCsv, findingsToJson } from "./output.js";
import { renderReport } from "./report.js";
import { DEFAULT_SEED, generateDataset, type SyntheticDataset } from "./synthetic.js";
import { FINDING_LABELS, type AuditResult, type Cents, type FindingType } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEMO_OUT_DIR = resolve(HERE, "..", "var");

export interface Reconciliation {
  seededCents: Cents;
  seededLines: number;
  /** Seeded dollars the engine recovered (capped at what was actually planted). */
  foundOnSeededCents: Cents;
  seededLinesFound: number;
  recall: number;
  flaggedCents: Cents;
  flaggedLines: number;
  /** Flagged dollars with no seeded leakage behind them, plus over-claims on seeded lines. */
  falsePositiveCents: Cents;
  falsePositiveLines: number;
  falsePositiveRate: number;
  byType: Array<{
    type: FindingType;
    seededCents: Cents;
    seededCount: number;
    foundCents: Cents;
    recall: number;
  }>;
}

/**
 * Recall counts min(found, seeded) per line, so an over-estimate can never
 * inflate it. The excess is pushed into the false-positive column instead —
 * money we would have chased that was never owed is a false positive whether it
 * sits on a clean line or on top of a real one.
 */
export function reconcile(dataset: SyntheticDataset, result: AuditResult): Reconciliation {
  const foundByRow = new Map<number, Cents>();
  for (const f of result.findings) {
    for (const row of f.evidence.rows) {
      foundByRow.set(row, (foundByRow.get(row) ?? 0) + f.delta);
    }
  }

  let foundOnSeeded = 0;
  let seededLinesFound = 0;
  let falsePositive = 0;
  let falsePositiveLines = 0;
  const perType = new Map<FindingType, { seededCents: Cents; seededCount: number; foundCents: Cents }>();

  for (const leak of dataset.leaks.values()) {
    const bucket = perType.get(leak.type) ?? { seededCents: 0, seededCount: 0, foundCents: 0 };
    bucket.seededCents += leak.cents;
    bucket.seededCount += 1;
    const found = foundByRow.get(leak.rowIndex) ?? 0;
    const credited = Math.min(found, leak.cents);
    bucket.foundCents += credited;
    foundOnSeeded += credited;
    if (found > 0) seededLinesFound += 1;
    if (found > leak.cents) falsePositive += found - leak.cents;
    perType.set(leak.type, bucket);
  }

  for (const [row, cents] of foundByRow) {
    if (dataset.leaks.has(row)) continue;
    falsePositive += cents;
    falsePositiveLines += 1;
  }

  const flaggedCents = result.totals.candidateTotal;
  return {
    seededCents: dataset.totalSeededCents,
    seededLines: dataset.leaks.size,
    foundOnSeededCents: foundOnSeeded,
    seededLinesFound,
    recall: dataset.totalSeededCents > 0 ? foundOnSeeded / dataset.totalSeededCents : 0,
    flaggedCents,
    flaggedLines: foundByRow.size,
    falsePositiveCents: falsePositive,
    falsePositiveLines,
    falsePositiveRate: flaggedCents > 0 ? falsePositive / flaggedCents : 0,
    byType: [...perType.entries()]
      .map(([type, b]) => ({
        type,
        seededCents: b.seededCents,
        seededCount: b.seededCount,
        foundCents: b.foundCents,
        recall: b.seededCents > 0 ? b.foundCents / b.seededCents : 0,
      }))
      .sort((a, b) => b.seededCents - a.seededCents),
  };
}

export interface DemoRun {
  dataset: SyntheticDataset;
  result: AuditResult;
  reconciliation: Reconciliation;
  html: string;
}

/** Runs the whole pipeline in memory — CSV text in, findings and report out. */
export function runDemoPipeline(seed = DEFAULT_SEED): DemoRun {
  const dataset = generateDataset(seed);
  // Deliberately parsed back out of CSV text through the real mapping layer:
  // the demo exercises the same path a practice's export takes.
  const mapped = mapTable(parseCsv(dataset.csv), resolveMapping("generic"));
  if (mapped.rejected.length > 0) {
    throw new Error(`demo dataset failed to map: ${mapped.rejected[0]!.reason}`);
  }
  // No --fees: the harder, more honest path. Every rate below is reconstructed
  // from the practice's own payment history.
  const result = runAudit(mapped.lines);
  const reconciliation = reconcile(dataset, result);
  const html = renderReport(result, {
    practiceName: "Demo Family Dental (synthetic data)",
    hasContractSchedule: false,
    sourceFile: "demo-claims.csv",
    extraSection: reconciliationSection(dataset, reconciliation),
  });
  return { dataset, result, reconciliation, html };
}

function reconciliationSection(dataset: SyntheticDataset, r: Reconciliation): string {
  const rows = r.byType
    .map(
      (b) => `
      <tr>
        <th scope="row">${FINDING_LABELS[b.type]}</th>
        <td class="num">${b.seededCount}</td>
        <td class="num">${fmtMoney(b.seededCents)}</td>
        <td class="num">${fmtMoney(b.foundCents)}</td>
        <td class="num strong">${fmtPct(b.recall, 1)}</td>
      </tr>`,
    )
    .join("");
  return `
<h2>Answer key — this dataset is synthetic</h2>
<p class="lede">This report was generated from a fabricated 12-month dataset in which every recoverable dollar was
planted deliberately, alongside abundant legitimate adjudication (deductibles, coinsurance, secondary claims,
annual-maximum hits, non-covered services) that must not be flagged. A real audit has no answer key; this one does,
which is the only way to measure whether the engine is honest.</p>
<div class="tablewrap">
<table>
  <caption>Seeded leakage versus what the engine found, by mechanism.</caption>
  <thead><tr><th scope="col">Mechanism</th><th scope="col" class="num">Seeded lines</th>
  <th scope="col" class="num">Seeded dollars</th><th scope="col" class="num">Found</th>
  <th scope="col" class="num">Recall</th></tr></thead>
  <tbody>${rows}
    <tr><th scope="row" class="strong">Total</th>
      <td class="num strong">${r.seededLines}</td>
      <td class="num strong">${fmtMoney(r.seededCents)}</td>
      <td class="num strong">${fmtMoney(r.foundOnSeededCents)}</td>
      <td class="num strong">${fmtPct(r.recall, 1)}</td></tr>
  </tbody>
</table>
</div>
<div class="box">
  <h3>Reconciliation</h3>
  <ul>
    <li>Seeded recoverable: <strong>${fmtMoney(r.seededCents)}</strong> across ${r.seededLines} claim lines.</li>
    <li>Engine found: <strong>${fmtMoney(r.foundOnSeededCents)}</strong> (<strong>${fmtPct(r.recall, 1)}</strong> recall).</li>
    <li>False positives: <strong>${fmtMoney(r.falsePositiveCents)}</strong> of ${fmtMoney(r.flaggedCents)} flagged
      (<strong>${fmtPct(r.falsePositiveRate, 1)}</strong> of flagged dollars, ${r.falsePositiveLines} lines).</li>
    <li>Legitimate adjudication deliberately left alone: ${dataset.legitimateCounts.ordinary_coinsurance} coinsurance
      splits, ${dataset.legitimateCounts.deductible_applied} deductible applications,
      ${dataset.legitimateCounts.secondary_claim} secondary-claim lines,
      ${dataset.legitimateCounts.annual_max_met} annual-maximum hits, and
      ${dataset.legitimateCounts.non_covered_billed_to_patient} non-covered services billed to the patient.</li>
  </ul>
</div>`;
}

export function reconciliationText(r: Reconciliation): string {
  const out: string[] = [];
  out.push("Seeded-vs-found reconciliation (synthetic dataset — the answer key is known)");
  out.push("─".repeat(78));
  out.push(
    `seeded ${fmtMoney(r.seededCents)} recoverable across ${r.seededLines} lines; ` +
      `engine found ${fmtMoney(r.foundOnSeededCents)} (${fmtPct(r.recall, 1)}), ` +
      `false-positive rate ${fmtPct(r.falsePositiveRate, 1)}`,
  );
  out.push("");
  out.push(
    `${"Mechanism".padEnd(46)}${"Seeded".padStart(13)}${"Found".padStart(13)}${"Recall".padStart(9)}`,
  );
  for (const b of r.byType) {
    out.push(
      `${FINDING_LABELS[b.type].padEnd(46)}${fmtMoney(b.seededCents).padStart(13)}` +
        `${fmtMoney(b.foundCents).padStart(13)}${fmtPct(b.recall, 1).padStart(9)}`,
    );
  }
  out.push(
    `${"TOTAL".padEnd(46)}${fmtMoney(r.seededCents).padStart(13)}` +
      `${fmtMoney(r.foundOnSeededCents).padStart(13)}${fmtPct(r.recall, 1).padStart(9)}`,
  );
  out.push("");
  out.push(
    `False positives: ${fmtMoney(r.falsePositiveCents)} of ${fmtMoney(r.flaggedCents)} flagged ` +
      `(${fmtPct(r.falsePositiveRate, 1)}), on ${r.falsePositiveLines} line(s) with no seeded leakage.`,
  );
  out.push(
    `Seeded lines detected: ${r.seededLinesFound} of ${r.seededLines} ` +
      `(${fmtPct(r.seededLines > 0 ? r.seededLinesFound / r.seededLines : 0, 1)}).`,
  );
  out.push("");
  return out.join("\n");
}

export function main(): void {
  const run = runDemoPipeline();
  mkdirSync(DEMO_OUT_DIR, { recursive: true });
  const write = (name: string, body: string): string => {
    const p = join(DEMO_OUT_DIR, name);
    writeFileSync(p, body, "utf8");
    return p;
  };
  const written = [
    write("demo-claims.csv", run.dataset.csv),
    write("demo-fees.csv", run.dataset.feesCsv),
    write("demo-report.html", run.html),
    write("demo-findings.csv", findingsToCsv(run.result.findings)),
    write("demo-findings.json", findingsToJson(run.result)),
  ];

  process.stdout.write(
    `\nRecoup Audit demo — synthetic 12-month dataset ` +
      `(${run.dataset.lineCount.toLocaleString("en-US")} claim lines, ${run.dataset.payerNames.length} payers, seed ${DEFAULT_SEED})\n`,
  );
  process.stdout.write(consoleSummary(run.result));
  process.stdout.write(reconciliationText(run.reconciliation));
  process.stdout.write("Written:\n" + written.map((w) => `  ${w}`).join("\n") + "\n");
  process.stdout.write(
    `\nOpen var/demo-report.html to see what a practice receives.\n` +
      `Re-run the same data through the CLI (with the contracted schedule, for high-confidence findings):\n` +
      `  npm run -w @nightshift/recoup-audit audit -- --claims apps/recoup-audit/var/demo-claims.csv \\\n` +
      `      --fees apps/recoup-audit/var/demo-fees.csv --out apps/recoup-audit/var/report.html\n\n`,
  );
}

const invokedDirectly = process.argv[1] !== undefined && /demo\.(ts|js)$/.test(process.argv[1]);
if (invokedDirectly) main();
