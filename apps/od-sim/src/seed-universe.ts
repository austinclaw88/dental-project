import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Loader + types for docs/SEED-UNIVERSE.json — the single source of truth for
 * dev/demo data. od-sim seeds practice tables from it; the connector derives its
 * carrier->payerKey map from it. Path is resolved relative to this file so it
 * works regardless of cwd.
 */

export interface SeedPlan {
  carrierName: string;
  employer: string;
  annualMax: number;
  dedIndividual: number;
  dedFamily: number | null;
  coverage: { preventive: number; basic: number; major: number; ortho: number };
  [k: string]: unknown;
}

export interface SeedMember {
  subscriberId: string;
  patient: { first: string; last: string; birthdate: string };
  relationship: "self" | "spouse" | "child" | "other";
  subscriberName?: string;
  plan: string; // e.g. "mock-delta/GRP-ACME"
  apptTime: string; // "HH:MM" practice-local
  minutes: number;
  provider: string;
  cdt: string[];
  terminated?: string;
  scenario: string;
  [k: string]: unknown;
}

export interface SeedUniverse {
  practice: { id: string; name: string; tz: string };
  portalCredentials: { username: string; password: string };
  plans: Record<string, SeedPlan>;
  members: SeedMember[];
}

const SEED_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "docs",
  "SEED-UNIVERSE.json",
);

let cached: SeedUniverse | null = null;

export function loadSeedUniverse(): SeedUniverse {
  if (!cached) cached = JSON.parse(readFileSync(SEED_PATH, "utf8")) as SeedUniverse;
  return cached;
}

/** planKey "mock-delta/GRP-ACME" -> { payerKey: "mock-delta", groupNum: "GRP-ACME" } */
export function splitPlanKey(planKey: string): { payerKey: string; groupNum: string } {
  const idx = planKey.indexOf("/");
  return { payerKey: planKey.slice(0, idx), groupNum: planKey.slice(idx + 1) };
}

/**
 * Derive the carrier-name -> payerKey map from SEED-UNIVERSE plan keys.
 * The payerKey is the prefix of each plan key; the carrier name is on the plan.
 * e.g. "Delta Dental MockState" -> "mock-delta".
 */
export function carrierToPayerKeyMap(uni: SeedUniverse = loadSeedUniverse()): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [planKey, plan] of Object.entries(uni.plans)) {
    map[plan.carrierName] = splitPlanKey(planKey).payerKey;
  }
  return map;
}
