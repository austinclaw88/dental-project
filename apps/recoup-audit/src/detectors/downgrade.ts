import { fmtMoney } from "../money.js";
import { DOWNGRADE_PARTNERS } from "../partners.js";
import { toleranceFor, type Finding } from "../types.js";
import { makeFinding, rateStatement, type AuditContext } from "./context.js";
import { guardRateDeviation } from "./guards.js";

/**
 * downgrade_suspect — the payer allowed an amount that matches ITS OWN rate for a
 * known alternate-benefit partner code rather than the code that was billed
 * (classic: posterior composite paid at the amalgam rate; porcelain crown paid at
 * the metal crown rate).
 *
 * Always MEDIUM confidence: many PPO contracts explicitly permit the alternate
 * benefit, so this is a contract-review prompt with the delta pre-quantified, not
 * an accusation. Runs FIRST among the rate detectors so a downgraded line is
 * described by its mechanism rather than as a generic shortfall.
 */
export function detectDowngrades(ctx: AuditContext): Finding[] {
  const findings: Finding[] = [];
  for (const line of ctx.lines) {
    if (ctx.claimedRateRows.has(line.rowIndex)) continue;
    if (guardRateDeviation(line).guarded) continue;
    const partners = DOWNGRADE_PARTNERS[line.cdtCode];
    if (!partners || partners.length === 0) continue;

    const own = ctx.rates.lookup(line.payerKey, line.cdtCode, line.serviceDate);
    if (!own) continue;
    if (line.allowed >= own.rate - toleranceFor(own.rate, ctx.tol)) continue;

    let best: { code: string; rate: number; distance: number } | undefined;
    for (const partner of partners) {
      const pr = ctx.rates.lookup(line.payerKey, partner, line.serviceDate);
      if (!pr) continue;
      const distance = Math.abs(line.allowed - pr.rate);
      if (distance <= toleranceFor(pr.rate, ctx.tol)) {
        if (!best || distance < best.distance) best = { code: partner, rate: pr.rate, distance };
      }
    }
    if (!best) continue;

    ctx.claimedRateRows.add(line.rowIndex);
    findings.push(
      makeFinding("downgrade_suspect", line, {
        expected: own.rate,
        actual: line.allowed,
        confidence: "medium",
        why:
          `${line.payerName} allowed ${fmtMoney(line.allowed)} on billed code ${line.cdtCode}, which matches its own ` +
          `rate for ${best.code} (${fmtMoney(best.rate)}) rather than for ${line.cdtCode} (${fmtMoney(own.rate)}). ` +
          `That is an alternate-benefit downgrade. Check whether your contract with this payer permits it for ` +
          `${line.cdtCode}; if it does not, ${fmtMoney(own.rate - line.allowed)} is owed. If it does, the patient ` +
          `should have been billed the difference.`,
        evidence: {
          rows: [line.rowIndex],
          claimIds: [line.claimId],
          rateStatement: rateStatement(own, line.payerName),
          rateBasis: own.basis,
          rateSupport: own.support,
          rateModeShare: own.modeShare,
          relatedCodes: [best.code],
        },
      }),
    );
  }
  return findings;
}
