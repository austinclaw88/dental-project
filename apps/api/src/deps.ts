import type pg from "pg";
import { getPool } from "@nightshift/db";
import type {
  ArtifactStore,
  EligibilityProvider,
  ExtractionProvider,
  RawCapture,
  SubscriberQuery,
  VoicePipeline,
} from "@nightshift/schema";
import { FsArtifactStore } from "./artifacts/store.js";
import { type Config, loadConfig } from "./config.js";
import { MockClearinghouse } from "./providers/clearinghouse.js";
import { makeExtractorFactory } from "./providers/extractor/factory.js";
import { SimulatedVoice } from "./providers/voice.js";

/**
 * Minimal shape of a portal adapter (mirrors packages/portal PayerAdapter).
 * We depend on the seam, not the package — the registry is injected, and the
 * default wiring imports @nightshift/portal defensively (absence must not crash).
 */
export interface PayerAdapter {
  payerKey: string;
  capabilities(): Record<string, boolean>;
  fetchBreakdown(q: SubscriberQuery, deps: { artifacts: ArtifactStore }): Promise<RawCapture[]>;
}

export type AdapterRegistry = (payerKey: string) => PayerAdapter | null;

/** Everything the server + workflow need, injected for testability. */
export interface Deps {
  pool: pg.Pool;
  config: Config;
  artifacts: ArtifactStore;
  eligibility: EligibilityProvider;
  makeExtractor: (payerKey: string) => ExtractionProvider;
  voice: VoicePipeline;
  getAdapter: AdapterRegistry;
}

/**
 * Real dependency wiring for `npm run dev`. Portal package is optional: if
 * @nightshift/portal is absent or throws, we return a null-adapter registry so
 * the API still boots and every verification falls through to voice/human.
 */
export async function buildDefaultDeps(config: Config = loadConfig()): Promise<Deps> {
  const pool = getPool();
  const artifacts = new FsArtifactStore(config.artifactsDir, pool);
  const getAdapter = await loadPortalRegistry();
  return {
    pool,
    config,
    artifacts,
    eligibility: new MockClearinghouse(artifacts),
    makeExtractor: makeExtractorFactory(config),
    voice: new SimulatedVoice(artifacts),
    getAdapter,
  };
}

async function loadPortalRegistry(): Promise<AdapterRegistry> {
  try {
    // Computed specifier so TS treats this as a runtime-optional dynamic import
    // (the @nightshift/portal package may not be installed in this workspace yet).
    const spec = "@nightshift/portal";
    const portal = (await import(spec)) as { getAdapter?: (k: string) => PayerAdapter | null };
    const getAdapter = portal.getAdapter;
    if (typeof getAdapter === "function") {
      return (payerKey: string) => {
        try {
          return getAdapter(payerKey) ?? null;
        } catch (err) {
          console.warn(`[portal] getAdapter(${payerKey}) threw: ${(err as Error).message}`);
          return null;
        }
      };
    }
  } catch (err) {
    console.warn(`[portal] @nightshift/portal unavailable — portal path disabled: ${(err as Error).message}`);
  }
  return () => null;
}
