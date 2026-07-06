/**
 * Fixture data — derived by hand from docs/SEED-UNIVERSE.json.
 *
 * Used two ways:
 *   1. Test data for the component tests.
 *   2. Offline fallback for the live app: when the API at NEXT_PUBLIC_API_URL is
 *      unreachable, lib/mockApi.ts serves these so the UI is fully demonstrable
 *      (interactive re-verify / resolve / batch transitions) with an "API offline"
 *      banner — never a white screen. See README "Fixture strategy".
 *
 * Shapes match the contract in docs/API-CONTRACT.md exactly (see src/types.ts).
 */
import type {
  BenefitBreakdown,
  Confidence,
  CoverageCategory,
  FieldSource,
  FieldValue,
  MetricsSummary,
  Practice,
  ReviewTask,
  VerificationDetail,
  VerificationListItem,
} from "../types";

export const PRACTICE: Practice = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Cedar Park Dental Studio",
  tz: "America/Chicago",
};

// ---------- field-value helpers ----------
function fv<T>(
  value: T | null,
  opts: {
    source?: FieldSource;
    confidence?: Confidence;
    artifactId?: string | null;
    locator?: string | null;
    retrievedAt?: string;
    unavailableReason?: string | null;
  } = {},
): FieldValue<T> {
  const {
    source = "portal",
    confidence = "high",
    artifactId = null,
    locator = null,
    retrievedAt = "2026-07-07T04:12:00Z",
    unavailableReason = null,
  } = opts;
  return {
    value,
    confidence,
    unavailableReason,
    provenance:
      value === null && unavailableReason
        ? null
        : { source, artifactId, locator, retrievedAt },
  };
}

/** payer will not disclose — present but null with a reason (PRD R8). */
function unavailable<T>(reason: string): FieldValue<T> {
  return { value: null, confidence: "low", unavailableReason: reason, provenance: null };
}

// ---------- demo-date helpers ----------
/** Chicago is CDT (UTC-5) on the July demo date. Build a local-looking ISO. */
function apptAt(date: string, hhmm: string): string {
  return `${date}T${hhmm}:00-05:00`;
}

// ---------- plan reference data (copied from SEED-UNIVERSE plans) ----------
interface PlanRef {
  carrierName: string;
  payerKey: string;
  annualMax: number;
  dedIndividual: number;
  dedFamily: number | null;
  dedAppliesTo: CoverageCategory[];
  coverage: { preventive: number; basic: number; major: number; ortho: number };
  planYearStart: string;
  missingToothClause: boolean | null;
  cobRule: string | null;
  sparse?: boolean;
}

const PLANS: Record<string, PlanRef> = {
  "mock-delta/GRP-ACME": {
    carrierName: "Delta Dental MockState", payerKey: "mock-delta",
    annualMax: 1500, dedIndividual: 50, dedFamily: 150, dedAppliesTo: ["basic", "major"],
    coverage: { preventive: 100, basic: 80, major: 50, ortho: 0 },
    planYearStart: "calendar", missingToothClause: true, cobRule: "standard",
  },
  "mock-delta/GRP-TECHCO": {
    carrierName: "Delta Dental MockState", payerKey: "mock-delta",
    annualMax: 2000, dedIndividual: 75, dedFamily: 225, dedAppliesTo: ["basic", "major"],
    coverage: { preventive: 100, basic: 90, major: 60, ortho: 50 },
    planYearStart: "07-01", missingToothClause: false, cobRule: "non_duplication",
  },
  "mock-delta/GRP-SCHOOL": {
    carrierName: "Delta Dental MockState", payerKey: "mock-delta",
    annualMax: 1250, dedIndividual: 50, dedFamily: 150, dedAppliesTo: ["basic", "major"],
    coverage: { preventive: 100, basic: 80, major: 50, ortho: 50 },
    planYearStart: "09-01", missingToothClause: true, cobRule: "standard",
  },
  "mock-metlife/GRP-ACME": {
    carrierName: "MetLife Mock", payerKey: "mock-metlife",
    annualMax: 1000, dedIndividual: 50, dedFamily: null, dedAppliesTo: ["basic", "major"],
    coverage: { preventive: 100, basic: 70, major: 50, ortho: 0 },
    planYearStart: "calendar", missingToothClause: null, cobRule: null, sparse: true,
  },
  "mock-metlife/GRP-TECHCO": {
    carrierName: "MetLife Mock", payerKey: "mock-metlife",
    annualMax: 1500, dedIndividual: 60, dedFamily: null, dedAppliesTo: ["basic", "major"],
    coverage: { preventive: 90, basic: 80, major: 50, ortho: 0 },
    planYearStart: "calendar", missingToothClause: null, cobRule: null, sparse: true,
  },
  "mock-guardian/GRP-ACME": {
    carrierName: "Guardian Mock", payerKey: "mock-guardian",
    annualMax: 1500, dedIndividual: 50, dedFamily: 150, dedAppliesTo: ["basic", "major"],
    coverage: { preventive: 100, basic: 80, major: 50, ortho: 0 },
    planYearStart: "calendar", missingToothClause: false, cobRule: "standard",
  },
  "mock-suncoast/GRP-SCHOOL": {
    carrierName: "SunCoast Dental Trust", payerKey: "mock-suncoast",
    annualMax: 1800, dedIndividual: 100, dedFamily: 300, dedAppliesTo: ["major"],
    coverage: { preventive: 100, basic: 80, major: 50, ortho: 0 },
    planYearStart: "calendar", missingToothClause: true, cobRule: "standard",
  },
};

interface MemberFixture {
  id: string; // verification id
  patientLinkId: string;
  sub: string;
  first: string;
  last: string;
  birthdate: string;
  subscriberName?: string;
  relationship: string;
  planKey: string;
  group: string;
  apptTime: string;
  minutes: number;
  provider: string;
  cdt: string[];
  scenario: string;
}

// (order = appointment time; ids are stable so detail links resolve offline)
const MEMBERS: MemberFixture[] = [
  { id: "v-1001", patientLinkId: "p-1001", sub: "SUB-1001", first: "Alice", last: "Nguyen", birthdate: "1988-04-12", relationship: "self", planKey: "mock-delta/GRP-ACME", group: "GRP-ACME", apptTime: "08:00", minutes: 60, provider: "Dr. Chen", cdt: ["D1110", "D0120", "D0274"], scenario: "clean" },
  { id: "v-1002", patientLinkId: "p-1002", sub: "SUB-1002", first: "Marcus", last: "Webb", birthdate: "1975-09-30", relationship: "self", planKey: "mock-delta/GRP-ACME", group: "GRP-ACME", apptTime: "08:00", minutes: 60, provider: "RDH Lopez", cdt: ["D1110", "D0120"], scenario: "frequency_conflict" },
  { id: "v-1003", patientLinkId: "p-1003", sub: "SUB-1003", first: "Elena", last: "Rossi", birthdate: "1992-11-08", relationship: "self", planKey: "mock-delta/GRP-TECHCO", group: "GRP-TECHCO", apptTime: "09:00", minutes: 90, provider: "Dr. Chen", cdt: ["D2740"], scenario: "waiting_period_conflict" },
  { id: "v-1004", patientLinkId: "p-1004", sub: "SUB-1004", first: "James", last: "Porter", birthdate: "1969-02-21", relationship: "self", planKey: "mock-delta/GRP-TECHCO", group: "GRP-TECHCO", apptTime: "09:30", minutes: 60, provider: "RDH Lopez", cdt: ["D1110", "D0120"], scenario: "coverage_terminated" },
  { id: "v-1005", patientLinkId: "p-1005", sub: "SUB-1005", first: "Priya", last: "Shah", birthdate: "1983-07-04", relationship: "self", planKey: "mock-delta/GRP-SCHOOL", group: "GRP-SCHOOL", apptTime: "10:00", minutes: 90, provider: "RDH Lopez", cdt: ["D4341", "D4341"], scenario: "clean" },
  { id: "v-1006", patientLinkId: "p-1006", sub: "SUB-1006", first: "Tom", last: "Okafor", birthdate: "1990-12-17", relationship: "self", planKey: "mock-metlife/GRP-ACME", group: "GRP-ACME", apptTime: "10:30", minutes: 60, provider: "Dr. Chen", cdt: ["D2392"], scenario: "clean_sparse" },
  { id: "v-1007", patientLinkId: "p-1007", sub: "SUB-1007", first: "Hana", last: "Kim", birthdate: "1986-03-25", relationship: "self", planKey: "mock-metlife/GRP-TECHCO", group: "GRP-TECHCO", apptTime: "11:00", minutes: 90, provider: "Dr. Chen", cdt: ["D2740"], scenario: "clean_sparse" },
  { id: "v-1008", patientLinkId: "p-1008", sub: "SUB-1008", first: "Luis", last: "Romero", birthdate: "1979-08-14", relationship: "self", planKey: "mock-guardian/GRP-ACME", group: "GRP-ACME", apptTime: "13:00", minutes: 60, provider: "RDH Lopez", cdt: ["D1110", "D0120", "D0274"], scenario: "voice_path" },
  { id: "v-1009", patientLinkId: "p-1009", sub: "SUB-1009", first: "Grace", last: "Liu", birthdate: "1971-05-06", relationship: "self", planKey: "mock-suncoast/GRP-SCHOOL", group: "GRP-SCHOOL", apptTime: "14:00", minutes: 120, provider: "Dr. Chen", cdt: ["D6065"], scenario: "human_review_path" },
  { id: "v-1010", patientLinkId: "p-1010", sub: "SUB-1010", first: "Owen", last: "Brooks", birthdate: "2015-10-02", subscriberName: "Dana Brooks", relationship: "child", planKey: "mock-delta/GRP-SCHOOL", group: "GRP-SCHOOL", apptTime: "15:00", minutes: 45, provider: "RDH Lopez", cdt: ["D0120", "D0274", "D1120"], scenario: "clean" },
  { id: "v-1011", patientLinkId: "p-1011", sub: "SUB-1011", first: "Sofia", last: "Marino", birthdate: "1995-01-29", relationship: "self", planKey: "mock-delta/GRP-ACME", group: "GRP-ACME", apptTime: "15:30", minutes: 90, provider: "Dr. Chen", cdt: ["D2740"], scenario: "deductible_unmet_high_value" },
  { id: "v-1012", patientLinkId: "p-1012", sub: "SUB-1012", first: "Dev", last: "Patel", birthdate: "1998-06-11", relationship: "self", planKey: "mock-metlife/GRP-TECHCO", group: "GRP-TECHCO", apptTime: "16:00", minutes: 60, provider: "RDH Lopez", cdt: ["D1110", "D0120"], scenario: "verification_failed" },
];

// scenario → displayStatus + exceptions (messages say why it matters TODAY, PRD R17)
interface ScenarioOutcome {
  displayStatus: VerificationListItem["displayStatus"];
  status: string;
  exceptions: { type: string; severity: string; message: string }[];
}

function outcomeFor(m: MemberFixture): ScenarioOutcome {
  switch (m.scenario) {
    case "frequency_conflict":
      return {
        displayStatus: "attention", status: "DONE",
        exceptions: [{ type: "frequency_conflict", severity: "warning", message: "D1110 scheduled but 2/2 prophylaxis benefits used as of 05/02/2026 — patient owes full fee unless rescheduled after 07/01/2026." }],
      };
    case "waiting_period_conflict":
      return {
        displayStatus: "attention", status: "DONE",
        exceptions: [{ type: "waiting_period_conflict", severity: "warning", message: "D2740 crown scheduled but major services have a 12-month waiting period ending 03/01/2027 — not covered today." }],
      };
    case "coverage_terminated":
      return {
        displayStatus: "attention", status: "DONE",
        exceptions: [{ type: "coverage_terminated", severity: "critical", message: "Coverage TERMINATED 05/31/2026 — patient is not eligible for today's visit; collect full fee or confirm new plan." }],
      };
    case "deductible_unmet_high_value":
      return {
        displayStatus: "attention", status: "DONE",
        exceptions: [{ type: "deductible_unmet_high_value", severity: "info", message: "D2740 crown scheduled; $0 of $50 individual deductible met — patient owes the $50 deductible plus 50% coinsurance today." }],
      };
    case "voice_path":
      return { displayStatus: "in_progress", status: "VOICE", exceptions: [] };
    case "human_review_path":
      return {
        displayStatus: "in_progress", status: "HUMAN_REVIEW",
        exceptions: [{ type: "low_confidence", severity: "info", message: "SunCoast Dental Trust has no portal or voice line — being completed by our verification team (SLA 2 business hours)." }],
      };
    case "verification_failed":
      return {
        displayStatus: "failed", status: "FAILED",
        exceptions: [{ type: "verification_failed", severity: "critical", message: "Portal login failed after 3 attempts (payer site unreachable) — re-verify, or call MetLife Mock to confirm eligibility before the 4:00 PM visit." }],
      };
    default:
      return { displayStatus: "verified", status: "DONE", exceptions: [] };
  }
}

export function buildDayItems(date: string): VerificationListItem[] {
  return MEMBERS.map((m) => {
    const plan = PLANS[m.planKey];
    const o = outcomeFor(m);
    return {
      id: m.id,
      patientLinkId: m.patientLinkId,
      patientName: `${m.first} ${m.last}`,
      appointmentAt: apptAt(date, m.apptTime),
      provider: m.provider,
      cdtCodes: m.cdt,
      carrierName: plan.carrierName,
      scope: m.cdt.some((c) => /^D[2-6]/.test(c)) ? "full_breakdown" : "full_breakdown",
      status: o.status,
      displayStatus: o.displayStatus,
      completedAt: o.displayStatus === "in_progress" ? null : `${date}T04:${10 + (MEMBERS.indexOf(m))}:00Z`,
      exceptions: o.exceptions.map((e, i) => ({
        id: `${m.id}-exc-${i}`,
        type: e.type,
        severity: e.severity,
        message: e.message,
        resolvedAt: null,
      })),
    };
  });
}

// ---------- breakdown builders ----------
function buildBreakdown(m: MemberFixture): BenefitBreakdown {
  const plan = PLANS[m.planKey];
  const source: FieldSource =
    plan.payerKey === "mock-guardian" ? "voice_call" : plan.payerKey === "mock-suncoast" ? "human" : "portal";
  const conf: Confidence = source === "voice_call" ? "medium" : "high";
  const art = (name: string): string => `${m.id}-${name}`;
  const terminated = m.scenario === "coverage_terminated";

  const catFv = (pct: number, cat: string) =>
    fv(pct, { source, confidence: conf, artifactId: art("benefits"), locator: `table.coverage tr.${cat}` });

  const sparse = !!plan.sparse;

  const bd: BenefitBreakdown = {
    schemaVersion: "1.0",
    planStatus: {
      active: fv(!terminated, {
        source: "x12_271", confidence: "high", artifactId: art("271"), locator: "EB*1",
      }),
      effectiveDate: fv(m.scenario === "waiting_period_conflict" ? "2026-03-01" : "2024-01-01", {
        source, confidence: conf, artifactId: art("eligibility"),
      }),
      terminationDate: terminated
        ? fv("2026-05-31", { source: "portal", confidence: "high", artifactId: art("eligibility"), locator: "span.term-date" })
        : fv<string>(null, { source, confidence: conf }),
      planYearStart: fv(plan.planYearStart, { source, confidence: conf, artifactId: art("benefits") }),
    },
    annualMaximum: {
      total: fv(plan.annualMax, { source, confidence: conf, artifactId: art("benefits"), locator: "td.annual-max" }),
      used: fv(usageMax(m), { source, confidence: conf, artifactId: art("benefits") }),
      remaining: fv(plan.annualMax - usageMax(m), { source, confidence: conf, artifactId: art("benefits") }),
    },
    deductible: {
      individual: fv(plan.dedIndividual, { source, confidence: conf, artifactId: art("benefits") }),
      individualMet: fv(usageDed(m), { source, confidence: conf, artifactId: art("benefits") }),
      family: plan.dedFamily === null
        ? unavailable<number>("Not published by payer")
        : fv(plan.dedFamily, { source, confidence: conf, artifactId: art("benefits") }),
      familyMet: plan.dedFamily === null
        ? unavailable<number>("Not published by payer")
        : fv(Math.min(usageDed(m), plan.dedFamily), { source, confidence: conf, artifactId: art("benefits") }),
      appliesTo: fv(plan.dedAppliesTo, { source, confidence: conf, artifactId: art("benefits") }),
    },
    categoryCoverage: {
      preventive: catFv(plan.coverage.preventive, "preventive"),
      basic: catFv(plan.coverage.basic, "basic"),
      major: catFv(plan.coverage.major, "major"),
      ortho: plan.coverage.ortho === 0 && sparse
        ? unavailable<number>("Not published by payer")
        : catFv(plan.coverage.ortho, "ortho"),
    },
    cdtRules: [
      { cdtFrom: "D0100", cdtTo: "D0999", category: "preventive", percent: catFv(plan.coverage.preventive, "prev"), notes: "Diagnostic & preventive" },
      { cdtFrom: "D2000", cdtTo: "D2999", category: "basic", percent: catFv(plan.coverage.basic, "basic"), notes: "Restorative" },
      { cdtFrom: "D2700", cdtTo: "D2799", category: "major", percent: catFv(plan.coverage.major, "major"), notes: "Crowns" },
    ],
    frequencies: buildFreqs(m, source, conf, art),
    waitingPeriods:
      m.scenario === "waiting_period_conflict"
        ? [{ category: "major", months: fv(12, { source, confidence: conf, artifactId: art("benefits") }), endsOn: fv("2027-03-01", { source, confidence: conf, artifactId: art("benefits") }) }]
        : [],
    downgrades: sparse
      ? []
      : m.planKey === "mock-delta/GRP-ACME"
        ? [{ key: "posterior_composite_to_amalgam", description: fv("Posterior composites paid at amalgam allowance", { source, confidence: conf, artifactId: art("benefits") }), applies: fv(true, { source, confidence: conf, artifactId: art("benefits") }) }]
        : [],
    missingToothClause: plan.missingToothClause === null
      ? unavailable<boolean>("Not published by payer")
      : fv(plan.missingToothClause, { source, confidence: conf, artifactId: art("benefits") }),
    orthoLifetimeMax: plan.coverage.ortho > 0
      ? fv(1500, { source, confidence: conf, artifactId: art("benefits") })
      : fv<number>(null, { source, confidence: conf, unavailableReason: "No orthodontic coverage on this plan" }),
    orthoLifetimeUsed: plan.coverage.ortho > 0 ? fv(0, { source, confidence: conf }) : fv<number>(null, {}),
    cobRule: plan.cobRule === null
      ? unavailable<string>("Not published by payer")
      : fv(plan.cobRule, { source, confidence: conf, artifactId: art("benefits") }),
    assignmentOfBenefits: fv(true, { source, confidence: source === "voice_call" ? "low" : conf, artifactId: art("benefits") }),
    feeScheduleName: sparse
      ? unavailable<string>("Not published by payer")
      : fv(`${plan.carrierName} PPO ${m.group}`, { source, confidence: conf, artifactId: art("benefits") }),
    notes: buildNotes(m),
  };
  return bd;
}

function usageMax(m: MemberFixture): number {
  const map: Record<string, number> = {
    "v-1001": 320, "v-1002": 610, "v-1003": 0, "v-1004": 0, "v-1005": 180,
    "v-1006": 95, "v-1007": 400, "v-1008": 250, "v-1009": 0, "v-1010": 120, "v-1011": 0, "v-1012": 0,
  };
  return map[m.id] ?? 0;
}
function usageDed(m: MemberFixture): number {
  const map: Record<string, number> = {
    "v-1001": 50, "v-1002": 50, "v-1003": 0, "v-1004": 50, "v-1005": 25,
    "v-1006": 50, "v-1007": 0, "v-1008": 50, "v-1009": 0, "v-1010": 0, "v-1011": 0, "v-1012": 0,
  };
  return map[m.id] ?? 0;
}

function buildFreqs(
  m: MemberFixture,
  source: FieldSource,
  conf: Confidence,
  art: (n: string) => string,
): BenefitBreakdown["frequencies"] {
  const plan = PLANS[m.planKey];
  if (plan.sparse) return []; // metlife omits history
  const prophyUsed = m.scenario === "frequency_conflict" ? 2 : 1;
  const prophyLast = m.scenario === "frequency_conflict" ? "2026-05-02" : "2026-01-15";
  const out: BenefitBreakdown["frequencies"] = [
    {
      key: "prophylaxis",
      cdtCodes: ["D1110", "D1120"],
      limit: fv(plan.planYearStart === "calendar" ? "2 per calendar_year" : "2 per plan_year", { source, confidence: conf, artifactId: art("history") }),
      usedCount: fv(prophyUsed, { source, confidence: conf, artifactId: art("history"), locator: "tr.prophy td.used" }),
      lastServiceDate: fv<string>(prophyLast, { source, confidence: conf, artifactId: art("history") }),
      nextEligibleDate: fv<string>(m.scenario === "frequency_conflict" ? "2027-01-01" : "2026-07-15", { source, confidence: conf, artifactId: art("history") }),
    },
    {
      key: "bitewings",
      cdtCodes: ["D0274"],
      limit: fv("1 per calendar_year", { source, confidence: conf, artifactId: art("history") }),
      usedCount: fv(0, { source, confidence: conf, artifactId: art("history") }),
      lastServiceDate: fv<string>(null, { source, confidence: conf }),
      nextEligibleDate: fv<string>("2026-01-01", { source, confidence: conf }),
    },
  ];
  return out;
}

function buildNotes(m: MemberFixture): string[] {
  switch (m.scenario) {
    case "coverage_terminated":
      return ["Eligibility (271) returned INACTIVE. Portal eligibility page shows TERMINATED effective 05/31/2026."];
    case "frequency_conflict":
      return ["History page shows 2 prophylaxis paid this benefit year (01/12, 05/02). Third cleaning is patient responsibility."];
    case "waiting_period_conflict":
      return ["Member effective 03/01/2026. 12-month waiting period on major services; crown eligible 03/01/2027."];
    case "voice_path":
      return ["Benefits confirmed by phone (Guardian Mock rep, ref #GM-88213). Recording linked."];
    default:
      return [];
  }
}

// ---------- verification detail ----------
export function buildDetail(id: string, date = defaultDate()): VerificationDetail | null {
  const m = MEMBERS.find((x) => x.id === id);
  if (!m) return null;
  const plan = PLANS[m.planKey];
  const o = outcomeFor(m);
  const inProgress = o.displayStatus === "in_progress";
  const failed = o.displayStatus === "failed";
  const humanReview = m.scenario === "human_review_path";

  const statusMap: Record<string, VerificationDetail["verification"]["status"]> = {
    verified: "DONE", attention: "DONE", failed: "FAILED", in_progress: humanReview ? "HUMAN_REVIEW" : "VOICE", planned: "PLANNED",
  };

  const steps = buildSteps(m, o.displayStatus);
  const snapshot: VerificationDetail["snapshot"] =
    failed || humanReview
      ? null
      : { verificationId: m.id, breakdown: buildBreakdown(m), validatorIssues: [] };

  const writebacks: VerificationDetail["writebacks"] =
    o.displayStatus === "verified"
      ? [
          { id: `${m.id}-wb-1`, verificationId: m.id, practiceId: PRACTICE.id, target: "insverify", status: "applied", beforeImage: null, payload: { odPlanNum: 100, verifiedAt: `${date}T04:12:00Z`, scope: "full_breakdown" } },
          { id: `${m.id}-wb-2`, verificationId: m.id, practiceId: PRACTICE.id, target: "benefit_rows", status: "applied", beforeImage: null, payload: { odPlanNum: 100, rows: 3 } },
          { id: `${m.id}-wb-3`, verificationId: m.id, practiceId: PRACTICE.id, target: "commlog", status: "applied", beforeImage: null, payload: { odPatNum: 100, text: "NightShift verified benefits" } },
        ]
      : o.displayStatus === "attention"
        ? [
            { id: `${m.id}-wb-1`, verificationId: m.id, practiceId: PRACTICE.id, target: "insplan_note", status: "applied", beforeImage: { plan_note: "" }, payload: { odPlanNum: 100, note: o.exceptions[0]?.message ?? "" } },
            { id: `${m.id}-wb-2`, verificationId: m.id, practiceId: PRACTICE.id, target: "commlog", status: "pending", beforeImage: null, payload: { odPatNum: 100, text: "Exception flagged" } },
          ]
        : [];

  return {
    verification: {
      id: m.id,
      status: statusMap[o.displayStatus],
      displayStatus: o.displayStatus,
      scope: "full_breakdown",
      createdAt: `${date}T04:00:00Z`,
      completedAt: inProgress ? null : `${date}T04:12:00Z`,
    },
    patient: { id: m.patientLinkId, firstName: m.first, lastName: m.last, birthdate: m.birthdate },
    coverage: {
      carrierName: plan.carrierName,
      payerKey: plan.payerKey,
      subscriberId: m.sub,
      subscriberName: m.subscriberName ?? `${m.first} ${m.last}`,
      groupNumber: m.group,
      groupName: null,
      relationship: m.relationship,
    },
    appointment: { startsAt: apptAt(date, m.apptTime), minutes: m.minutes, provider: m.provider, cdtCodes: m.cdt },
    steps,
    snapshot,
    exceptions: o.exceptions.map((e, i) => ({
      id: `${m.id}-exc-${i}`,
      verificationId: m.id,
      type: e.type as any,
      severity: e.severity as any,
      message: e.message,
      resolvedBy: null,
      resolvedAt: null,
    })),
    writebacks,
  };
}

function buildSteps(m: MemberFixture, display: string): VerificationDetail["steps"] {
  const plan = PLANS[m.planKey];
  const base = `${m.id}-step`;
  const steps: VerificationDetail["steps"] = [
    { id: `${base}-elig`, verificationId: m.id, kind: "eligibility", status: "succeeded", startedAt: "2026-07-07T04:00:05Z", finishedAt: "2026-07-07T04:00:09Z", durationMs: 4200, artifactId: `${m.id}-271`, detail: m.scenario === "coverage_terminated" ? "271: coverage INACTIVE" : "271: coverage active" },
  ];
  if (plan.payerKey === "mock-guardian") {
    steps.push({ id: `${base}-voice`, verificationId: m.id, kind: "voice", status: display === "in_progress" ? "running" : "succeeded", startedAt: "2026-07-07T04:01:00Z", finishedAt: display === "in_progress" ? null : "2026-07-07T04:09:30Z", durationMs: display === "in_progress" ? null : 510000, artifactId: `${m.id}-transcript`, detail: "Guardian Mock benefits line — IVR + rep read-back" });
  } else if (plan.payerKey === "mock-suncoast") {
    steps.push({ id: `${base}-human`, verificationId: m.id, kind: "human", status: "running", startedAt: "2026-07-07T04:01:00Z", finishedAt: null, durationMs: null, artifactId: null, detail: "No portal / no voice script — parked for human review" });
    return steps;
  } else {
    steps.push({ id: `${base}-portal`, verificationId: m.id, kind: "portal", status: m.scenario === "verification_failed" ? "failed" : "succeeded", startedAt: "2026-07-07T04:01:00Z", finishedAt: "2026-07-07T04:03:20Z", durationMs: 140000, artifactId: m.scenario === "verification_failed" ? null : `${m.id}-benefits`, detail: m.scenario === "verification_failed" ? "Portal login failed (3 attempts)" : "Captured eligibility + benefits + history pages" });
  }
  if (m.scenario === "verification_failed") return steps;
  steps.push({ id: `${base}-norm`, verificationId: m.id, kind: "normalize", status: "succeeded", startedAt: "2026-07-07T04:03:25Z", finishedAt: "2026-07-07T04:03:26Z", durationMs: 900, artifactId: null, detail: "Extracted to canonical breakdown" });
  steps.push({ id: `${base}-qa`, verificationId: m.id, kind: "qa", status: "succeeded", startedAt: "2026-07-07T04:03:27Z", finishedAt: "2026-07-07T04:03:27Z", durationMs: 300, artifactId: null, detail: display === "attention" ? "Passed; exception raised at normalize" : "Completeness 0.92, no validator issues" });
  if (display === "verified" || display === "attention") {
    steps.push({ id: `${base}-wb`, verificationId: m.id, kind: "writeback", status: "succeeded", startedAt: "2026-07-07T04:03:28Z", finishedAt: "2026-07-07T04:03:31Z", durationMs: 3000, artifactId: null, detail: "Wrote insverify + benefit rows + commlog" });
  }
  return steps;
}

// ---------- review tasks ----------
export function buildReviewTasks(): ReviewTask[] {
  const m = MEMBERS.find((x) => x.id === "v-1009")!; // SunCoast → human review
  const plan = PLANS[m.planKey];
  // draft breakdown prefilled from the SunCoast plan data the reviewer completes from
  const draft = buildBreakdown(m);
  // reviewer starts from a low-confidence/human draft: null the fields they must confirm
  draft.planStatus.active = { value: null, confidence: "low", unavailableReason: null, provenance: null };
  return [
    {
      id: "rt-1009",
      verificationId: m.id,
      patientName: `${m.first} ${m.last}`,
      payerKey: plan.payerKey,
      carrierName: plan.carrierName,
      reason: "No portal or voice script for SunCoast Dental Trust — manual verification required.",
      status: "open",
      slaDueAt: "2026-07-07T06:00:00Z",
      createdAt: "2026-07-07T04:01:00Z",
      draft,
    },
  ];
}

export function buildMetrics(): MetricsSummary {
  const items = buildDayItems(defaultDate());
  const total = items.length;
  const done = items.filter((i) => i.displayStatus !== "in_progress" && i.displayStatus !== "planned").length;
  const clean = items.filter((i) => i.displayStatus === "verified").length;
  const exceptions = items.filter((i) => i.exceptions.length > 0).length;
  return {
    fullAutoRate: clean / total,
    total,
    done,
    exceptions,
    avgDurationMs: 168000,
    byStep: { eligibility: total, portal: 8, voice: 1, human: 1, writeback: 9 },
  };
}

export function defaultDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export { MEMBERS };
export type { MemberFixture };
