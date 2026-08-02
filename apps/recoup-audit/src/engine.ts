import { buildContext, resetFindingIds, runDetectors } from "./detectors/index.js";
import { inDateWindow } from "./detectors/guards.js";
import { buildRateBook, type ContractRateRow, type RateBook } from "./schedule.js";
import {
  DEFAULT_TOLERANCE,
  FINDING_TYPES,
  type AuditResult,
  type Cents,
  type ClaimLine,
  type Finding,
  type FindingType,
  type Tolerance,
} from "./types.js";

export interface AuditOptions {
  contractRates?: ContractRateRow[];
  tolerance?: Tolerance;
  since?: string;
  until?: string;
}

export function runAudit(allLines: ClaimLine[], opts: AuditOptions = {}): AuditResult {
  const tol = opts.tolerance ?? DEFAULT_TOLERANCE;
  const lines = allLines.filter((l) => inDateWindow(l, opts.since, opts.until));
  const excludedByWindow = allLines.length - lines.length;

  // The rate book is built from the WINDOWED lines only: an audit of 2025 should
  // not be judged against 2023 prices.
  const rates: RateBook = buildRateBook(lines, opts.contractRates ?? []);

  resetFindingIds();
  const ctx = buildContext(lines, rates, tol);
  const findings = runDetectors(ctx);

  const dates = lines.map((l) => l.serviceDate).sort();

  return {
    findings,
    lines,
    rates: rates.allRates(),
    unschedulable: rates.unschedulable.sort(
      (a, b) => a.payerKey.localeCompare(b.payerKey) || a.cdtCode.localeCompare(b.cdtCode),
    ),
    coverage: rates.coverage(lines),
    totals: summarize(lines, findings),
    window: { since: opts.since, until: opts.until, minDate: dates[0], maxDate: dates[dates.length - 1] },
    excludedByWindow,
    tolerance: tol,
    generatedAt: new Date().toISOString(),
  };
}

export function summarize(lines: ClaimLine[], findings: Finding[]): AuditResult["totals"] {
  const byType = Object.fromEntries(
    FINDING_TYPES.map((t) => [t, { count: 0, dollars: 0 }]),
  ) as Record<FindingType, { count: number; dollars: Cents }>;
  for (const f of findings) {
    byType[f.type].count += 1;
    byType[f.type].dollars += f.delta;
  }

  const payers = new Map<
    string,
    { payerName: string; lines: number; dollarsAudited: Cents; count: number; dollars: Cents }
  >();
  for (const l of lines) {
    const e = payers.get(l.payerKey) ?? {
      payerName: l.payerName,
      lines: 0,
      dollarsAudited: 0,
      count: 0,
      dollars: 0,
    };
    e.lines += 1;
    e.dollarsAudited += l.billed;
    payers.set(l.payerKey, e);
  }
  for (const f of findings) {
    const e = payers.get(f.payerKey);
    if (!e) continue;
    e.count += 1;
    e.dollars += f.delta;
  }

  let dollarsAudited = 0;
  for (const l of lines) dollarsAudited += l.billed;
  let candidateTotal = 0;
  for (const f of findings) candidateTotal += f.delta;

  return {
    linesAudited: lines.length,
    dollarsAudited,
    candidateTotal,
    byType,
    byPayer: [...payers.values()].sort((a, b) => b.dollars - a.dollars || b.lines - a.lines),
  };
}

export * from "./types.js";
export { buildRateBook, loadFeeSchedule, parseFeeSchedule } from "./schedule.js";
export { loadClaims, mapTable, resolveMapping } from "./mapping.js";
