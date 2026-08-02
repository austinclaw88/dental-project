import { fmtMoney, fmtPct } from "../money.js";
import type { Cents, ClaimLine, Finding } from "../types.js";
import { makeFinding, rateStatement, type AuditContext } from "./context.js";
import { guardRateDeviation } from "./guards.js";

/** A repriced cluster needs at least this many identical allowed amounts. */
export const MIN_CLUSTER_SIZE = 3;
/** …sitting at least this far below the schedule/observed rate. */
export const CLUSTER_MIN_DISCOUNT = 0.1;

/**
 * repriced_rate_cluster — within one (payer, CDT), a SECOND tight cluster of
 * identical allowed amounts sitting ≥10% below the schedule. One-off shortfalls
 * are noise; the same odd number appearing three or more times is a second price
 * list — usually a leased/rented network the payer routed the claim through.
 *
 * The finding's value is the question it makes askable: "which network logo is on
 * that EOB, and did I ever sign that network's fee schedule?"
 */
export function detectRepricedClusters(ctx: AuditContext): Finding[] {
  const findings: Finding[] = [];
  for (const group of ctx.byPayerCdt.values()) {
    const first = group[0]!;
    const rate = ctx.rates.lookup(first.payerKey, first.cdtCode, first.serviceDate);
    if (!rate || rate.basis === "cross_payer_median") continue;

    const threshold = Math.floor(rate.rate * (1 - CLUSTER_MIN_DISCOUNT));
    const buckets = new Map<Cents, ClaimLine[]>();
    for (const l of group) {
      if (ctx.claimedRateRows.has(l.rowIndex)) continue;
      if (guardRateDeviation(l).guarded) continue;
      if (l.allowed > threshold) continue;
      const arr = buckets.get(l.allowed);
      if (arr) arr.push(l);
      else buckets.set(l.allowed, [l]);
    }

    for (const [allowed, members] of buckets) {
      if (members.length < MIN_CLUSTER_SIZE) continue;
      const discount = 1 - allowed / rate.rate;
      const rows = members.map((m) => m.rowIndex).sort((a, b) => a - b);
      const networks = [...new Set(members.map((m) => m.networkName).filter(Boolean))] as string[];
      for (const line of members) {
        ctx.claimedRateRows.add(line.rowIndex);
        findings.push(
          makeFinding("repriced_rate_cluster", line, {
            expected: rate.rate,
            actual: allowed,
            confidence: rate.basis === "contract" ? "medium" : "low",
            why:
              `${members.length} ${line.cdtCode} lines from ${line.payerName} were allowed exactly ` +
              `${fmtMoney(allowed)} — ${fmtPct(discount, 0)} below the ${rate.basis === "contract" ? "contracted" : "usual"} ` +
              `rate of ${fmtMoney(rate.rate)}. A repeated identical off-schedule amount is a second fee schedule, ` +
              `not random variance: possible leased/rented network repricing. Check the network logo on these EOBs ` +
              `against the network named in your direct contract` +
              (networks.length > 0 ? ` (export shows: ${networks.join(", ")})` : "") +
              `.`,
            evidence: {
              rows: [line.rowIndex],
              claimIds: [line.claimId],
              rateStatement: rateStatement(rate, line.payerName),
              rateBasis: rate.basis,
              rateSupport: rate.support,
              rateModeShare: rate.modeShare,
              relatedRows: rows.filter((r) => r !== line.rowIndex),
              clusterSize: members.length,
              clusterAllowed: allowed,
            },
          }),
        );
      }
    }
  }
  // Deterministic order regardless of Map iteration nuances.
  return findings.sort((a, b) => a.evidence.rows[0]! - b.evidence.rows[0]!);
}
