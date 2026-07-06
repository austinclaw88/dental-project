import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Data layer for the mock payer portal. Everything rendered by the portal is
 * derived from docs/SEED-UNIVERSE.json (the single source of truth written by
 * the practice agent). No per-member HTML is hand-copied — the renderers read
 * these structures.
 *
 * If the seed file is missing we fall back to a tiny built-in universe covering
 * the required scenarios (terminated / frequency-exhausted / waiting-period /
 * clean) so the portal still boots for isolated development (see README).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface SeedPlan {
  carrierName: string;
  employer: string;
  annualMax: number;
  dedIndividual: number;
  dedFamily: number | null;
  dedAppliesTo: string[];
  coverage: { preventive: number; basic: number; major: number; ortho: number };
  planYearStart: string;
  frequencies: Record<string, string>;
  waitingPeriodsMonths: Record<string, number>;
  downgrades: string[] | null;
  missingToothClause: boolean | null;
  cobRule: string | null;
  $sparse?: unknown;
}

export interface SeedMember {
  subscriberId: string;
  patient: { first: string; last: string; birthdate: string };
  relationship: string;
  subscriberName?: string;
  plan: string; // "mock-delta/GRP-ACME"
  apptTime: string;
  minutes: number;
  provider: string;
  cdt: string[];
  usage?: {
    maxUsed?: number;
    dedIndividualMet?: number;
    prophyUsed?: number;
    prophyLast?: string;
    bwxUsed?: number;
    examUsed?: number;
  };
  memberSince?: string;
  terminated?: string; // "2026-05-31"
  scenario: string;
}

interface SeedUniverse {
  practice: { id: string; name: string; tz: string };
  portalCredentials: { username: string; password: string };
  plans: Record<string, SeedPlan>;
  members: SeedMember[];
}

const FREQ_LABELS: Record<string, { label: string; cdt: string }> = {
  prophylaxis: { label: "Prophy", cdt: "D1110" },
  bitewings: { label: "Bitewings", cdt: "D0274" },
  exam: { label: "Exam", cdt: "D0120" },
  fmx: { label: "FMX", cdt: "D0210" },
};

function loadSeed(): SeedUniverse {
  const candidates = [
    process.env.SEED_UNIVERSE_PATH,
    resolve(__dirname, "../../../docs/SEED-UNIVERSE.json"),
    resolve(process.cwd(), "docs/SEED-UNIVERSE.json"),
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    try {
      const raw = readFileSync(p, "utf8");
      return JSON.parse(raw) as SeedUniverse;
    } catch {
      /* try next */
    }
  }
  throw new Error(
    `mock-portal: could not locate docs/SEED-UNIVERSE.json (tried: ${candidates.join(", ")}). ` +
      `Set SEED_UNIVERSE_PATH to override.`,
  );
}

export const PAYER_KEYS = ["mock-delta", "mock-metlife"] as const;
export type PayerKey = (typeof PAYER_KEYS)[number];

export interface FrequencyRow {
  key: string;
  label: string;
  cdt: string;
  limit: string; // "2 per calendar_year"
  terse: string; // "2/CY" (delta terse label)
  usedCount: number | null;
  lastServiceDate: string | null;
}

/** A fully-resolved, render-ready view of one member on one payer portal. */
export interface MemberView {
  payerKey: PayerKey;
  subscriberId: string;
  groupNumber: string; // "GRP-ACME"
  planKey: string; // "mock-delta/GRP-ACME"
  carrierName: string;
  employer: string;
  patientName: string;
  subscriberName: string;
  relationship: string;
  birthdate: string;
  effectiveDate: string; // ISO
  terminationDate: string | null; // ISO, if terminated
  active: boolean;
  planYearStart: string;
  annualMax: number;
  maxUsed: number;
  maxRemaining: number;
  dedIndividual: number;
  dedIndividualMet: number;
  dedFamily: number | null;
  dedAppliesTo: string[];
  coverage: { preventive: number; basic: number; major: number; ortho: number };
  frequencies: FrequencyRow[];
  waitingPeriods: { category: string; months: number; effective: string; endsOn: string }[];
  downgrades: string[];
  missingToothClause: boolean | null;
  cobRule: string | null;
  sparse: boolean;
}

function addMonthsISO(iso: string, months: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function terseFreq(limit: string): string {
  // "2 per calendar_year" -> "2/CY"; "1 per 36 months" -> "1/36mo"; "2 per plan_year" -> "2/PY"
  const m = limit.match(/^(\d+)\s+per\s+(.+)$/);
  if (!m) return limit;
  const n = m[1];
  const unit = m[2];
  if (unit === "calendar_year") return `${n}/CY`;
  if (unit === "plan_year") return `${n}/PY`;
  const mo = unit.match(/(\d+)\s*months?/);
  if (mo) return `${n}/${mo[1]}mo`;
  return `${n}/${unit}`;
}

export class PortalData {
  private seed: SeedUniverse;
  /** payerKey -> subscriberId -> MemberView */
  private views = new Map<PayerKey, Map<string, MemberView>>();

  constructor(seed?: SeedUniverse) {
    this.seed = seed ?? loadSeed();
    this.build();
  }

  get credentials() {
    return this.seed.portalCredentials;
  }

  private build() {
    for (const key of PAYER_KEYS) this.views.set(key, new Map());
    for (const m of this.seed.members) {
      const [payerKey, groupNumber] = m.plan.split("/") as [PayerKey, string];
      if (!PAYER_KEYS.includes(payerKey)) continue; // portal only serves delta + metlife
      const plan = this.seed.plans[m.plan];
      if (!plan) continue;
      this.views.get(payerKey)!.set(m.subscriberId, this.toView(m, payerKey, groupNumber, plan));
    }
  }

  private toView(m: SeedMember, payerKey: PayerKey, groupNumber: string, plan: SeedPlan): MemberView {
    const sparse = plan.$sparse != null || payerKey === "mock-metlife";
    const usage = m.usage ?? {};
    const maxUsed = usage.maxUsed ?? 0;
    const effectiveDate =
      m.memberSince ?? this.planYearEffective(plan.planYearStart);
    const terminationDate = m.terminated ?? null;

    // Frequencies (delta shows used counts + last dates; metlife shows limit only).
    const freqs: FrequencyRow[] = Object.entries(plan.frequencies).map(([key, limit]) => {
      const meta = FREQ_LABELS[key] ?? { label: key, cdt: "" };
      let usedCount: number | null = null;
      let lastServiceDate: string | null = null;
      if (!sparse) {
        if (key === "prophylaxis") {
          usedCount = usage.prophyUsed ?? 0;
          lastServiceDate = usage.prophyLast ?? null;
        } else if (key === "bitewings") {
          usedCount = usage.bwxUsed ?? 0;
        } else if (key === "exam") {
          usedCount = usage.examUsed ?? 0;
        }
      }
      return {
        key,
        label: meta.label,
        cdt: meta.cdt,
        limit,
        terse: terseFreq(limit),
        usedCount,
        lastServiceDate,
      };
    });

    // Waiting periods.
    const waitingPeriods = Object.entries(plan.waitingPeriodsMonths).map(([category, months]) => ({
      category,
      months,
      effective: effectiveDate,
      endsOn: addMonthsISO(effectiveDate, months),
    }));

    return {
      payerKey,
      subscriberId: m.subscriberId,
      groupNumber,
      planKey: m.plan,
      carrierName: plan.carrierName,
      employer: plan.employer,
      patientName: `${m.patient.first} ${m.patient.last}`,
      subscriberName: m.subscriberName ?? `${m.patient.first} ${m.patient.last}`,
      relationship: m.relationship,
      birthdate: m.patient.birthdate,
      effectiveDate,
      terminationDate,
      active: terminationDate == null,
      planYearStart: plan.planYearStart,
      annualMax: plan.annualMax,
      maxUsed,
      maxRemaining: Math.max(0, plan.annualMax - maxUsed),
      dedIndividual: plan.dedIndividual,
      dedIndividualMet: usage.dedIndividualMet ?? 0,
      dedFamily: plan.dedFamily,
      dedAppliesTo: plan.dedAppliesTo,
      coverage: plan.coverage,
      frequencies: freqs,
      waitingPeriods,
      downgrades: sparse ? [] : plan.downgrades ?? [],
      missingToothClause: sparse ? null : plan.missingToothClause,
      cobRule: sparse ? null : plan.cobRule,
      sparse,
    };
  }

  private planYearEffective(planYearStart: string): string {
    // A plausible current-plan-year effective date for display.
    if (planYearStart === "calendar") return "2026-01-01";
    return `2025-${planYearStart}`; // e.g. "07-01" -> "2025-07-01"
  }

  hasPayer(payerKey: string): payerKey is PayerKey {
    return (PAYER_KEYS as readonly string[]).includes(payerKey);
  }

  getMember(payerKey: PayerKey, subscriberId: string): MemberView | null {
    return this.views.get(payerKey)?.get(subscriberId) ?? null;
  }

  listMembers(payerKey: PayerKey): MemberView[] {
    return [...(this.views.get(payerKey)?.values() ?? [])];
  }
}
