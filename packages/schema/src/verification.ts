import { z } from "zod";
import { BenefitBreakdown } from "./benefits.js";

/** Verification lifecycle (TDD §3.2 VerifyPatientWorkflow). */
export const VerificationStatus = z.enum([
  "PLANNED",
  "ELIGIBILITY",
  "PORTAL",
  "VOICE",
  "HUMAN_REVIEW",
  "NORMALIZE",
  "QA_GATE",
  "WRITEBACK",
  "DONE",
  "EXCEPTION",
  "FAILED",
]);
export type VerificationStatus = z.infer<typeof VerificationStatus>;

export const StepKind = z.enum(["eligibility", "portal", "voice", "human", "normalize", "qa", "writeback"]);
export type StepKind = z.infer<typeof StepKind>;

export const StepStatus = z.enum(["running", "succeeded", "failed", "skipped"]);
export type StepStatus = z.infer<typeof StepStatus>;

/** Why a full breakdown is (not) needed — planning rules, TDD §3.2. */
export const VerificationScope = z.enum(["eligibility_only", "full_breakdown"]);
export type VerificationScope = z.infer<typeof VerificationScope>;

export const ExceptionType = z.enum([
  "coverage_terminated",
  "plan_changed",
  "waiting_period_conflict",
  "frequency_conflict",
  "deductible_unmet_high_value",
  "low_confidence",
  "verification_failed",
  "connector_offline",
]);
export type ExceptionType = z.infer<typeof ExceptionType>;

export const ExceptionSeverity = z.enum(["info", "warning", "critical"]);

export const VerificationException = z.object({
  id: z.string(),
  verificationId: z.string(),
  type: ExceptionType,
  severity: ExceptionSeverity,
  /** One sentence: why this matters for TODAY's visit (PRD R17). */
  message: z.string(),
  resolvedBy: z.string().nullable(),
  resolvedAt: z.string().datetime().nullable(),
});
export type VerificationException = z.infer<typeof VerificationException>;

/** QA gate outcome (TDD §3.2): decides auto-writeback vs. human review. */
export const QaVerdict = z.object({
  pass: z.boolean(),
  completeness: z.number(), // 0..1 fraction of required fields populated
  minConfidenceMet: z.boolean(),
  validatorIssues: z.array(z.string()),
  routeTo: z.enum(["writeback", "human_review"]),
});
export type QaVerdict = z.infer<typeof QaVerdict>;

/** Writeback command applied by the connector inside the practice (TDD §3.1, PRD R13–R15). */
export const WritebackTarget = z.enum(["benefit_rows", "insplan_note", "insverify", "commlog", "document_pdf"]);

export const WritebackCommand = z.object({
  id: z.string(),
  verificationId: z.string(),
  practiceId: z.string(),
  target: WritebackTarget,
  /** target-specific payload; connector interprets (see docs/API-CONTRACT.md §Writeback payloads) */
  payload: z.record(z.unknown()),
  status: z.enum(["pending", "applied", "failed", "reverted"]),
  beforeImage: z.record(z.unknown()).nullable(),
});
export type WritebackCommand = z.infer<typeof WritebackCommand>;

export const BenefitSnapshot = z.object({
  verificationId: z.string(),
  breakdown: BenefitBreakdown,
  validatorIssues: z.array(z.string()).default([]),
});
export type BenefitSnapshot = z.infer<typeof BenefitSnapshot>;
