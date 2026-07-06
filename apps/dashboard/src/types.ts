/**
 * Display types for the dashboard.
 *
 * These are a hand-copied SUBSET of @nightshift/schema (benefits.ts,
 * verification.ts, dto.ts) — only the shapes the UI renders. Per the build
 * contract, duplicating the small display types is an explicitly allowed
 * alternative to wiring transpilePackages, and it keeps `next build` free of
 * any dependency on the (tsx-only, .ts-exporting) schema package.
 *
 * If a field here drifts from the schema, the schema is source of truth.
 */

// ---- benefits.ts ----
export type FieldSource = "portal" | "x12_271" | "voice_call" | "human" | "pms";
export type Confidence = "high" | "medium" | "low";

export interface Provenance {
  source: FieldSource;
  artifactId: string | null;
  locator: string | null;
  retrievedAt: string;
}

export interface FieldValue<T> {
  value: T | null;
  provenance: Provenance | null;
  confidence: Confidence;
  /** set when the payer explicitly would not disclose this field (PRD R8) */
  unavailableReason: string | null;
}

export type CoverageCategory = "preventive" | "basic" | "major" | "ortho";

export interface CdtCoverageRule {
  cdtFrom: string;
  cdtTo: string;
  category: CoverageCategory | null;
  percent: FieldValue<number>;
  notes: string | null;
}

export interface FrequencyLimitation {
  key: string;
  cdtCodes: string[];
  limit: FieldValue<string>;
  usedCount: FieldValue<number>;
  lastServiceDate: FieldValue<string>;
  nextEligibleDate: FieldValue<string>;
}

export interface WaitingPeriod {
  category: CoverageCategory;
  months: FieldValue<number>;
  endsOn: FieldValue<string>;
}

export interface DowngradeClause {
  key: string;
  description: FieldValue<string>;
  applies: FieldValue<boolean>;
}

export interface BenefitBreakdown {
  schemaVersion: "1.0";
  planStatus: {
    active: FieldValue<boolean>;
    effectiveDate: FieldValue<string>;
    terminationDate: FieldValue<string>;
    planYearStart: FieldValue<string>;
  };
  annualMaximum: {
    total: FieldValue<number>;
    used: FieldValue<number>;
    remaining: FieldValue<number>;
  };
  deductible: {
    individual: FieldValue<number>;
    individualMet: FieldValue<number>;
    family: FieldValue<number>;
    familyMet: FieldValue<number>;
    appliesTo: FieldValue<CoverageCategory[]>;
  };
  categoryCoverage: {
    preventive: FieldValue<number>;
    basic: FieldValue<number>;
    major: FieldValue<number>;
    ortho: FieldValue<number>;
  };
  cdtRules: CdtCoverageRule[];
  frequencies: FrequencyLimitation[];
  waitingPeriods: WaitingPeriod[];
  downgrades: DowngradeClause[];
  missingToothClause: FieldValue<boolean>;
  orthoLifetimeMax: FieldValue<number>;
  orthoLifetimeUsed: FieldValue<number>;
  cobRule: FieldValue<string>;
  assignmentOfBenefits: FieldValue<boolean>;
  feeScheduleName: FieldValue<string>;
  notes: string[];
}

export interface BenefitSnapshot {
  verificationId: string;
  breakdown: BenefitBreakdown;
  validatorIssues: string[];
}

// ---- verification.ts ----
export type VerificationStatus =
  | "PLANNED"
  | "ELIGIBILITY"
  | "PORTAL"
  | "VOICE"
  | "HUMAN_REVIEW"
  | "NORMALIZE"
  | "QA_GATE"
  | "WRITEBACK"
  | "DONE"
  | "EXCEPTION"
  | "FAILED";

export type StepKind =
  | "eligibility"
  | "portal"
  | "voice"
  | "human"
  | "normalize"
  | "qa"
  | "writeback";

export type StepStatus = "running" | "succeeded" | "failed" | "skipped";

export type ExceptionType =
  | "coverage_terminated"
  | "plan_changed"
  | "waiting_period_conflict"
  | "frequency_conflict"
  | "deductible_unmet_high_value"
  | "low_confidence"
  | "verification_failed"
  | "connector_offline";

export type ExceptionSeverity = "info" | "warning" | "critical";

export interface VerificationException {
  id: string;
  verificationId: string;
  type: ExceptionType;
  severity: ExceptionSeverity;
  message: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
}

export type WritebackTarget =
  | "benefit_rows"
  | "insplan_note"
  | "insverify"
  | "commlog"
  | "document_pdf";

export interface WritebackCommand {
  id: string;
  verificationId: string;
  practiceId: string;
  target: WritebackTarget;
  payload: Record<string, unknown>;
  status: "pending" | "applied" | "failed" | "reverted";
  beforeImage: Record<string, unknown> | null;
}

export interface VerificationStep {
  id: string;
  verificationId: string;
  kind: StepKind;
  status: StepStatus;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  artifactId: string | null;
  detail: string | null;
}

// ---- dto.ts ----
export type DisplayStatus =
  | "verified"
  | "attention"
  | "in_progress"
  | "failed"
  | "planned";

export interface ListException {
  id: string;
  type: string;
  severity: string;
  message: string;
  resolvedAt: string | null;
}

export interface VerificationListItem {
  id: string;
  patientName: string;
  appointmentAt: string;
  provider: string | null;
  cdtCodes: string[];
  carrierName: string | null;
  scope: string;
  status: string;
  displayStatus: DisplayStatus;
  exceptions: ListException[];
  completedAt: string | null;
  /** patient link id, used by verify-now (present in fixtures; API may add it) */
  patientLinkId?: string;
}

// ---- API response envelopes ----
export interface Practice {
  id: string;
  name: string;
  tz: string;
}

export interface PatientInfo {
  id: string;
  firstName: string;
  lastName: string;
  birthdate: string;
}

export interface CoverageInfo {
  carrierName: string;
  payerKey: string;
  subscriberId: string;
  subscriberName: string;
  groupNumber: string | null;
  groupName: string | null;
  relationship: string;
}

export interface AppointmentInfo {
  startsAt: string;
  minutes: number;
  provider: string | null;
  cdtCodes: string[];
}

export interface VerificationRecord {
  id: string;
  status: VerificationStatus;
  displayStatus: DisplayStatus;
  scope: string;
  createdAt: string;
  completedAt: string | null;
}

export interface VerificationDetail {
  verification: VerificationRecord;
  patient: PatientInfo;
  coverage: CoverageInfo;
  appointment: AppointmentInfo;
  steps: VerificationStep[];
  snapshot: BenefitSnapshot | null;
  exceptions: VerificationException[];
  writebacks: WritebackCommand[];
}

export interface MetricsSummary {
  fullAutoRate: number;
  total: number;
  done: number;
  exceptions: number;
  avgDurationMs: number;
  byStep: Record<string, number>;
}

export interface ReviewTask {
  id: string;
  verificationId: string;
  patientName: string;
  payerKey: string;
  carrierName: string;
  reason: string;
  status: string;
  slaDueAt: string;
  createdAt: string;
  draft: BenefitBreakdown;
}
