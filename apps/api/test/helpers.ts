import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPool, query } from "@nightshift/db";
import type { ArtifactStore, ConnectorSyncRequest, RawCapture, SubscriberQuery } from "@nightshift/schema";
import { FsArtifactStore } from "../src/artifacts/store.js";
import { loadConfig } from "../src/config.js";
import type { AdapterRegistry, Deps, PayerAdapter } from "../src/deps.js";
import { MockClearinghouse } from "../src/providers/clearinghouse.js";
import { makeExtractorFactory } from "../src/providers/extractor/factory.js";
import { SimulatedVoice } from "../src/providers/voice.js";
import { loadSeed, memberBySubscriberId, planForMember, type SeedMember, type SeedPlan } from "../src/seed.js";

export const PRACTICE_ID = "11111111-1111-1111-1111-111111111111";
export const DEMO_DATE = "2026-07-07"; // fixed demo day; America/Chicago (CDT, -05:00)

// ── fixture HTML generators (mirror mock-portal vocabularies, SEED-derived) ──

function money(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function mdy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

export function buildDeltaHtml(member: SeedMember, plan: SeedPlan): string {
  const u = (member.usage ?? {}) as Record<string, number | string>;
  const maxUsed = Number(u.maxUsed ?? 0);
  const remaining = plan.annualMax - maxUsed;
  const dedMet = Number(u.dedIndividualMet ?? 0);
  const ortho = plan.coverage.ortho > 0 ? `${plan.coverage.ortho}%` : "Not Covered";
  const freqRows: string[] = [];
  if (plan.frequencies.prophylaxis) {
    freqRows.push(
      `<tr><td>Prophylaxis (D1110)</td><td>${plan.frequencies.prophylaxis.replace("per ", "/ ").replace("_", " ")}</td><td>${u.prophyUsed ?? 0}</td><td>${u.prophyLast ? mdy(String(u.prophyLast)) : ""}</td></tr>`,
    );
  }
  if (plan.frequencies.bitewings) {
    freqRows.push(
      `<tr><td>Bitewings (D0274)</td><td>${plan.frequencies.bitewings.replace("per ", "/ ")}</td><td>${u.bwxUsed ?? 0}</td><td></td></tr>`,
    );
  }
  if (plan.frequencies.exam) {
    freqRows.push(
      `<tr><td>Exam (D0120)</td><td>${plan.frequencies.exam.replace("per ", "/ ")}</td><td>${u.examUsed ?? 0}</td><td></td></tr>`,
    );
  }
  const footnote = (plan.downgrades ?? []).includes("posterior_composite_to_amalgam")
    ? `<div class="footnotes">* Posterior composites downgraded to amalgam benefit.</div>`
    : "";
  let waitingTable = "";
  const wpMajor = plan.waitingPeriodsMonths?.major;
  if (wpMajor && member.memberSince) {
    const ends = new Date(member.memberSince);
    ends.setMonth(ends.getMonth() + wpMajor);
    const endsIso = ends.toISOString().slice(0, 10);
    waitingTable = `<table class="waiting">
      <tr><th>Category</th><th>Waiting Period</th></tr>
      <tr><td>Major Services Waiting Period</td><td>${wpMajor} months, ends ${mdy(endsIso)}</td></tr>
    </table>`;
  }
  return `<html><body>
    <table class="benefits">
      <tr><th>Plan Status</th><td>Active</td></tr>
      <tr><th>Plan Year</th><td>${plan.planYearStart === "calendar" ? "Calendar Year" : plan.planYearStart}</td></tr>
      <tr><th>Annual Maximum</th><td>${money(plan.annualMax)}</td></tr>
      <tr><th>Max Used YTD</th><td>${money(maxUsed)}</td></tr>
      <tr><th>Max Remaining</th><td>${money(remaining)}</td></tr>
      <tr><th>Ind. Deductible</th><td>${money(plan.dedIndividual)}</td></tr>
      <tr><th>Ind. Ded. Met</th><td>${money(dedMet)}</td></tr>
      ${plan.dedFamily != null ? `<tr><th>Family Deductible</th><td>${money(plan.dedFamily)}</td></tr>` : ""}
      <tr><th>Deductible Applies To</th><td>${plan.dedAppliesTo.join(", ")}</td></tr>
    </table>
    <table class="coverage">
      <tr><th>Category</th><th>Coverage</th></tr>
      <tr><td>Preventive / Diagnostic</td><td>${plan.coverage.preventive}%</td></tr>
      <tr><td>Basic Services</td><td>${plan.coverage.basic}%</td></tr>
      <tr><td>Major Services</td><td>${plan.coverage.major}%</td></tr>
      <tr><td>Orthodontics</td><td>${ortho}</td></tr>
    </table>
    <table class="frequencies">
      <tr><th>Service</th><th>Limit</th><th>Used</th><th>Last Date</th></tr>
      ${freqRows.join("\n")}
    </table>
    ${waitingTable}
    ${footnote}
  </body></html>`;
}

export function buildMetlifeHtml(member: SeedMember, plan: SeedPlan): string {
  const u = (member.usage ?? {}) as Record<string, number | string>;
  const maxUsed = Number(u.maxUsed ?? 0);
  return `<html><body>
    <table>
      <tr><td>Eligibility</td><td>Active</td></tr>
      <tr><td>Benefit Year</td><td>Calendar</td></tr>
      <tr><td>Maximum Benefit</td><td>${money(plan.annualMax)}</td></tr>
      <tr><td>Maximum Applied</td><td>${money(maxUsed)}</td></tr>
      <tr><td>Deductible (Individual)</td><td>${money(plan.dedIndividual)}</td></tr>
      <tr><td>Deductible Satisfied</td><td>${money(Number(u.dedIndividualMet ?? 0))}</td></tr>
      <tr><td>Preventive</td><td>${plan.coverage.preventive}%</td></tr>
      <tr><td>Basic</td><td>${plan.coverage.basic}%</td></tr>
      <tr><td>Major</td><td>${plan.coverage.major}%</td></tr>
    </table>
    <p class="note">History, downgrades, missing-tooth and COB are not published by this portal.</p>
  </body></html>`;
}

// ── fake portal adapter registry ────────────────────────────────────────────

export interface FakeAdapterOpts {
  /** payerKeys whose adapter returns [] (portal-miss → voice/human fallthrough). */
  missPayers?: string[];
  /** payerKey -> HTML override (for QA-strip scenarios). */
  htmlOverride?: (q: SubscriberQuery) => string | null;
  /** which payerKeys have an adapter at all (default delta + metlife + guardian). */
  adapterPayers?: string[];
}

export function makeFakeAdapterRegistry(artifacts: ArtifactStore, opts: FakeAdapterOpts = {}): AdapterRegistry {
  const adapterPayers = opts.adapterPayers ?? ["mock-delta", "mock-metlife", "mock-guardian"];
  const miss = new Set(opts.missPayers ?? []);
  return (payerKey: string): PayerAdapter | null => {
    if (!adapterPayers.includes(payerKey)) return null;
    return {
      payerKey,
      capabilities: () => ({ "annualMaximum.total": true }),
      async fetchBreakdown(q: SubscriberQuery, deps: { artifacts: ArtifactStore }): Promise<RawCapture[]> {
        if (miss.has(payerKey)) return [];
        const override = opts.htmlOverride?.(q);
        let html: string;
        if (override != null) {
          html = override;
        } else {
          const member = memberBySubscriberId(q.subscriberId);
          const plan = member ? planForMember(member) : null;
          if (!member || !plan) return [];
          html = payerKey === "mock-metlife" ? buildMetlifeHtml(member, plan) : buildDeltaHtml(member, plan);
        }
        const domId = await deps.artifacts.put({ kind: "dom", contentType: "text/html", data: html });
        return [
          {
            kind: "portal_page",
            payerKey,
            artifactIds: [domId],
            content: html,
            capturedAt: new Date().toISOString(),
            meta: { pageName: "benefits" },
          },
        ];
      },
    };
  };
}

// ── deps + db lifecycle ─────────────────────────────────────────────────────

export function makeTestDeps(getAdapter?: AdapterRegistry): Deps {
  const pool = getPool();
  const config = { ...loadConfig(), disableCron: true, artifactsDir: mkdtempSync(join(tmpdir(), "ns-artifacts-")) };
  const artifacts = new FsArtifactStore(config.artifactsDir, pool);
  return {
    pool,
    config,
    artifacts,
    eligibility: new MockClearinghouse(artifacts),
    makeExtractor: makeExtractorFactory(config),
    voice: new SimulatedVoice(artifacts),
    getAdapter: getAdapter ?? makeFakeAdapterRegistry(artifacts),
  };
}

const TABLES_IN_DELETE_ORDER = [
  "writeback",
  "exception",
  "review_task",
  "benefit_snapshot",
  "verification_step",
  "artifact",
  "verification",
  "appointment",
  "connector",
  "coverage",
  "payer_plan",
  "patient_link",
  "payer",
  "practice",
  "job",
  "audit_log",
];

export async function resetDb(): Promise<void> {
  const pool = getPool();
  for (const t of TABLES_IN_DELETE_ORDER) await query(`delete from ${t}`, [], pool);
}

// ── sync request builder from SEED ──────────────────────────────────────────

export function buildSyncRequest(subscriberIds: string[]): ConnectorSyncRequest {
  const seed = loadSeed();
  const patients = [];
  const coverages = [];
  const appointments = [];
  let i = 0;
  for (const subId of subscriberIds) {
    i++;
    const m = seed.members.find((x) => x.subscriberId === subId);
    if (!m) throw new Error(`unknown subscriber ${subId}`);
    const plan = seed.plans[m.plan];
    const [payerKey, groupNumber] = m.plan.split("/");
    patients.push({
      odPatNum: i,
      firstName: m.patient.first,
      lastName: m.patient.last,
      birthdate: m.patient.birthdate,
    });
    coverages.push({
      odPatNum: i,
      odInsSubNum: i,
      odPlanNum: i,
      carrierName: plan.carrierName,
      payerKey,
      groupNumber,
      groupName: plan.employer,
      subscriberId: m.subscriberId,
      subscriberName: m.subscriberName ?? `${m.patient.first} ${m.patient.last}`,
      relationship: m.relationship as "self" | "child" | "spouse" | "other",
      ordinal: 1,
      lastVerifiedAt: null,
    });
    // apptTime in America/Chicago (CDT = -05:00 in July)
    const startsAt = new Date(`${DEMO_DATE}T${m.apptTime}:00-05:00`).toISOString();
    appointments.push({
      odAptNum: i,
      odPatNum: i,
      startsAt,
      minutes: m.minutes,
      provider: m.provider,
      cdtCodes: m.cdt,
      status: "scheduled" as const,
    });
  }
  return { practiceId: PRACTICE_ID, connectorVersion: "test-1", patients, coverages, appointments };
}
