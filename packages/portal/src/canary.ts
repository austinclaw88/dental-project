import type { SubscriberQuery } from "@nightshift/schema";
import { getAdapter } from "./index.js";
import { closeBrowser, resetSessions } from "./index.js";
import { TempArtifactStore } from "./memory-artifacts.js";

/**
 * Adapter health canary (TDD §3.4 drift detection). Logs in and asserts the
 * benefits page for a synthetic member renders its key landmarks. Throws on
 * failure so CI / on-call can auto-quarantine a broken adapter.
 *
 * Requires a running portal at PORTAL_URL (default http://127.0.0.1:4300).
 */

const CANARY: Record<
  string,
  { query: SubscriberQuery; landmarks: RegExp[] }
> = {
  "mock-delta": {
    query: {
      subscriberId: "SUB-1001",
      subscriberName: "Alice Nguyen",
      patientFirstName: "Alice",
      patientLastName: "Nguyen",
      patientBirthdate: "1988-04-12",
      groupNumber: "GRP-ACME",
      payerKey: "mock-delta",
    },
    landmarks: [/Eligibility Status/i, /Cal Yr Max/, /Ind\. Ded\. Rem\./, /Prophy/],
  },
  "mock-metlife": {
    query: {
      subscriberId: "SUB-1006",
      subscriberName: "Tom Okafor",
      patientFirstName: "Tom",
      patientLastName: "Okafor",
      patientBirthdate: "1990-12-17",
      groupNumber: "GRP-ACME",
      payerKey: "mock-metlife",
    },
    landmarks: [/Coverage:\s*Active/i, /Annual Benefit Maximum/, /Type I\b/],
  },
};

export interface CanaryResult {
  payerKey: string;
  ok: boolean;
  captures: number;
  artifacts: number;
  missing: string[];
}

export async function runCanary(payerKey: string): Promise<CanaryResult> {
  const spec = CANARY[payerKey];
  if (!spec) throw new Error(`no canary defined for payer ${payerKey}`);
  const adapter = getAdapter(payerKey);
  if (!adapter) throw new Error(`no adapter registered for payer ${payerKey}`);

  resetSessions(); // canary always exercises a fresh login
  const artifacts = new TempArtifactStore();
  const captures = await adapter.fetchBreakdown(spec.query, { artifacts });

  const benefits = captures.find((c) => c.meta.pageName === "benefits");
  const missing: string[] = [];
  if (!benefits) {
    missing.push("benefits page not captured");
  } else {
    for (const rx of spec.landmarks) {
      if (!rx.test(benefits.content)) missing.push(`landmark missing: ${rx}`);
    }
  }
  return {
    payerKey,
    ok: missing.length === 0 && captures.length > 0,
    captures: captures.length,
    artifacts: artifacts.saved.length,
    missing,
  };
}

// CLI: `npm run -w @nightshift/portal canary [payerKey...]`
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const payers = process.argv.slice(2);
  const targets = payers.length ? payers : ["mock-delta", "mock-metlife"];
  let failed = false;
  try {
    for (const p of targets) {
      const r = await runCanary(p);
      const tag = r.ok ? "PASS" : "FAIL";
      // eslint-disable-next-line no-console
      console.log(
        `[canary] ${tag} ${p} — captures=${r.captures} artifacts=${r.artifacts}` +
          (r.missing.length ? ` missing=${JSON.stringify(r.missing)}` : ""),
      );
      if (!r.ok) failed = true;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[canary] error:", err);
    failed = true;
  } finally {
    await closeBrowser();
  }
  process.exit(failed ? 1 : 0);
}
