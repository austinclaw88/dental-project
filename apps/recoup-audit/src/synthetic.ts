/**
 * Synthetic 12-month claims dataset with KNOWN, seeded leakage.
 *
 * The point of this file is falsifiability. Real audits have no answer key, so
 * the only way to know whether the detectors work — and, more importantly,
 * whether they hallucinate — is to build a dataset where every recoverable
 * dollar is labelled and every piece of legitimate adjudication is labelled too.
 * The demo then reports recall against the seeded dollars AND the false-positive
 * rate against the flagged dollars. Both numbers must be printed; only one of
 * them flatters us.
 *
 * Everything here is deterministic under the seed.
 */

import { toCsv } from "./csv.js";
import { normalizePayer } from "./mapping.js";
import { Rng, WeightedCycle } from "./rng.js";
import type { Cents, FindingType } from "./types.js";

export const DEFAULT_SEED = 20260801;
const WINDOW_START = "2025-07-01";
const WINDOW_DAYS = 364;
const TARGET_LINES = 1500;

type Category = "diagnostic" | "preventive" | "basic" | "major";

interface CodeDef {
  code: string;
  name: string;
  ucr: Cents;
  category: Category;
  tooth: boolean;
}

const CODES: CodeDef[] = [
  { code: "D0120", name: "Periodic oral evaluation", ucr: 6500, category: "diagnostic", tooth: false },
  { code: "D0140", name: "Limited oral evaluation", ucr: 9500, category: "diagnostic", tooth: false },
  { code: "D0150", name: "Comprehensive oral evaluation", ucr: 11500, category: "diagnostic", tooth: false },
  { code: "D0210", name: "Full mouth series", ucr: 17500, category: "diagnostic", tooth: false },
  { code: "D0220", name: "Periapical, first film", ucr: 3800, category: "diagnostic", tooth: true },
  { code: "D0230", name: "Periapical, additional film", ucr: 3200, category: "diagnostic", tooth: true },
  { code: "D0274", name: "Bitewings, four films", ucr: 8500, category: "diagnostic", tooth: false },
  { code: "D1110", name: "Prophylaxis, adult", ucr: 12500, category: "preventive", tooth: false },
  { code: "D1206", name: "Fluoride varnish", ucr: 4800, category: "preventive", tooth: false },
  { code: "D2140", name: "Amalgam, one surface", ucr: 19500, category: "basic", tooth: true },
  { code: "D2150", name: "Amalgam, two surfaces", ucr: 24500, category: "basic", tooth: true },
  { code: "D2160", name: "Amalgam, three surfaces", ucr: 29500, category: "basic", tooth: true },
  { code: "D2391", name: "Resin composite, one surface posterior", ucr: 24500, category: "basic", tooth: true },
  { code: "D2392", name: "Resin composite, two surfaces posterior", ucr: 30500, category: "basic", tooth: true },
  { code: "D2393", name: "Resin composite, three surfaces posterior", ucr: 36500, category: "basic", tooth: true },
  { code: "D2740", name: "Crown, porcelain/ceramic", ucr: 145000, category: "major", tooth: true },
  { code: "D2750", name: "Crown, porcelain fused to high noble metal", ucr: 138000, category: "major", tooth: true },
  { code: "D2950", name: "Core buildup, including any pins", ucr: 38500, category: "major", tooth: true },
  { code: "D3310", name: "Endodontic therapy, anterior", ucr: 85000, category: "major", tooth: true },
  { code: "D3330", name: "Endodontic therapy, molar", ucr: 135000, category: "major", tooth: true },
  { code: "D4341", name: "Periodontal scaling and root planing, 4+ teeth", ucr: 32500, category: "basic", tooth: false },
  { code: "D4342", name: "Periodontal scaling and root planing, 1-3 teeth", ucr: 21500, category: "basic", tooth: false },
  { code: "D4910", name: "Periodontal maintenance", ucr: 15500, category: "basic", tooth: false },
  { code: "D7140", name: "Extraction, erupted tooth", ucr: 22500, category: "basic", tooth: false },
];

const CODE_BY_ID = new Map(CODES.map((c) => [c.code, c]));

/** Which amalgam code a payer substitutes for which posterior composite. */
const COMPOSITE_TO_AMALGAM: Record<string, string> = {
  D2391: "D2140",
  D2392: "D2150",
  D2393: "D2160",
};

interface PayerDef {
  name: string;
  /** Multiplier on the practice's UCR fee to get the contracted rate. */
  factor: number;
  /** Share of claim volume (relative weight). */
  weight: number;
  coverage: Record<Category, number>;
  network?: string;
  behaviour:
    | "clean"
    | "downgrades_composites"
    | "leased_network_crowns"
    | "shaves_rates"
    | "second_legitimate_schedule";
}

const PAYERS: PayerDef[] = [
  {
    name: "Delta Dental Premier",
    factor: 0.72,
    weight: 22,
    coverage: { diagnostic: 100, preventive: 100, basic: 80, major: 50 },
    behaviour: "clean",
  },
  {
    name: "MetLife PDP",
    factor: 0.68,
    weight: 22,
    coverage: { diagnostic: 100, preventive: 100, basic: 80, major: 50 },
    network: "MetLife PDP Plus",
    behaviour: "leased_network_crowns",
  },
  {
    name: "Cigna DPPO",
    factor: 0.65,
    weight: 22,
    coverage: { diagnostic: 100, preventive: 100, basic: 80, major: 50 },
    behaviour: "downgrades_composites",
  },
  {
    name: "Aetna PPO",
    factor: 0.7,
    weight: 22,
    coverage: { diagnostic: 100, preventive: 100, basic: 80, major: 50 },
    behaviour: "shaves_rates",
  },
  {
    name: "Guardian DentalGuard",
    factor: 0.74,
    weight: 12,
    coverage: { diagnostic: 100, preventive: 100, basic: 80, major: 50 },
    behaviour: "second_legitimate_schedule",
  },
];

/** Seeded-leakage knobs, all exact rather than probabilistic where it matters. */
const DOWNGRADE_SHARE = 0.4;
const CLUSTER_SHARE = 0.3;
const CLUSTER_DISCOUNT = 0.15;
const BUNDLE_BUILDUP_P = 0.2;
const BUNDLE_FILM_P = 0.28;
const BUNDLE_SRP_P = 0.5;
const ZERO_PAID_P = 0.012;
/**
 * Plain below-schedule shaving: irregular amounts, so no cluster forms and only
 * the generic shortfall detector can catch it. Restricted to basic/major codes —
 * a 5% shave on a $45 exam is inside anyone's noise floor, which is the kind of
 * finding that makes a report look desperate.
 */
const SHAVE_P = 0.22;
const SHAVE_MIN = 0.05;
const SHAVE_MAX = 0.09;

/**
 * NOT leakage — a genuine second contract.
 *
 * One employer group is legitimately on a discounted schedule the practice
 * signed. The engine has no way to know that from the export, so it will flag
 * these lines, and they count against us as false positives. That is the point:
 * a false-positive rate of exactly zero on a dataset with no ambiguity in it
 * measures nothing. This is the ambiguity a real audit lives in, and the report's
 * "candidate ≠ collectable" caveat exists precisely for it.
 */
const ALT_SCHEDULE_GROUP = "GRP-1007";
const ALT_SCHEDULE_DISCOUNT = 0.12;
const ALT_SCHEDULE_CODES = ["D1110", "D0274", "D2392", "D4910"];
const ALT_SCHEDULE_LINES = 16;

/** Legitimate-variance knobs — these must NEVER be flagged. */
const DEDUCTIBLE_P = 0.16;
const ANNUAL_MAX_P = 0.035;
const NON_COVERED_P = 0.025;
const SECONDARY_P = 0.07;
const DEDUCTIBLE_CENTS = 5000;

export interface SeededLeak {
  rowIndex: number;
  type: FindingType;
  cents: Cents;
  note: string;
}

interface GenLine {
  rowIndex: number;
  claimId: string;
  serviceDate: string;
  payer: PayerDef;
  code: CodeDef;
  tooth?: string;
  patientId: string;
  billed: Cents;
  allowed: Cents;
  paid: Cents;
  patientPortion: Cents;
  deductible: Cents;
  writeoff: Cents;
  ordinal: number;
  adjustments: string[];
  legit?: string;
  leak?: { type: FindingType; cents: Cents; note: string };
  /**
   * Set on the companion procedure of a seeded bundling leak. Without it, a later
   * "non-covered" roll can zero the crown that the build-up was supposedly
   * bundled into — the engine then (correctly) refuses the finding, and the
   * answer key is wrong rather than the engine.
   */
  noLegit?: boolean;
  group: string;
}

export interface SyntheticDataset {
  csv: string;
  feesCsv: string;
  leaks: Map<number, SeededLeak>;
  totalSeededCents: Cents;
  seededByType: Record<string, { count: number; cents: Cents }>;
  legitimateCounts: Record<string, number>;
  lineCount: number;
  payerNames: string[];
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** Whole-dollar contracted rates: real PPO schedules are round, and round numbers cluster cleanly. */
function buildRates(rng: Rng): Map<string, Cents> {
  const rates = new Map<string, Cents>();
  for (const payer of PAYERS) {
    for (const code of CODES) {
      const jitter = rng.float(-0.04, 0.04);
      const cents = Math.round((code.ucr * payer.factor * (1 + jitter)) / 100) * 100;
      rates.set(`${normalizePayer(payer.name)}|${code.code}`, Math.max(cents, 500));
    }
  }
  return rates;
}

type VisitKind =
  | "recall"
  | "newpatient"
  | "restorative"
  | "crown"
  | "limited"
  | "srp"
  | "perio_maint"
  | "endo"
  | "extraction";

export function generateDataset(seed: number = DEFAULT_SEED): SyntheticDataset {
  const rng = new Rng(seed);
  const rates = buildRates(rng);
  const rateOf = (payer: PayerDef, code: string): Cents =>
    rates.get(`${normalizePayer(payer.name)}|${code}`) ?? 0;

  const visitKinds = new WeightedCycle<VisitKind>(
    [
      ["recall", 32],
      ["restorative", 26],
      ["crown", 12],
      ["limited", 8],
      ["perio_maint", 8],
      ["newpatient", 5],
      ["srp", 4],
      ["endo", 3],
      ["extraction", 2],
    ],
    rng,
  );
  const payerCycle = new WeightedCycle<PayerDef>(
    PAYERS.map((p) => [p, p.weight] as [PayerDef, number]),
    rng,
  );
  const compositeCycle = new WeightedCycle<string>(
    [
      ["D2391", 40],
      ["D2392", 35],
      ["D2393", 25],
    ],
    rng,
  );
  const amalgamCycle = new WeightedCycle<string>(
    [
      ["D2140", 40],
      ["D2150", 35],
      ["D2160", 25],
    ],
    rng,
  );
  const crownCycle = new WeightedCycle<string>(
    [
      ["D2740", 78],
      ["D2750", 22],
    ],
    rng,
  );

  const lines: GenLine[] = [];
  const deductibleUsed = new Map<string, Cents>();
  let claimSeq = 0;
  let patientSeq = 0;
  const patients: string[] = [];

  const posteriorTeeth = [2, 3, 4, 5, 12, 13, 14, 15, 18, 19, 20, 21, 28, 29, 30, 31];

  const emit = (
    claimId: string,
    date: string,
    payer: PayerDef,
    codeId: string,
    patientId: string,
    tooth: string | undefined,
    group: string,
    ordinal = 1,
  ): GenLine => {
    const code = CODE_BY_ID.get(codeId)!;
    const line: GenLine = {
      rowIndex: lines.length + 1,
      claimId,
      serviceDate: date,
      payer,
      code,
      tooth,
      patientId,
      billed: code.ucr,
      allowed: rateOf(payer, codeId),
      paid: 0,
      patientPortion: 0,
      deductible: 0,
      writeoff: 0,
      ordinal,
      adjustments: [],
      group,
    };
    lines.push(line);
    return line;
  };

  while (lines.length < TARGET_LINES) {
    const kind = visitKinds.next();
    const payer = payerCycle.next();
    const date = addDays(WINDOW_START, rng.int(0, WINDOW_DAYS));
    claimSeq += 1;
    const claimId = `CLM-${String(claimSeq).padStart(5, "0")}`;
    // A pool of recurring patients, so subscriber hashes repeat like real data.
    if (patients.length < 260 && (patients.length === 0 || rng.bool(0.55))) {
      patientSeq += 1;
      patients.push(`SUB-${String(100000 + patientSeq * 7)}`);
    }
    const patientId = rng.pick(patients);
    const tooth = () => String(rng.pick(posteriorTeeth));
    const group = `GRP-${1000 + (claimSeq % 40)}`;
    const emitted: GenLine[] = [];

    switch (kind) {
      case "recall": {
        emitted.push(emit(claimId, date, payer, "D0120", patientId, undefined, group));
        emitted.push(emit(claimId, date, payer, "D1110", patientId, undefined, group));
        if (rng.bool(0.55)) emitted.push(emit(claimId, date, payer, "D0274", patientId, undefined, group));
        if (rng.bool(0.15)) emitted.push(emit(claimId, date, payer, "D1206", patientId, undefined, group));
        break;
      }
      case "newpatient": {
        emitted.push(emit(claimId, date, payer, "D0150", patientId, undefined, group));
        emitted.push(emit(claimId, date, payer, "D0210", patientId, undefined, group));
        emitted.push(emit(claimId, date, payer, "D1110", patientId, undefined, group));
        break;
      }
      case "restorative": {
        const n = rng.bool(0.35) ? 2 : 1;
        for (let i = 0; i < n; i++) {
          const useComposite = rng.bool(0.75);
          const codeId = useComposite ? compositeCycle.next() : amalgamCycle.next();
          emitted.push(emit(claimId, date, payer, codeId, patientId, tooth(), group));
        }
        break;
      }
      case "crown": {
        const t = tooth();
        const crown = crownCycle.next();
        emitted.push(emit(claimId, date, payer, crown, patientId, t, group));
        if (rng.bool(0.72)) emitted.push(emit(claimId, date, payer, "D2950", patientId, t, group));
        break;
      }
      case "limited": {
        emitted.push(emit(claimId, date, payer, "D0140", patientId, undefined, group));
        emitted.push(emit(claimId, date, payer, "D0220", patientId, tooth(), group));
        if (rng.bool(0.4)) emitted.push(emit(claimId, date, payer, "D0230", patientId, tooth(), group));
        break;
      }
      case "srp": {
        emitted.push(emit(claimId, date, payer, "D4341", patientId, undefined, group));
        emitted.push(emit(claimId, date, payer, rng.bool(0.6) ? "D4341" : "D4342", patientId, undefined, group));
        if (rng.bool(0.28)) emitted.push(emit(claimId, date, payer, "D4910", patientId, undefined, group));
        break;
      }
      case "perio_maint": {
        emitted.push(emit(claimId, date, payer, "D4910", patientId, undefined, group));
        if (rng.bool(0.35)) emitted.push(emit(claimId, date, payer, "D0274", patientId, undefined, group));
        break;
      }
      case "endo": {
        emitted.push(emit(claimId, date, payer, rng.bool(0.6) ? "D3330" : "D3310", patientId, tooth(), group));
        break;
      }
      case "extraction": {
        emitted.push(emit(claimId, date, payer, "D7140", patientId, undefined, group));
        break;
      }
    }

    // Secondary coverage: a duplicate claim on the same services, adjudicated by a
    // second carrier. Perfectly normal, and a rich source of false positives if
    // the engine is careless.
    if (emitted.length > 0 && rng.bool(SECONDARY_P)) {
      claimSeq += 1;
      const secId = `CLM-${String(claimSeq).padStart(5, "0")}S`;
      for (const src of emitted) {
        const dup = emit(secId, date, payer, src.code.code, patientId, src.tooth, group, 2);
        dup.legit = "secondary_claim";
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Seeded leakage — exact counts where the mode matters, probabilistic where it
  // does not, so reconstruction is never at the mercy of a lucky draw.
  // ---------------------------------------------------------------------------

  // 1. Composite downgrades: one payer pays the amalgam rate on posterior composites.
  const downgradePayer = PAYERS.find((p) => p.behaviour === "downgrades_composites")!;
  for (const compositeCode of Object.keys(COMPOSITE_TO_AMALGAM)) {
    const eligible = lines.filter(
      (l) => l.payer === downgradePayer && l.code.code === compositeCode && l.ordinal === 1,
    );
    const take = Math.floor(eligible.length * DOWNGRADE_SHARE);
    for (const line of rng.shuffle(eligible).slice(0, take)) {
      const partner = COMPOSITE_TO_AMALGAM[compositeCode]!;
      const partnerRate = rateOf(downgradePayer, partner);
      const own = rateOf(downgradePayer, compositeCode);
      if (partnerRate <= 0 || partnerRate >= own) continue;
      line.allowed = partnerRate;
      line.adjustments.push("CARC 45 ALTERNATE BENEFIT APPLIED");
      line.leak = {
        type: "downgrade_suspect",
        cents: own - partnerRate,
        note: `${compositeCode} paid at ${partner} rate`,
      };
    }
  }

  // 2. Leased-network repricing: one payer allows a flat 15% under schedule on a
  //    slice of crowns, always the same amount per code — the cluster signature.
  const clusterPayer = PAYERS.find((p) => p.behaviour === "leased_network_crowns")!;
  for (const crownCode of ["D2740", "D2750"]) {
    const eligible = lines.filter(
      (l) => l.payer === clusterPayer && l.code.code === crownCode && l.ordinal === 1,
    );
    if (eligible.length < 8) continue;
    const own = rateOf(clusterPayer, crownCode);
    const repriced = Math.round((own * (1 - CLUSTER_DISCOUNT)) / 100) * 100;
    const take = Math.max(3, Math.round(eligible.length * CLUSTER_SHARE));
    for (const line of rng.shuffle(eligible).slice(0, take)) {
      line.allowed = repriced;
      line.leak = {
        type: "repriced_rate_cluster",
        cents: own - repriced,
        note: `${crownCode} repriced ${Math.round(CLUSTER_DISCOUNT * 100)}% under schedule`,
      };
    }
  }

  // 3. Plain below-schedule shaving: one payer quietly allows 4–9% under its own
  //    schedule on scattered lines. Every amount is different, so no cluster
  //    forms and only the generic shortfall detector can catch it.
  const shavePayer = PAYERS.find((p) => p.behaviour === "shaves_rates")!;
  for (const line of lines) {
    if (line.payer !== shavePayer || line.ordinal !== 1 || line.leak) continue;
    // Systematic, not random: the shave lands on this payer's basic-restorative
    // and perio schedule — the classes where a real practice has enough volume
    // for the pattern to be visible at all.
    if (line.code.category !== "basic") continue;
    if (!rng.bool(SHAVE_P)) continue;
    const own = rateOf(line.payer, line.code.code);
    const shaved = Math.round((own * (1 - rng.float(SHAVE_MIN, SHAVE_MAX))) / 100) * 100;
    if (shaved <= 0 || own - shaved < 200) continue;
    line.allowed = shaved;
    line.leak = {
      type: "below_schedule",
      cents: own - shaved,
      note: `${line.code.code} allowed under this payer's own schedule`,
    };
  }

  // 3b. The legitimate second contract (see ALT_SCHEDULE_GROUP above). No leak
  //     record is written for these lines — anything the engine flags here is
  //     counted as a false positive, which is exactly what it is.
  const altPayer = PAYERS.find((p) => p.behaviour === "second_legitimate_schedule")!;
  const altEligible = lines.filter(
    (l) => l.payer === altPayer && l.ordinal === 1 && !l.leak && ALT_SCHEDULE_CODES.includes(l.code.code),
  );
  for (const line of rng.shuffle(altEligible).slice(0, ALT_SCHEDULE_LINES)) {
    const own = rateOf(altPayer, line.code.code);
    line.group = ALT_SCHEDULE_GROUP;
    line.allowed = Math.round((own * (1 - ALT_SCHEDULE_DISCOUNT)) / 100) * 100;
    line.legit = "second_contracted_schedule";
  }

  // 4. Bundled-to-zero build-ups, films and SRP, scattered across all payers.
  const byGroupDate = new Map<string, GenLine[]>();
  for (const l of lines) {
    const k = `${l.claimId}|${l.serviceDate}`;
    const arr = byGroupDate.get(k);
    if (arr) arr.push(l);
    else byGroupDate.set(k, [l]);
  }
  for (const group of byGroupDate.values()) {
    if (group[0]!.ordinal !== 1) continue;
    const zero = (line: GenLine, companion: GenLine, note: string) => {
      const rate = rateOf(line.payer, line.code.code);
      line.allowed = 0;
      line.adjustments.push("CARC 97 BENEFIT INCLUDED IN ANOTHER SERVICE");
      line.leak = { type: "bundled_to_zero", cents: rate, note };
      companion.noLegit = true;
    };
    const buildup = group.find((l) => l.code.code === "D2950" && !l.leak);
    const crown = group.find((l) => /^D27[45]0$/.test(l.code.code) && !l.leak);
    if (buildup && crown && buildup.tooth === crown.tooth && rng.bool(BUNDLE_BUILDUP_P)) {
      zero(buildup, crown, "build-up bundled into crown");
    }
    const film = group.find((l) => (l.code.code === "D0220" || l.code.code === "D0230") && !l.leak);
    const limited = group.find((l) => l.code.code === "D0140" && !l.leak);
    if (film && limited && rng.bool(BUNDLE_FILM_P)) {
      zero(film, limited, "periapical bundled into limited exam");
    }
    const srp = group.find((l) => (l.code.code === "D4341" || l.code.code === "D4342") && !l.leak);
    const maint = group.find((l) => l.code.code === "D4910" && !l.leak);
    if (srp && maint && rng.bool(BUNDLE_SRP_P)) {
      zero(srp, maint, "SRP bundled into perio maintenance");
    }
  }

  // ---------------------------------------------------------------------------
  // Legitimate adjudication + payment maths.
  // ---------------------------------------------------------------------------
  const legitimateCounts: Record<string, number> = {
    deductible_applied: 0,
    annual_max_met: 0,
    non_covered_billed_to_patient: 0,
    secondary_claim: 0,
    ordinary_coinsurance: 0,
    second_contracted_schedule: 0,
  };

  for (const line of lines) {
    const cov = line.payer.coverage[line.code.category];

    // 5. Unexplained zero payments (seeded leakage).
    if (!line.leak && line.ordinal === 1 && line.allowed > 0 && rng.bool(ZERO_PAID_P)) {
      line.paid = 0;
      line.patientPortion = 0;
      line.deductible = 0;
      line.writeoff = line.billed - line.allowed;
      line.leak = { type: "zero_paid_no_reason", cents: line.allowed, note: "allowed but never paid" };
      continue;
    }

    if (line.leak?.type === "bundled_to_zero") {
      line.paid = 0;
      line.patientPortion = 0;
      line.writeoff = line.billed;
      continue;
    }

    // Rate-deviation leaks pay out normally on the (reduced) allowed amount. No
    // deductible, no annual max, no non-covered flag is layered on top of them:
    // the seeded dollar figure has to mean exactly one thing for the
    // reconciliation to be worth reading.
    if (
      line.leak?.type === "downgrade_suspect" ||
      line.leak?.type === "repriced_rate_cluster" ||
      line.leak?.type === "below_schedule" ||
      line.legit === "second_contracted_schedule"
    ) {
      if (line.legit === "second_contracted_schedule") {
        legitimateCounts.second_contracted_schedule! += 1;
      }
      line.paid = Math.round((line.allowed * cov) / 100);
      line.patientPortion = line.allowed - line.paid;
      line.writeoff = line.billed - line.allowed;
      if (line.patientPortion > 0) legitimateCounts.ordinary_coinsurance! += 1;
      continue;
    }

    if (line.legit === "secondary_claim") {
      legitimateCounts.secondary_claim! += 1;
      line.paid = rng.bool(0.45) ? Math.round(line.allowed * 0.2) : 0;
      line.patientPortion = line.allowed - line.paid;
      line.writeoff = line.billed - line.allowed;
      line.adjustments.push("CARC 23 COB PRIMARY PAID");
      continue;
    }

    // Non-covered: the payer allows nothing and the patient is billed the full
    // fee. The practice is not out the money — flagging this is a false positive.
    if (line.ordinal === 1 && !line.noLegit && rng.bool(NON_COVERED_P)) {
      line.legit = "non_covered";
      legitimateCounts.non_covered_billed_to_patient! += 1;
      line.allowed = 0;
      line.paid = 0;
      line.patientPortion = line.billed;
      line.writeoff = 0;
      line.adjustments.push("CARC 96 NON-COVERED SERVICE");
      continue;
    }

    // Annual maximum exhausted: allowed stands, payer pays nothing, patient owes it.
    if (line.code.category === "major" && rng.bool(ANNUAL_MAX_P)) {
      line.legit = "annual_max";
      legitimateCounts.annual_max_met! += 1;
      line.paid = 0;
      line.patientPortion = line.allowed;
      line.writeoff = line.billed - line.allowed;
      line.adjustments.push("CARC 119 ANNUAL MAXIMUM MET");
      continue;
    }

    // Deductible, tracked per patient per plan year.
    let ded = 0;
    if (line.code.category !== "preventive" && line.code.category !== "diagnostic" && rng.bool(DEDUCTIBLE_P)) {
      const year = line.serviceDate.slice(0, 4);
      const key = `${line.patientId}|${normalizePayer(line.payer.name)}|${year}`;
      const used = deductibleUsed.get(key) ?? 0;
      const remaining = Math.max(0, DEDUCTIBLE_CENTS - used);
      ded = Math.min(remaining, line.allowed);
      if (ded > 0) {
        deductibleUsed.set(key, used + ded);
        line.legit = line.legit ?? "deductible";
        legitimateCounts.deductible_applied! += 1;
        line.adjustments.push("CARC 1 DEDUCTIBLE");
      }
    }

    line.deductible = ded;
    line.paid = Math.round(((line.allowed - ded) * cov) / 100);
    line.patientPortion = line.allowed - ded - line.paid;
    line.writeoff = line.billed - line.allowed;
    if (line.patientPortion > 0) legitimateCounts.ordinary_coinsurance! += 1;
  }

  // ---------------------------------------------------------------------------
  // Serialise.
  // ---------------------------------------------------------------------------
  const leaks = new Map<number, SeededLeak>();
  const seededByType: Record<string, { count: number; cents: Cents }> = {};
  let totalSeededCents = 0;
  for (const line of lines) {
    if (!line.leak) continue;
    leaks.set(line.rowIndex, {
      rowIndex: line.rowIndex,
      type: line.leak.type,
      cents: line.leak.cents,
      note: line.leak.note,
    });
    totalSeededCents += line.leak.cents;
    const b = (seededByType[line.leak.type] ??= { count: 0, cents: 0 });
    b.count += 1;
    b.cents += line.leak.cents;
  }

  const headers = [
    "claim_id",
    "service_date",
    "payer_name",
    "cdt_code",
    "billed_fee",
    "allowed_amount",
    "paid_amount",
    "plan_or_group",
    "subscriber_id",
    "tooth",
    "patient_portion",
    "writeoff_amount",
    "deductible_applied",
    "adjustment_codes",
    "claim_ordinal",
    "network_name",
    "coverage_pct",
  ];
  const d = (c: Cents) => (c / 100).toFixed(2);
  const csv = toCsv(
    headers,
    lines.map((l) => ({
      claim_id: l.claimId,
      service_date: l.serviceDate,
      payer_name: l.payer.name,
      cdt_code: l.code.code,
      billed_fee: d(l.billed),
      allowed_amount: d(l.allowed),
      paid_amount: d(l.paid),
      plan_or_group: l.group,
      subscriber_id: l.patientId,
      tooth: l.tooth ?? "",
      patient_portion: d(l.patientPortion),
      writeoff_amount: d(l.writeoff),
      deductible_applied: d(l.deductible),
      adjustment_codes: l.adjustments.join(" | "),
      claim_ordinal: l.ordinal === 2 ? "secondary" : "primary",
      network_name: l.payer.network ?? "",
      coverage_pct: String(l.payer.coverage[l.code.category]),
    })),
  );

  const feesCsv = toCsv(
    ["payer_name", "cdt_code", "contracted_rate", "effective_from", "effective_to"],
    PAYERS.flatMap((p) =>
      CODES.map((c) => ({
        payer_name: p.name,
        cdt_code: c.code,
        contracted_rate: d(rateOf(p, c.code)),
        effective_from: WINDOW_START,
        effective_to: addDays(WINDOW_START, WINDOW_DAYS),
      })),
    ),
  );

  return {
    csv,
    feesCsv,
    leaks,
    totalSeededCents,
    seededByType,
    legitimateCounts,
    lineCount: lines.length,
    payerNames: PAYERS.map((p) => p.name),
  };
}
