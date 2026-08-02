/**
 * Legitimate-adjudication guards.
 *
 * These are the most important functions in the product. A missed underpayment
 * costs a practice money it never knew it had; a FALSE positive costs the
 * practice a wasted appeal, the payer's patience, and our credibility — and it
 * only takes a handful before a dentist stops believing the whole report.
 * Every guard here says "this looks like an underpayment but is normal
 * adjudication", and every one is unit-tested for the NOT-flagged case.
 */

import { hasExplanatoryMarker, explanatoryMarkers } from "../partners.js";
import { toleranceFor, type ClaimLine, type Tolerance } from "../types.js";

export type GuardReason =
  | "deductible_covers_gap"
  | "coinsurance_accounts_for_gap"
  | "secondary_claim"
  | "explanatory_adjustment_code"
  | "non_covered_billed_to_patient"
  | "outside_date_window"
  | "zero_coverage_plan"
  | "within_tolerance"
  | "no_usable_rate";

export interface GuardHit {
  guarded: boolean;
  reason?: GuardReason;
  detail?: string;
}

const PASS: GuardHit = { guarded: false };

/** G-WINDOW: rows outside --since/--until never reach a detector. */
export function inDateWindow(line: ClaimLine, since?: string, until?: string): boolean {
  if (since && line.serviceDate < since) return false;
  if (until && line.serviceDate > until) return false;
  return true;
}

/** G-SECONDARY: claim_ordinal >= 2. Secondary/tertiary payment behaviour is not a shortfall. */
export function isSecondaryClaim(line: ClaimLine): boolean {
  return line.claimOrdinal !== undefined && line.claimOrdinal >= 2;
}

/** G-DEDUCTIBLE: the deductible eats the gap between allowed and paid. */
export function deductibleCoversGap(line: ClaimLine, tol: Tolerance): boolean {
  const ded = line.deductibleApplied ?? 0;
  if (ded <= 0) return false;
  const gap = line.allowed - line.paid;
  return ded + toleranceFor(line.allowed, tol) >= gap;
}

/** G-COINSURANCE: patient_portion + paid (+ deductible) reconstructs the allowed amount. */
export function coinsuranceAccountsForGap(line: ClaimLine, tol: Tolerance): boolean {
  if (line.patientPortion === undefined) return false;
  const accounted = line.paid + line.patientPortion + (line.deductibleApplied ?? 0);
  return Math.abs(accounted - line.allowed) <= toleranceFor(line.allowed, tol);
}

/** G-ZEROCOVERAGE: the plan pays 0% for this class of service — not a shortfall. */
export function zeroCoveragePlan(line: ClaimLine): boolean {
  return line.coveragePct !== undefined && line.coveragePct <= 0;
}

/**
 * G-NONCOVERED: allowed $0 with the full fee handed to the patient. The practice
 * is not out the money — it bills the patient. Flagging these is the fastest way
 * to make an audit look wrong.
 */
export function nonCoveredBilledToPatient(line: ClaimLine, tol: Tolerance): boolean {
  if (line.allowed > 0) return false;
  const pp = line.patientPortion;
  if (pp === undefined) return false;
  return pp + toleranceFor(line.billed, tol) >= line.billed && line.billed > 0;
}

/** G-REMARK: the payer stated a reason we accept as legitimate. */
export function hasLegitimateRemark(line: ClaimLine): boolean {
  return hasExplanatoryMarker(line.adjustmentCodes);
}

export function remarkKinds(line: ClaimLine): string[] {
  return explanatoryMarkers(line.adjustmentCodes);
}

/**
 * The full guard stack for a "allowed > 0 but paid $0" line.
 * Returns the first guard that legitimises the zero payment, if any.
 */
export function guardZeroPay(line: ClaimLine, tol: Tolerance): GuardHit {
  if (isSecondaryClaim(line)) {
    return { guarded: true, reason: "secondary_claim", detail: `claim_ordinal=${line.claimOrdinal}` };
  }
  if (zeroCoveragePlan(line)) {
    return { guarded: true, reason: "zero_coverage_plan", detail: `coverage_pct=${line.coveragePct}` };
  }
  if (deductibleCoversGap(line, tol)) {
    return { guarded: true, reason: "deductible_covers_gap", detail: `deductible_applied` };
  }
  if (coinsuranceAccountsForGap(line, tol)) {
    return {
      guarded: true,
      reason: "coinsurance_accounts_for_gap",
      detail: "patient_portion + paid ≈ allowed",
    };
  }
  if (hasLegitimateRemark(line)) {
    return {
      guarded: true,
      reason: "explanatory_adjustment_code",
      detail: remarkKinds(line).join(", "),
    };
  }
  return PASS;
}

/** Guard stack for a "$0 allowed, $0 paid" line that a bundling rule matched. */
export function guardBundled(line: ClaimLine, tol: Tolerance): GuardHit {
  if (isSecondaryClaim(line)) {
    return { guarded: true, reason: "secondary_claim", detail: `claim_ordinal=${line.claimOrdinal}` };
  }
  if (nonCoveredBilledToPatient(line, tol)) {
    return {
      guarded: true,
      reason: "non_covered_billed_to_patient",
      detail: "patient_portion ≈ billed_fee",
    };
  }
  // A non-covered / frequency / eligibility remark is a stated benefit limit, not
  // a bundling edit. "Bundled" remarks (CARC 97) deliberately do NOT guard here —
  // that code is the payer asserting the very behaviour under audit.
  const kinds = remarkKinds(line);
  const legitimising = kinds.filter((k) => k !== "coinsurance" && k !== "copay");
  if (legitimising.length > 0) {
    return {
      guarded: true,
      reason: "explanatory_adjustment_code",
      detail: legitimising.join(", "),
    };
  }
  return PASS;
}

/** Guard stack for rate-deviation findings (below schedule / downgrade / cluster). */
export function guardRateDeviation(line: ClaimLine): GuardHit {
  // Note: secondary claims are NOT guarded here. A secondary payer that allows
  // less than its own contracted rate is still underpaying — the spec's
  // "unless allowed < schedule" carve-out.
  if (line.allowed <= 0) {
    return { guarded: true, reason: "no_usable_rate", detail: "allowed <= 0 handled by bundling rules" };
  }
  return PASS;
}
