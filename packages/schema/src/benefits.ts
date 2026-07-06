import { z } from "zod";

/**
 * Canonical BenefitBreakdown — the system's lingua franca (TDD §4, PRD R6–R8).
 *
 * Every extracted field is wrapped in FieldValue: value + source provenance +
 * confidence + retrieved-at. A field the payer will not disclose is present
 * with unavailableReason (never silently blank — PRD R8).
 */

export const FieldSource = z.enum([
  "portal", // captured from payer portal (artifact = screenshot/DOM)
  "x12_271", // clearinghouse eligibility response segment
  "voice_call", // extracted from payer phone call transcript
  "human", // entered/corrected by human reviewer
  "pms", // carried from OpenDental records
]);
export type FieldSource = z.infer<typeof FieldSource>;

export const Confidence = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof Confidence>;

export const Provenance = z.object({
  source: FieldSource,
  /** artifact id in the artifact store (screenshot, DOM capture, transcript, raw 271) */
  artifactId: z.string().nullable().default(null),
  /** locator within the artifact: CSS selector, X12 segment path, transcript timestamp (s), page anchor */
  locator: z.string().nullable().default(null),
  retrievedAt: z.string().datetime(),
});
export type Provenance = z.infer<typeof Provenance>;

export function fieldValue<T extends z.ZodTypeAny>(valueSchema: T) {
  return z.object({
    value: valueSchema.nullable(),
    provenance: Provenance.nullable().default(null),
    confidence: Confidence.default("low"),
    /** set when the payer explicitly would not disclose this field (PRD R8) */
    unavailableReason: z.string().nullable().default(null),
  });
}

const fStr = fieldValue(z.string());
const fNum = fieldValue(z.number());
const fBool = fieldValue(z.boolean());
const fDate = fieldValue(z.string()); // ISO date

export const CoverageCategory = z.enum([
  "preventive",
  "basic",
  "major",
  "ortho",
]);
export type CoverageCategory = z.infer<typeof CoverageCategory>;

/**
 * CDT-range coverage rule — ordered, most-specific-first; mirrors OpenDental
 * benefit-row semantics to ease writeback (TDD §4).
 */
export const CdtCoverageRule = z.object({
  cdtFrom: z.string(), // e.g. "D0100"
  cdtTo: z.string(), // e.g. "D0999"
  category: CoverageCategory.nullable(),
  percent: fieldValue(z.number()),
  notes: z.string().nullable().default(null),
});
export type CdtCoverageRule = z.infer<typeof CdtCoverageRule>;

export const FrequencyLimitation = z.object({
  /** e.g. "prophylaxis", "bitewings", "fmx", "exam", "srp_per_quadrant", "crown_per_tooth" */
  key: z.string(),
  cdtCodes: z.array(z.string()).default([]),
  /** e.g. "2 per calendar_year", "1 per 36 months", "1 per 60 months per tooth" */
  limit: fieldValue(z.string()),
  usedCount: fieldValue(z.number()),
  lastServiceDate: fDate,
  nextEligibleDate: fDate,
});
export type FrequencyLimitation = z.infer<typeof FrequencyLimitation>;

export const WaitingPeriod = z.object({
  category: CoverageCategory,
  months: fieldValue(z.number()),
  endsOn: fDate,
});

export const DowngradeClause = z.object({
  /** e.g. "posterior_composite_to_amalgam", "crown_pfm_to_base_metal" */
  key: z.string(),
  description: fieldValue(z.string()),
  applies: fBool,
});

export const BenefitBreakdown = z.object({
  schemaVersion: z.literal("1.0"),

  planStatus: z.object({
    active: fBool,
    effectiveDate: fDate,
    terminationDate: fDate,
    planYearStart: fieldValue(z.string()), // "MM-DD" or "calendar"
  }),

  annualMaximum: z.object({
    total: fNum,
    used: fNum,
    remaining: fNum,
  }),

  deductible: z.object({
    individual: fNum,
    individualMet: fNum,
    family: fNum,
    familyMet: fNum,
    appliesTo: fieldValue(z.array(CoverageCategory)),
  }),

  categoryCoverage: z.object({
    preventive: fNum, // percent 0-100
    basic: fNum,
    major: fNum,
    ortho: fNum,
  }),

  cdtRules: z.array(CdtCoverageRule).default([]),
  frequencies: z.array(FrequencyLimitation).default([]),
  waitingPeriods: z.array(WaitingPeriod).default([]),
  downgrades: z.array(DowngradeClause).default([]),

  missingToothClause: fBool,
  orthoLifetimeMax: fNum,
  orthoLifetimeUsed: fNum,
  cobRule: fieldValue(z.string()), // e.g. "standard", "non_duplication", "maintenance_of_benefits"
  assignmentOfBenefits: fBool,
  feeScheduleName: fStr,

  notes: z.array(z.string()).default([]),
});
export type BenefitBreakdown = z.infer<typeof BenefitBreakdown>;

/** A minimal empty breakdown with every field present-but-null (low confidence). */
export function emptyBreakdown(): BenefitBreakdown {
  return BenefitBreakdown.parse({
    schemaVersion: "1.0",
    planStatus: {
      active: { value: null },
      effectiveDate: { value: null },
      terminationDate: { value: null },
      planYearStart: { value: null },
    },
    annualMaximum: { total: { value: null }, used: { value: null }, remaining: { value: null } },
    deductible: {
      individual: { value: null },
      individualMet: { value: null },
      family: { value: null },
      familyMet: { value: null },
      appliesTo: { value: null },
    },
    categoryCoverage: {
      preventive: { value: null },
      basic: { value: null },
      major: { value: null },
      ortho: { value: null },
    },
    missingToothClause: { value: null },
    orthoLifetimeMax: { value: null },
    orthoLifetimeUsed: { value: null },
    cobRule: { value: null },
    assignmentOfBenefits: { value: null },
    feeScheduleName: { value: null },
  });
}

/**
 * Deterministic cross-field validators (TDD §3.7). Returns human-readable
 * violation strings; empty array = clean.
 */
export function validateBreakdown(b: BenefitBreakdown): string[] {
  const issues: string[] = [];
  const { total, used, remaining } = b.annualMaximum;
  if (total.value != null && used.value != null && used.value > total.value) {
    issues.push(`annualMaximum.used (${used.value}) exceeds total (${total.value})`);
  }
  if (
    total.value != null &&
    used.value != null &&
    remaining.value != null &&
    Math.abs(total.value - used.value - remaining.value) > 0.01
  ) {
    issues.push(`annualMaximum total-used != remaining`);
  }
  for (const key of ["preventive", "basic", "major", "ortho"] as const) {
    const v = b.categoryCoverage[key].value;
    if (v != null && (v < 0 || v > 100)) issues.push(`categoryCoverage.${key} out of range: ${v}`);
  }
  if (
    b.deductible.individual.value != null &&
    b.deductible.individualMet.value != null &&
    b.deductible.individualMet.value > b.deductible.individual.value
  ) {
    issues.push(`deductible met exceeds deductible`);
  }
  for (const r of b.cdtRules) {
    const v = r.percent.value;
    if (v != null && (v < 0 || v > 100)) issues.push(`cdtRule ${r.cdtFrom}-${r.cdtTo} percent out of range`);
    if (!/^D\d{4}$/.test(r.cdtFrom) || !/^D\d{4}$/.test(r.cdtTo)) {
      issues.push(`cdtRule range not CDT-shaped: ${r.cdtFrom}-${r.cdtTo}`);
    }
  }
  return issues;
}
