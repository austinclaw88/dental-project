/**
 * Canonical domain types for Recoup Audit.
 *
 * MONEY IS ALWAYS INTEGER CENTS inside the engine (`Cents`). Dollars exist only
 * at the CSV boundary (parse) and at the render boundary (format). Never do
 * float math on dollars — a $0.005 drift across 1,500 lines is how an audit
 * loses its credibility in front of a dentist.
 */

export type Cents = number;

export type Confidence = "high" | "medium" | "low";

export type FindingType =
  | "below_schedule"
  | "downgrade_suspect"
  | "bundled_to_zero"
  | "repriced_rate_cluster"
  | "zero_paid_no_reason";

export const FINDING_TYPES: FindingType[] = [
  "below_schedule",
  "downgrade_suspect",
  "bundled_to_zero",
  "repriced_rate_cluster",
  "zero_paid_no_reason",
];

export const FINDING_LABELS: Record<FindingType, string> = {
  below_schedule: "Paid below contracted/observed rate",
  downgrade_suspect: "Procedure downgraded (alternate benefit)",
  bundled_to_zero: "Companion procedure bundled to zero",
  repriced_rate_cluster: "Repriced rate cluster (leased network signal)",
  zero_paid_no_reason: "Allowed but not paid, no stated reason",
};

/** One claim line (one procedure on one claim) after mapping to canonical fields. */
export interface ClaimLine {
  /** 1-based row number in the source CSV (header excluded). Evidence anchor. */
  rowIndex: number;
  claimId: string;
  /** ISO yyyy-mm-dd. */
  serviceDate: string;
  payerName: string;
  /** Normalized payer key used for grouping (uppercased, punctuation-stripped). */
  payerKey: string;
  cdtCode: string;
  billed: Cents;
  allowed: Cents;
  paid: Cents;
  planOrGroup?: string;
  /** Short non-reversible hash of subscriber_id. The raw id is never retained. */
  patientHash?: string;
  tooth?: string;
  patientPortion?: Cents;
  writeoff?: Cents;
  deductibleApplied?: Cents;
  adjustmentCodes: string[];
  /** 1 = primary, 2 = secondary, 3 = tertiary. Undefined when the export omits it. */
  claimOrdinal?: number;
  networkName?: string;
  /** 0–100. */
  coveragePct?: number;
}

export type RateBasis =
  /** From a contracted fee schedule the practice supplied. */
  | "contract"
  /** Modal allowed amount reconstructed from the practice's own payment history. */
  | "reconstructed"
  /** Median rate across the practice's other payers — sizing only, never judging. */
  | "cross_payer_median"
  /** The payer's own allowed amount on the line itself (no external rate needed). */
  | "payer_allowed";

export interface Rate {
  payerKey: string;
  cdtCode: string;
  rate: Cents;
  basis: RateBasis;
  /** Reconstruction only: how many lines carried the modal allowed amount. */
  support?: number;
  /** Reconstruction only: support / eligible lines for the (payer, cdt). */
  modeShare?: number;
  effectiveFrom?: string;
  effectiveTo?: string;
}

/** A (payer, cdt) pair we deliberately refuse to judge, and why. */
export interface Unschedulable {
  payerKey: string;
  payerName: string;
  cdtCode: string;
  eligibleLines: number;
  support: number;
  modeShare: number;
  reason: "insufficient_support" | "no_dominant_mode" | "no_priced_lines";
}

export interface FindingEvidence {
  /** Source CSV row numbers backing this finding. */
  rows: number[];
  claimIds: string[];
  /** Human-readable statement of the rate used and where it came from. */
  rateStatement: string;
  rateBasis: RateBasis;
  rateSupport?: number;
  rateModeShare?: number;
  /** Companion/partner lines that make the finding legible (bundling, downgrade). */
  relatedRows?: number[];
  relatedCodes?: string[];
  /** Repriced-cluster only. */
  clusterSize?: number;
  clusterAllowed?: Cents;
}

export interface Finding {
  id: string;
  type: FindingType;
  payerName: string;
  payerKey: string;
  claimId: string;
  serviceDate: string;
  cdtCode: string;
  tooth?: string;
  patientHash?: string;
  /** What the payer should have allowed. */
  expected: Cents;
  /** What the payer actually allowed (or paid, for zero_paid_no_reason). */
  actual: Cents;
  /** expected - actual, always > 0. */
  delta: Cents;
  confidence: Confidence;
  why: string;
  evidence: FindingEvidence;
}

export interface Tolerance {
  /** Absolute floor in cents (default $1.00). */
  absCents: Cents;
  /** Fractional floor (default 0.01 = 1%). */
  pct: number;
}

export const DEFAULT_TOLERANCE: Tolerance = { absCents: 100, pct: 0.01 };

/** Tolerance band around an expected amount: max($1.00, 1% of expected). */
export function toleranceFor(expected: Cents, tol: Tolerance = DEFAULT_TOLERANCE): Cents {
  return Math.max(tol.absCents, Math.round(Math.abs(expected) * tol.pct));
}

export interface CoverageStats {
  totalLines: number;
  /** Lines whose (payer, cdt) has a usable rate (contract or reconstructed). */
  schedulableLines: number;
  unschedulableLines: number;
  pairsTotal: number;
  pairsSchedulable: number;
  pairsFromContract: number;
  pairsReconstructed: number;
}

export interface AuditResult {
  findings: Finding[];
  lines: ClaimLine[];
  rates: Rate[];
  unschedulable: Unschedulable[];
  coverage: CoverageStats;
  totals: {
    linesAudited: number;
    dollarsAudited: Cents;
    candidateTotal: Cents;
    byType: Record<FindingType, { count: number; dollars: Cents }>;
    byPayer: Array<{
      payerName: string;
      lines: number;
      dollarsAudited: Cents;
      count: number;
      dollars: Cents;
    }>;
  };
  window: { since?: string; until?: string; minDate?: string; maxDate?: string };
  /** Rows dropped by --since/--until. */
  excludedByWindow: number;
  tolerance: Tolerance;
  generatedAt: string;
}
