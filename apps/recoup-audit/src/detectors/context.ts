import type { RateBook } from "../schedule.js";
import { fmtMoney, fmtPct } from "../money.js";
import type { Cents, ClaimLine, Finding, FindingType, Rate, Tolerance } from "../types.js";

export interface AuditContext {
  lines: ClaimLine[];
  rates: RateBook;
  tol: Tolerance;
  /** rowIndex -> line */
  byRow: Map<number, ClaimLine>;
  /** `${payerKey}|${cdt}` -> lines */
  byPayerCdt: Map<string, ClaimLine[]>;
  /** `${claimId}|${serviceDate}` -> lines on the same claim + date (companion lookup) */
  byClaimDate: Map<string, ClaimLine[]>;
  /**
   * Rows already explained by a rate-deviation finding. A line gets at most ONE
   * of {downgrade_suspect, repriced_rate_cluster, below_schedule} so the dollar
   * total is never double-counted; the detectors run in that precedence order.
   */
  claimedRateRows: Set<number>;
}

export function buildContext(lines: ClaimLine[], rates: RateBook, tol: Tolerance): AuditContext {
  const byRow = new Map<number, ClaimLine>();
  const byPayerCdt = new Map<string, ClaimLine[]>();
  const byClaimDate = new Map<string, ClaimLine[]>();
  for (const l of lines) {
    byRow.set(l.rowIndex, l);
    push(byPayerCdt, `${l.payerKey}|${l.cdtCode}`, l);
    push(byClaimDate, companionKey(l), l);
  }
  return { lines, rates, tol, byRow, byPayerCdt, byClaimDate, claimedRateRows: new Set() };
}

function push<T>(m: Map<string, T[]>, k: string, v: T): void {
  const arr = m.get(k);
  if (arr) arr.push(v);
  else m.set(k, [v]);
}

/**
 * Companion grouping key. Claim id + date is the tight grouping; when an export
 * has no claim id we fall back to patient + date so same-visit companions still
 * find each other.
 */
export function companionKey(l: ClaimLine): string {
  const anchor = l.claimId !== "" ? l.claimId : `pt:${l.patientHash ?? "unknown"}`;
  return `${anchor}|${l.serviceDate}`;
}

export function rateStatement(r: Rate, payerName: string): string {
  if (r.basis === "contract") {
    const window =
      r.effectiveFrom || r.effectiveTo
        ? ` (effective ${r.effectiveFrom ?? "—"} to ${r.effectiveTo ?? "—"})`
        : "";
    return `Contracted rate ${fmtMoney(r.rate)} for ${payerName} / ${r.cdtCode}, from the fee schedule you provided${window}.`;
  }
  if (r.basis === "cross_payer_median") {
    return `Estimated rate ${fmtMoney(r.rate)} for ${r.cdtCode} — the median rate your other payers allow for this code, used because ${payerName} never priced it.`;
  }
  return (
    `Observed rate ${fmtMoney(r.rate)} for ${payerName} / ${r.cdtCode} — the most common amount this payer ` +
    `allowed for this code in your own data (${r.support} of ${Math.round((r.support ?? 0) / (r.modeShare || 1))} ` +
    `priced lines, ${fmtPct(r.modeShare ?? 0, 0)}).`
  );
}

let counter = 0;
export function resetFindingIds(): void {
  counter = 0;
}

export function makeFinding(
  type: FindingType,
  line: ClaimLine,
  fields: {
    expected: Cents;
    actual: Cents;
    confidence: Finding["confidence"];
    why: string;
    evidence: Finding["evidence"];
  },
): Finding {
  counter += 1;
  return {
    id: `F${String(counter).padStart(5, "0")}`,
    type,
    payerName: line.payerName,
    payerKey: line.payerKey,
    claimId: line.claimId,
    serviceDate: line.serviceDate,
    cdtCode: line.cdtCode,
    tooth: line.tooth,
    patientHash: line.patientHash,
    expected: fields.expected,
    actual: fields.actual,
    delta: fields.expected - fields.actual,
    confidence: fields.confidence,
    why: fields.why,
    evidence: fields.evidence,
  };
}
