import { fmtMoney } from "../money.js";
import type { Finding } from "../types.js";
import { makeFinding, type AuditContext } from "./context.js";
import { guardZeroPay } from "./guards.js";

/**
 * zero_paid_no_reason — the payer accepted an allowed amount above zero and then
 * paid nothing, with nothing in the export explaining why: no deductible, no
 * patient portion that accounts for the gap, no remark code, not a secondary
 * claim, not a 0%-coverage plan.
 *
 * MEDIUM confidence, and honest about its blind spot: the explanation may exist
 * on the paper EOB and simply not be in the export. That is exactly why the
 * finding is phrased as "ask for the reason", and why every guard above runs first.
 *
 * The dollars here are DISJOINT from the rate detectors: a rate finding claims
 * (rate − allowed), this claims (allowed − paid − patient portion − deductible).
 * The two can co-exist on one line without double counting.
 */
export function detectZeroPaidNoReason(ctx: AuditContext): Finding[] {
  const findings: Finding[] = [];
  for (const line of ctx.lines) {
    if (line.allowed <= 0) continue;
    if (line.paid > 0) continue;

    const guard = guardZeroPay(line, ctx.tol);
    if (guard.guarded) continue;

    const unexplained = line.allowed - (line.patientPortion ?? 0) - (line.deductibleApplied ?? 0);
    if (unexplained <= 0) continue;

    findings.push(
      makeFinding("zero_paid_no_reason", line, {
        expected: unexplained,
        actual: 0,
        confidence: "medium",
        why:
          `${line.payerName} allowed ${fmtMoney(line.allowed)} for ${line.cdtCode} on ${line.serviceDate} and then paid $0. ` +
          `The export carries no deductible, no patient portion covering the gap, no remark code and no secondary-claim ` +
          `marker that would explain it. ${fmtMoney(unexplained)} is unaccounted for — request the adjudication detail, ` +
          `and check the EOB in case the reason exists on paper but not in the export.`,
        evidence: {
          rows: [line.rowIndex],
          claimIds: [line.claimId],
          rateStatement: `Measured against the payer's own allowed amount of ${fmtMoney(line.allowed)} on this line — no external rate needed.`,
          rateBasis: "payer_allowed",
        },
      }),
    );
  }
  return findings;
}
