import type { Finding } from "../types.js";
import type { AuditContext } from "./context.js";
import { detectBelowSchedule } from "./belowSchedule.js";
import { detectBundledToZero } from "./bundling.js";
import { detectRepricedClusters } from "./cluster.js";
import { detectDowngrades } from "./downgrade.js";
import { detectZeroPaidNoReason } from "./zeroPaid.js";

export * from "./context.js";
export * from "./guards.js";
export { detectBelowSchedule } from "./belowSchedule.js";
export { detectBundledToZero } from "./bundling.js";
export { detectRepricedClusters, MIN_CLUSTER_SIZE, CLUSTER_MIN_DISCOUNT } from "./cluster.js";
export { detectDowngrades } from "./downgrade.js";
export { detectZeroPaidNoReason } from "./zeroPaid.js";

/**
 * Detector order is load-bearing.
 *
 * The three rate detectors are mutually exclusive per line and run
 * most-specific-first (downgrade → repricing cluster → generic shortfall), each
 * claiming its rows, so one dollar of shortfall is described once and counted
 * once. Bundling and zero-paid measure different dollars entirely and run
 * independently.
 */
export function runDetectors(ctx: AuditContext): Finding[] {
  const findings = [
    ...detectDowngrades(ctx),
    ...detectRepricedClusters(ctx),
    ...detectBelowSchedule(ctx),
    ...detectBundledToZero(ctx),
    ...detectZeroPaidNoReason(ctx),
  ];
  return findings.sort(
    (a, b) =>
      b.delta - a.delta ||
      a.evidence.rows[0]! - b.evidence.rows[0]! ||
      a.type.localeCompare(b.type),
  );
}
