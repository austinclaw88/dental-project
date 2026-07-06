import type { BenefitBreakdown, ExceptionType } from "@nightshift/schema";

export interface ComputedException {
  type: ExceptionType;
  severity: "info" | "warning" | "critical";
  message: string;
}

const PROPHY = /^D11(10|20)$/;
/** "major"-value families for waiting-period / deductible relevance (crowns, prosth, implants). */
function isMajorCdt(code: string): boolean {
  return /^D2[7-9]\d\d$/.test(code) || /^D5[0-8]\d\d$/.test(code) || /^D6\d\d\d$/.test(code);
}
function cdtLabel(code: string): string {
  if (/^D27/.test(code)) return "crown";
  if (/^D6/.test(code)) return "implant/prosthetic";
  if (/^D5/.test(code)) return "denture/prosthetic";
  if (PROPHY.test(code)) return "prophy";
  return "procedure";
}

function limitCount(limit: string | null): number | null {
  if (!limit) return null;
  const m = limit.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * Exceptions from the finalized breakdown vs. TODAY's scheduled CDT codes
 * (API-CONTRACT step 8, PRD R16–R17). Every message states why it matters today.
 * `coverage_terminated` is raised earlier in the eligibility step, not here.
 */
export function computeExceptions(
  b: BenefitBreakdown,
  cdtCodes: string[],
  opts: { today?: Date } = {},
): ComputedException[] {
  const out: ComputedException[] = [];
  const today = opts.today ?? new Date();

  // ── frequency_conflict ──────────────────────────────────────────────────
  for (const code of cdtCodes) {
    const freq = b.frequencies.find((f) => f.cdtCodes.includes(code));
    if (!freq) continue;
    const used = freq.usedCount.value;
    const limit = limitCount(freq.limit.value);
    if (used != null && limit != null && used >= limit) {
      out.push({
        type: "frequency_conflict",
        severity: "warning",
        message:
          `${code} scheduled but ${used}/${limit} ${freq.key} used — ` +
          `patient owes full fee unless the plan-year resets.`,
      });
    }
  }

  // ── waiting_period_conflict ─────────────────────────────────────────────
  const majorScheduled = cdtCodes.filter(isMajorCdt);
  if (majorScheduled.length) {
    for (const wp of b.waitingPeriods) {
      if (wp.category !== "major") continue;
      const endsOn = wp.endsOn.value;
      if (endsOn && new Date(endsOn) > today) {
        const code = majorScheduled[0];
        out.push({
          type: "waiting_period_conflict",
          severity: "warning",
          message:
            `${code} (${cdtLabel(code)}) scheduled during the major-services waiting period — ` +
            `not covered until ${endsOn}; today's visit would be patient-pay.`,
        });
        break;
      }
    }
  }

  // ── deductible_unmet_high_value ─────────────────────────────────────────
  if (majorScheduled.length) {
    const ind = b.deductible.individual.value;
    const met = b.deductible.individualMet.value;
    if (ind != null && met != null && met < ind) {
      const code = majorScheduled[0];
      const remaining = ind - met;
      out.push({
        type: "deductible_unmet_high_value",
        severity: "info",
        message:
          `${code} (${cdtLabel(code)}) scheduled; only $${met} of the $${ind} individual deductible met — ` +
          `patient likely owes ~$${remaining} before major benefits apply today.`,
      });
    }
  }

  return out;
}
