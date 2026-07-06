import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Loader for docs/SEED-UNIVERSE.json. Used by the mock providers
 * (MockClearinghouse, SimulatedVoice) to produce deterministic payer-side
 * data keyed by subscriberId. This is dev/demo scaffolding only — the real
 * providers hit a clearinghouse / telephony stack.
 */

export interface SeedPlan {
  carrierName: string;
  employer: string;
  annualMax: number;
  dedIndividual: number;
  dedFamily: number | null;
  dedAppliesTo: string[];
  coverage: { preventive: number; basic: number; major: number; ortho: number };
  planYearStart: string; // "calendar" | "MM-DD"
  frequencies: Record<string, string>;
  waitingPeriodsMonths: Record<string, number>;
  downgrades: string[] | null;
  missingToothClause: boolean | null;
  cobRule: string | null;
  $sparse?: string | boolean;
  $phoneOnly?: string;
  $manualOnly?: string;
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
  usage?: Record<string, number | string>;
  terminated?: string;
  memberSince?: string;
  scenario: string;
}

export interface SeedUniverse {
  practice: { id: string; name: string; tz: string };
  portalCredentials: { username: string; password: string };
  plans: Record<string, SeedPlan>;
  members: SeedMember[];
}

let cached: SeedUniverse | null = null;

function findSeedPath(): string {
  // Walk up from this module looking for docs/SEED-UNIVERSE.json.
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "docs", "SEED-UNIVERSE.json");
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error("SEED-UNIVERSE.json not found walking up from " + fileURLToPath(import.meta.url));
}

export function loadSeed(): SeedUniverse {
  if (!cached) cached = JSON.parse(readFileSync(findSeedPath(), "utf8")) as SeedUniverse;
  return cached;
}

export function memberBySubscriberId(subscriberId: string): SeedMember | null {
  return loadSeed().members.find((m) => m.subscriberId === subscriberId) ?? null;
}

export function planForMember(m: SeedMember): SeedPlan | null {
  return loadSeed().plans[m.plan] ?? null;
}

export function payerKeyForMember(m: SeedMember): string {
  return m.plan.split("/")[0];
}
