import { fmtMoney } from "../money.js";
import { toleranceFor, type Finding } from "../types.js";
import { makeFinding, rateStatement, type AuditContext } from "./context.js";
import { guardRateDeviation } from "./guards.js";

/**
 * below_schedule — the payer allowed less than the contracted (or, absent a
 * contract, its own habitual) rate, by more than tolerance.
 *
 * HIGH confidence only when the practice supplied a real fee schedule. With a
 * reconstructed rate it is MEDIUM: the comparison is against the payer's own most
 * common behaviour, which is strong evidence but not a contract citation.
 *
 * Runs LAST among the rate detectors — anything with a named mechanism
 * (downgrade, repricing cluster) has already claimed its rows, so this detector
 * carries the residue and never double-counts their dollars.
 */
export function detectBelowSchedule(ctx: AuditContext): Finding[] {
  const findings: Finding[] = [];
  for (const line of ctx.lines) {
    if (ctx.claimedRateRows.has(line.rowIndex)) continue;
    if (guardRateDeviation(line).guarded) continue;

    const rate = ctx.rates.lookup(line.payerKey, line.cdtCode, line.serviceDate);
    // Unschedulable (payer, cdt) pairs are excluded by construction — we do not
    // guess at a rate we cannot evidence. They surface in the coverage stats
    // instead, so the gap is visible rather than silently absent.
    if (!rate || rate.basis === "cross_payer_median") continue;

    const tolerance = toleranceFor(rate.rate, ctx.tol);
    if (line.allowed >= rate.rate - tolerance) continue;

    ctx.claimedRateRows.add(line.rowIndex);
    findings.push(
      makeFinding("below_schedule", line, {
        expected: rate.rate,
        actual: line.allowed,
        confidence: rate.basis === "contract" ? "high" : "medium",
        why:
          `${line.payerName} allowed ${fmtMoney(line.allowed)} for ${line.cdtCode} against ` +
          `${rate.basis === "contract" ? "a contracted rate" : "its own usual rate"} of ${fmtMoney(rate.rate)} — ` +
          `${fmtMoney(rate.rate - line.allowed)} short, beyond the ${fmtMoney(tolerance)} tolerance applied to this code.`,
        evidence: {
          rows: [line.rowIndex],
          claimIds: [line.claimId],
          rateStatement: rateStatement(rate, line.payerName),
          rateBasis: rate.basis,
          rateSupport: rate.support,
          rateModeShare: rate.modeShare,
        },
      }),
    );
  }
  return findings;
}
