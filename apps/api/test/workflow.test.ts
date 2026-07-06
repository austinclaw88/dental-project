import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { getPool, maybeOne, query } from "@nightshift/db";
import { BenefitBreakdown } from "@nightshift/schema";
import type { Deps } from "../src/deps.js";
import { buildServer } from "../src/server.js";
import {
  DEMO_DATE,
  PRACTICE_ID,
  buildSyncRequest,
  makeFakeAdapterRegistry,
  makeTestDeps,
  resetDb,
} from "./helpers.js";

async function sync(app: FastifyInstance, deps: Deps, subscriberIds: string[]) {
  const res = await app.inject({
    method: "POST",
    url: "/internal/connector/sync",
    headers: { "x-connector-token": deps.config.connectorToken, "content-type": "application/json" },
    payload: buildSyncRequest(subscriberIds),
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

async function batchAndDrain(app: FastifyInstance) {
  const res = await app.inject({
    method: "POST",
    url: "/api/batch/run",
    payload: { practiceId: PRACTICE_ID, date: DEMO_DATE },
  });
  expect(res.statusCode).toBe(200);
  await app.jobRunner.drain();
  return res.json();
}

async function verificationFor(subscriberId: string) {
  return maybeOne<Record<string, unknown>>(
    `select v.* from verification v join coverage c on c.id=v.coverage_id
      where c.subscriber_id=$1 order by v.created_at desc limit 1`,
    [subscriberId],
    getPool(),
  );
}

async function exceptionsFor(verificationId: string) {
  return query<Record<string, unknown>>(
    `select * from exception where verification_id=$1`,
    [verificationId],
    getPool(),
  );
}

async function writebacksFor(verificationId: string) {
  return query<Record<string, unknown>>(
    `select target, payload from writeback where verification_id=$1`,
    [verificationId],
    getPool(),
  );
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await getPool().end();
});

describe("VerifyPatientWorkflow", () => {
  it("(a) full happy path: portal → DONE with valid snapshot and writebacks", async () => {
    const deps = makeTestDeps();
    const app = buildServer(deps);

    await sync(app, deps, ["SUB-1001"]);
    const batch = await batchAndDrain(app);
    expect(batch.planned).toBe(1);

    const v = await verificationFor("SUB-1001");
    expect(v?.status).toBe("DONE");
    expect(v?.scope).toBe("full_breakdown");
    expect(v?.completed_at).not.toBeNull();

    const snap = await maybeOne<Record<string, unknown>>(
      `select canonical from benefit_snapshot where verification_id=$1`,
      [v!.id],
      getPool(),
    );
    expect(snap).not.toBeNull();
    const breakdown = BenefitBreakdown.parse(snap!.canonical);
    expect(breakdown.annualMaximum.total.value).toBe(1500);
    expect(breakdown.annualMaximum.remaining.value).toBe(1180);
    expect(breakdown.categoryCoverage.preventive.value).toBe(100);
    expect(breakdown.planStatus.active.value).toBe(true);
    expect(breakdown.planStatus.active.provenance?.source).toBe("x12_271");

    const wbs = await writebacksFor(v!.id as string);
    const targets = wbs.map((w) => w.target).sort();
    expect(targets).toEqual(["benefit_rows", "commlog", "document_pdf", "insplan_note", "insverify"].sort());

    const insverify = wbs.find((w) => w.target === "insverify")!.payload as Record<string, unknown>;
    expect(insverify.odPlanNum).toBeDefined();
    expect(insverify.odInsSubNum).toBeDefined();
    expect(insverify.scope).toBe("full_breakdown");

    const benefitRows = (wbs.find((w) => w.target === "benefit_rows")!.payload as { rows: unknown[] }).rows;
    expect(benefitRows.length).toBeGreaterThan(0);
    const preventiveRow = benefitRows.find((r) => (r as { category: string }).category === "preventive") as {
      cdtFrom: string;
      percent: number;
    };
    expect(preventiveRow.cdtFrom).toBe("D0100");
    expect(preventiveRow.percent).toBe(100);

    app.stopBackground();
  });

  it("(b) terminated coverage → EXCEPTION critical, no insverify", async () => {
    const deps = makeTestDeps();
    const app = buildServer(deps);

    await sync(app, deps, ["SUB-1004"]);
    await batchAndDrain(app);

    const v = await verificationFor("SUB-1004");
    expect(v?.status).toBe("EXCEPTION");
    const exceptions = await exceptionsFor(v!.id as string);
    const term = exceptions.find((e) => e.type === "coverage_terminated");
    expect(term).toBeDefined();
    expect(term!.severity).toBe("critical");
    expect(String(term!.message)).toMatch(/terminated/i);

    const wbs = await writebacksFor(v!.id as string);
    expect(wbs.some((w) => w.target === "insverify")).toBe(false);
    expect(wbs.some((w) => w.target === "insplan_note")).toBe(true);

    app.stopBackground();
  });

  it("(c) frequency conflict exception fires (D1110 with 2/2 prophies)", async () => {
    const deps = makeTestDeps();
    const app = buildServer(deps);

    await sync(app, deps, ["SUB-1002"]);
    await batchAndDrain(app);

    const v = await verificationFor("SUB-1002");
    expect(v?.status).toBe("DONE");
    const exceptions = await exceptionsFor(v!.id as string);
    const freq = exceptions.find((e) => e.type === "frequency_conflict");
    expect(freq).toBeDefined();
    expect(freq!.severity).toBe("warning");
    expect(String(freq!.message)).toMatch(/2\/2/);

    app.stopBackground();
  });

  it("(d) portal-miss → voice → DONE (mock-guardian)", async () => {
    const deps = makeTestDeps();
    deps.getAdapter = makeFakeAdapterRegistry(deps.artifacts, { missPayers: ["mock-guardian"] });
    const app = buildServer(deps);

    await sync(app, deps, ["SUB-1008"]);
    await batchAndDrain(app);

    const v = await verificationFor("SUB-1008");
    expect(v?.status).toBe("DONE");

    const steps = await query<Record<string, unknown>>(
      `select kind, status from verification_step where verification_id=$1 order by started_at`,
      [v!.id],
      getPool(),
    );
    const kinds = steps.map((s) => s.kind);
    expect(kinds).toContain("portal");
    expect(kinds).toContain("voice");
    expect(steps.find((s) => s.kind === "voice")!.status).toBe("succeeded");

    const snap = await maybeOne<Record<string, unknown>>(
      `select canonical from benefit_snapshot where verification_id=$1`,
      [v!.id],
      getPool(),
    );
    const breakdown = BenefitBreakdown.parse(snap!.canonical);
    // voice transcript carries SEED guardian values
    expect(breakdown.annualMaximum.total.value).toBe(1500);
    expect(breakdown.annualMaximum.total.provenance?.source).toBe("voice_call");

    app.stopBackground();
  });

  it("(e) voice-fail → review task; complete via endpoint → DONE with human provenance", async () => {
    const deps = makeTestDeps();
    const app = buildServer(deps);

    await sync(app, deps, ["SUB-1009"]); // mock-suncoast: no adapter, no voice script
    await batchAndDrain(app);

    let v = await verificationFor("SUB-1009");
    expect(v?.status).toBe("HUMAN_REVIEW");

    const tasksRes = await app.inject({ method: "GET", url: "/api/review-tasks?status=open" });
    const tasks = tasksRes.json().tasks as Array<{ id: string; verificationId: string }>;
    const task = tasks.find((t) => t.verificationId === v!.id);
    expect(task).toBeDefined();

    const completeRes = await app.inject({
      method: "POST",
      url: `/api/review-tasks/${task!.id}/complete`,
      payload: {
        reviewer: "tester",
        fields: {
          "annualMaximum.total": 1800,
          "annualMaximum.used": 0,
          "annualMaximum.remaining": 1800,
          "deductible.individual": 100,
          "deductible.individualMet": 0,
          "categoryCoverage.preventive": 100,
          "categoryCoverage.basic": 80,
          "categoryCoverage.major": 50,
          "categoryCoverage.ortho": 0,
        },
      },
    });
    expect(completeRes.statusCode).toBe(200);

    v = await verificationFor("SUB-1009");
    expect(v?.status).toBe("DONE");

    const snap = await maybeOne<Record<string, unknown>>(
      `select canonical from benefit_snapshot where verification_id=$1`,
      [v!.id],
      getPool(),
    );
    const breakdown = BenefitBreakdown.parse(snap!.canonical);
    expect(breakdown.annualMaximum.total.value).toBe(1800);
    expect(breakdown.annualMaximum.total.provenance?.source).toBe("human");
    expect(breakdown.annualMaximum.total.confidence).toBe("high");

    // low_confidence exception resolved on completion → displayStatus verified
    const exceptions = await exceptionsFor(v!.id as string);
    const low = exceptions.find((e) => e.type === "low_confidence");
    expect(low?.resolved_at).not.toBeNull();

    // labels recorded
    const rt = await maybeOne<Record<string, unknown>>(
      `select labels, status from review_task where verification_id=$1`,
      [v!.id],
      getPool(),
    );
    expect(rt!.status).toBe("done");
    expect((rt!.labels as Record<string, unknown>)["annualMaximum.total"]).toBeDefined();

    app.stopBackground();
  });

  it("(f) QA gate: sparse capture (missing required fields) routes to review", async () => {
    const deps = makeTestDeps();
    // adapter returns HTML with only plan status → completeness < 0.7
    deps.getAdapter = makeFakeAdapterRegistry(deps.artifacts, {
      htmlOverride: () => `<html><body><table><tr><th>Plan Status</th><td>Active</td></tr></table></body></html>`,
    });
    const app = buildServer(deps);

    await sync(app, deps, ["SUB-1001"]);
    await batchAndDrain(app);

    const v = await verificationFor("SUB-1001");
    expect(v?.status).toBe("HUMAN_REVIEW");

    const rt = await maybeOne<Record<string, unknown>>(
      `select reason from review_task where verification_id=$1`,
      [v!.id],
      getPool(),
    );
    expect(rt).not.toBeNull();
    expect(String(rt!.reason)).toMatch(/qa_gate/);

    app.stopBackground();
  });
});
