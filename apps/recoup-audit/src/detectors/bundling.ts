import { fmtMoney } from "../money.js";
import { BUNDLING_RULES, matchZeroedCode } from "../partners.js";
import type { ClaimLine, Confidence, Finding } from "../types.js";
import { companionKey, makeFinding, rateStatement, type AuditContext } from "./context.js";
import { guardBundled } from "./guards.js";

function normTooth(t?: string): string | undefined {
  const s = t?.trim().toUpperCase().replace(/^0+/, "");
  return s === "" ? undefined : s;
}

/**
 * bundled_to_zero — a separately-payable companion procedure was allowed $0 and
 * paid $0 on the same date (and tooth, where the rule requires it) as the
 * procedure it was folded into.
 *
 * MEDIUM confidence: bundling edits are sometimes contractually permitted, so
 * this is a "read your contract on this edit" finding with the dollars attached.
 * Drops to LOW when the amount has to be sized from other payers' rates because
 * this payer zeroes the code so consistently it never priced it.
 */
export function detectBundledToZero(ctx: AuditContext): Finding[] {
  const findings: Finding[] = [];
  for (const line of ctx.lines) {
    if (line.allowed > 0 || line.paid > 0) continue;

    for (const rule of BUNDLING_RULES) {
      if (!matchZeroedCode(rule, line.cdtCode)) continue;

      const sameVisit = ctx.byClaimDate.get(companionKey(line)) ?? [];
      const lineTooth = normTooth(line.tooth);
      let companion: ClaimLine | undefined;
      let toothConfirmed = false;
      for (const c of sameVisit) {
        if (c.rowIndex === line.rowIndex) continue;
        if (!rule.companionMatches(c.cdtCode)) continue;
        if (c.allowed <= 0) continue; // the "including" procedure must itself have been paid
        const cTooth = normTooth(c.tooth);
        if (rule.requireSameTooth && lineTooth !== undefined && cTooth !== undefined) {
          if (lineTooth !== cTooth) continue;
          companion = c;
          toothConfirmed = true;
          break;
        }
        if (!companion) companion = c;
      }
      if (!companion) continue;

      const guard = guardBundled(line, ctx.tol);
      if (guard.guarded) continue;

      const rate =
        ctx.rates.lookup(line.payerKey, line.cdtCode, line.serviceDate) ??
        ctx.rates.fallback(line.cdtCode);
      if (!rate || rate.rate <= 0) continue; // cannot quantify → not reported as dollars

      const toothCaveat =
        rule.requireSameTooth && !toothConfirmed
          ? " (tooth number was not in the export, so the match is by claim and date only)"
          : "";
      const confidence: Confidence =
        rate.basis === "cross_payer_median" || (rule.requireSameTooth && !toothConfirmed)
          ? "low"
          : "medium";

      findings.push(
        makeFinding("bundled_to_zero", line, {
          expected: rate.rate,
          actual: 0,
          confidence,
          why:
            `${rule.label}: ${line.cdtCode} was allowed $0 on ${line.serviceDate} alongside ${companion.cdtCode}, ` +
            `which ${line.payerName} did allow (${fmtMoney(companion.allowed)})${toothCaveat}. ${rule.note} ` +
            `Value at this payer's rate: ${fmtMoney(rate.rate)}.`,
          evidence: {
            rows: [line.rowIndex],
            claimIds: [line.claimId],
            rateStatement: rateStatement(rate, line.payerName),
            rateBasis: rate.basis,
            rateSupport: rate.support,
            rateModeShare: rate.modeShare,
            relatedRows: [companion.rowIndex],
            relatedCodes: [companion.cdtCode],
          },
        }),
      );
      break; // one bundling finding per line
    }
  }
  return findings;
}
