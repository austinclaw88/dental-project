/**
 * Domain knowledge tables: which codes payers substitute for which (alternate
 * benefit / "downgrade"), which codes are separately payable alongside which,
 * and which remark text legitimately explains a zero payment.
 *
 * These are the parts a practising dentist should review and extend — they are
 * deliberately small, explicit, and boring rather than clever.
 */

/** Billed code -> codes a payer commonly pays instead ("alternate benefit"). */
export const DOWNGRADE_PARTNERS: Record<string, string[]> = {
  // Porcelain/ceramic crown paid at a metal/PFM crown rate.
  D2740: ["D2751", "D2791", "D2792", "D2750", "D2752"],
  D2750: ["D2751", "D2752", "D2791", "D2792"],
  // Posterior composite paid at the amalgam rate — the classic dental downgrade.
  D2391: ["D2140", "D2150", "D2160", "D2161"],
  D2392: ["D2150", "D2140", "D2160", "D2161"],
  D2393: ["D2160", "D2150", "D2161", "D2140"],
  D2394: ["D2161", "D2160", "D2150", "D2140"],
  // Anterior composite occasionally downgraded to a resin/amalgam equivalent.
  D2335: ["D2330", "D2331", "D2332"],
  // Imaging family: FMX paid as bitewings, pano paid as bitewings.
  D0210: ["D0274", "D0272", "D0273", "D0330"],
  D0330: ["D0274", "D0272"],
  D0274: ["D0272", "D0270"],
  // Perio: osseous surgery paid as scaling & root planing.
  D4260: ["D4341"],
  D4261: ["D4342", "D4341"],
};

export interface BundlingRule {
  id: string;
  /** The code that got zeroed. */
  zeroedCode: string | ((code: string) => boolean);
  /** A companion on the same date (and, if requireSameTooth, the same tooth). */
  companionMatches: (code: string) => boolean;
  requireSameTooth: boolean;
  label: string;
  note: string;
}

const isCrown = (c: string) => /^D27\d\d$/.test(c);

export const BUNDLING_RULES: BundlingRule[] = [
  {
    id: "buildup_with_crown",
    zeroedCode: "D2950",
    companionMatches: isCrown,
    requireSameTooth: true,
    label: "Core build-up zeroed alongside a crown",
    note:
      "D2950 was allowed $0 on the same tooth and date as a crown. Build-ups are separately payable " +
      "under most PPO contracts when the tooth needs structural replacement; blanket bundling into the " +
      "crown fee is a contract question, not an adjudication fact.",
  },
  {
    id: "films_with_limited_exam",
    zeroedCode: (c) => c === "D0220" || c === "D0230",
    companionMatches: (c) => c === "D0140",
    requireSameTooth: false,
    label: "Periapical films zeroed alongside a limited exam",
    note:
      "Periapical images (D0220/D0230) were allowed $0 on the same date as a limited oral evaluation " +
      "(D0140). Diagnostic images are separately payable from the evaluation under standard PPO contracts.",
  },
  {
    id: "srp_with_perio_maintenance",
    zeroedCode: (c) => c === "D4341" || c === "D4342",
    companionMatches: (c) => c === "D4910",
    requireSameTooth: false,
    label: "Scaling & root planing zeroed alongside perio maintenance",
    note:
      "Quadrant SRP (D4341/D4342) was allowed $0 on the same date as perio maintenance (D4910). " +
      "Payers commonly bundle these on a date-of-service collision; the sequence and quadrant detail " +
      "usually support separate payment.",
  },
];

export function matchZeroedCode(rule: BundlingRule, code: string): boolean {
  return typeof rule.zeroedCode === "string" ? rule.zeroedCode === code : rule.zeroedCode(code);
}

/**
 * Free-text remark phrases that legitimately explain a small or zero payment.
 * Matched against the adjustment_codes cell after upper-casing and collapsing
 * punctuation to single spaces, so "Annual-Maximum met" and "ANNUAL MAXIMUM MET"
 * trip the same guard.
 */
export const EXPLANATORY_PHRASES: Array<{ phrase: string; kind: string }> = [
  { phrase: "ANNUAL MAX", kind: "annual_max" },
  { phrase: "ANNUALMAX", kind: "annual_max" },
  { phrase: "MAX MET", kind: "annual_max" },
  { phrase: "MAXIMUM MET", kind: "annual_max" },
  { phrase: "MAXIMUM REACHED", kind: "annual_max" },
  { phrase: "BENEFIT EXHAUST", kind: "annual_max" },
  { phrase: "BENEFITS EXHAUST", kind: "annual_max" },
  { phrase: "DEDUCTIBLE", kind: "deductible" },
  { phrase: "COINSURANCE", kind: "coinsurance" },
  { phrase: "CO INSURANCE", kind: "coinsurance" },
  { phrase: "COPAY", kind: "copay" },
  { phrase: "PATIENT RESP", kind: "patient_responsibility" },
  { phrase: "PT RESP", kind: "patient_responsibility" },
  { phrase: "NON COVERED", kind: "non_covered" },
  { phrase: "NONCOVERED", kind: "non_covered" },
  { phrase: "NOT COVERED", kind: "non_covered" },
  { phrase: "NOT A COVERED", kind: "non_covered" },
  { phrase: "FREQUENCY", kind: "frequency" },
  { phrase: "WAITING PERIOD", kind: "waiting_period" },
  { phrase: "MISSING TOOTH", kind: "missing_tooth_clause" },
  { phrase: "COB", kind: "coordination_of_benefits" },
  { phrase: "COORDINATION OF BENEFIT", kind: "coordination_of_benefits" },
  { phrase: "PRIMARY PAID", kind: "coordination_of_benefits" },
  { phrase: "PAID BY PRIMARY", kind: "coordination_of_benefits" },
  { phrase: "ALTERNATE BENEFIT", kind: "alternate_benefit" },
  { phrase: "LEAT", kind: "alternate_benefit" },
  { phrase: "DUPLICATE", kind: "duplicate" },
  { phrase: "TIMELY FILING", kind: "timely_filing" },
  { phrase: "PRE AUTH", kind: "authorization" },
  { phrase: "PREAUTH", kind: "authorization" },
  { phrase: "NOT ELIGIBLE", kind: "eligibility" },
  { phrase: "INELIGIBLE", kind: "eligibility" },
  { phrase: "TERMINATED", kind: "eligibility" },
];

/**
 * CARC (claim adjustment reason code) numbers that explain a zero payment.
 * Deliberately EXCLUDES 45 (over fee schedule) and 97 (bundled) — those are the
 * payer asserting exactly the behaviour we are auditing, not an explanation of it.
 */
export const EXPLANATORY_CARC: Record<number, string> = {
  1: "deductible",
  2: "coinsurance",
  3: "copay",
  22: "coordination_of_benefits",
  23: "coordination_of_benefits",
  26: "eligibility",
  27: "eligibility",
  29: "timely_filing",
  31: "eligibility",
  49: "frequency",
  96: "non_covered",
  119: "annual_max",
  151: "frequency",
  197: "authorization",
  204: "non_covered",
};

const CARC_TOKEN = /\b(?:CARC|CO|PR|OA|PI)\s*(\d{1,3})\b/g;

export function explanatoryMarkers(codes: string[]): string[] {
  if (codes.length === 0) return [];
  const blob = codes.join(" ").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
  if (blob === "") return [];
  const kinds = new Set<string>();
  for (const m of EXPLANATORY_PHRASES) {
    if (blob.includes(m.phrase)) kinds.add(m.kind);
  }
  CARC_TOKEN.lastIndex = 0;
  let hit: RegExpExecArray | null;
  while ((hit = CARC_TOKEN.exec(blob)) !== null) {
    const kind = EXPLANATORY_CARC[Number(hit[1])];
    if (kind) kinds.add(kind);
  }
  return [...kinds];
}

export function hasExplanatoryMarker(codes: string[]): boolean {
  return explanatoryMarkers(codes).length > 0;
}
