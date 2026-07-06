import { type BenefitBreakdown, type QaVerdict, validateBreakdown } from "@nightshift/schema";

/**
 * Required fields for QA completeness (API-CONTRACT §Extraction/QA gate).
 * completeness = (# populated) / REQUIRED_FIELDS.length, threshold ≥ 0.7.
 */
export const REQUIRED_FIELDS = [
  "planStatus.active",
  "annualMaximum.total",
  "annualMaximum.remaining",
  "deductible.individual",
  "deductible.individualMet",
  "categoryCoverage.preventive",
  "categoryCoverage.basic",
  "categoryCoverage.major",
  "categoryCoverage.ortho",
] as const;

/** Critical fields that must NOT be low-confidence to auto-writeback. */
export const CRITICAL_FIELDS = [
  "planStatus.active",
  "categoryCoverage.preventive",
  "categoryCoverage.basic",
  "categoryCoverage.major",
  "categoryCoverage.ortho",
] as const;

const COMPLETENESS_THRESHOLD = 0.7;

interface Fv {
  value: unknown;
  confidence: string;
}

function fieldAt(b: BenefitBreakdown, path: string): Fv {
  const [group, key] = path.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (b as any)[group][key] as Fv;
}

export function computeQa(b: BenefitBreakdown): QaVerdict {
  const populated = REQUIRED_FIELDS.filter((p) => fieldAt(b, p).value != null).length;
  const completeness = populated / REQUIRED_FIELDS.length;

  const validatorIssues = validateBreakdown(b);

  const lowConfidenceCritical = CRITICAL_FIELDS.filter((p) => {
    const f = fieldAt(b, p);
    return f.value != null && f.confidence === "low";
  });
  const minConfidenceMet = lowConfidenceCritical.length === 0;

  const pass = completeness >= COMPLETENESS_THRESHOLD && validatorIssues.length === 0 && minConfidenceMet;

  return {
    pass,
    completeness,
    minConfidenceMet,
    validatorIssues,
    routeTo: pass ? "writeback" : "human_review",
  };
}
