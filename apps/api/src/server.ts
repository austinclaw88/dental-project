import { createReadStream } from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import { audit, one, query } from "@nightshift/db";
import { BenefitBreakdown, ConnectorSyncRequest } from "@nightshift/schema";
import type { Deps } from "./deps.js";
import { JobRunner } from "./jobs/runner.js";
import { applySync } from "./sync.js";
import { planScope, runBatch } from "./workflow/plan.js";
import { resumeFromReview, runVerification } from "./workflow/verify.js";

declare module "fastify" {
  interface FastifyInstance {
    deps: Deps;
    jobRunner: JobRunner;
    startBackground: () => void;
    stopBackground: () => void;
  }
}

function camel(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k.replace(/_([a-z])/g, (_m, c) => c.toUpperCase())] = v;
  return out;
}

interface ExRow {
  id: string;
  type: string;
  severity: string;
  message: string;
  resolvedAt: string | null;
}

function displayStatus(status: string, exceptions: ExRow[]): "verified" | "attention" | "in_progress" | "failed" | "planned" {
  if (status === "FAILED") return "failed";
  if (status === "PLANNED") return "planned";
  const unresolved = exceptions.filter((e) => !e.resolvedAt);
  if (status === "HUMAN_REVIEW") {
    // Being handled by the team — only the info low_confidence exception (PRD R20).
    if (unresolved.length && unresolved.every((e) => e.type === "low_confidence")) return "in_progress";
    return unresolved.length ? "attention" : "in_progress";
  }
  if (status === "DONE" || status === "EXCEPTION") {
    if (unresolved.length) return "attention";
    return status === "DONE" ? "verified" : "attention";
  }
  return "in_progress";
}

async function exceptionsFor(deps: Deps, verificationId: string): Promise<ExRow[]> {
  const rows = await query<Record<string, unknown>>(
    `select id, type, severity, message, resolved_at from exception where verification_id=$1 order by created_at`,
    [verificationId],
    deps.pool,
  );
  return rows.map((r) => ({
    id: r.id as string,
    type: r.type as string,
    severity: r.severity as string,
    message: r.message as string,
    resolvedAt: (r.resolved_at as Date | null)?.toISOString() ?? null,
  }));
}

export function buildServer(deps: Deps): FastifyInstance {
  const app = Fastify({ logger: false });

  const handlers = {
    verify_patient: {
      handle: async (payload: Record<string, unknown>) => runVerification(deps, payload.verificationId as string),
      onExhausted: async (payload: Record<string, unknown>, err: Error) => {
        const id = payload.verificationId as string;
        await query(`update verification set status='FAILED' where id=$1`, [id], deps.pool);
        await query(
          `insert into exception (verification_id, type, severity, message) values ($1,'verification_failed','critical',$2)`,
          [id, `Automated verification failed after retries: ${err.message}`],
          deps.pool,
        );
      },
    },
  };
  const runner = new JobRunner(deps, handlers);

  let cronTimer: NodeJS.Timeout | null = null;
  app.decorate("deps", deps);
  app.decorate("jobRunner", runner);
  app.decorate("startBackground", () => {
    runner.start();
    if (!deps.config.disableCron) cronTimer = startCron(deps);
  });
  app.decorate("stopBackground", () => {
    runner.stop();
    if (cronTimer) clearInterval(cronTimer);
  });

  // ── connector auth ──
  app.addHook("preHandler", async (req, reply) => {
    if (req.url.startsWith("/internal/")) {
      if (req.headers["x-connector-token"] !== deps.config.connectorToken) {
        reply.code(401).send({ error: "invalid connector token" });
      }
    }
  });

  // ═══ connector-facing ═══════════════════════════════════════════════════
  app.post("/internal/connector/sync", async (req, reply) => {
    const parsed = ConnectorSyncRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const { counts } = await applySync(deps, parsed.data);
    return { ok: true, counts };
  });

  app.get("/internal/connector/writebacks", async (req) => {
    const practiceId = (req.query as { practiceId?: string }).practiceId;
    const rows = await query<Record<string, unknown>>(
      `select id, verification_id, practice_id, target, payload, before_image, status
         from writeback where status='pending'${practiceId ? " and practice_id=$1" : ""}
        order by created_at`,
      practiceId ? [practiceId] : [],
      deps.pool,
    );
    return {
      writebacks: rows.map((r) => ({
        id: r.id,
        verificationId: r.verification_id,
        practiceId: r.practice_id,
        target: r.target,
        payload: r.payload,
        status: r.status,
        beforeImage: r.before_image ?? null,
      })),
    };
  });

  app.post("/internal/connector/writebacks/:id/ack", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { status: "applied" | "failed"; beforeImage?: unknown; error?: string };
    const status = body.status === "applied" ? "applied" : "failed";
    const rows = await query(
      `update writeback set status=$1, before_image=$2, error=$3,
              applied_at = case when $1='applied' then now() else applied_at end
        where id=$4 returning id`,
      [status, body.beforeImage != null ? JSON.stringify(body.beforeImage) : null, body.error ?? null, id],
      deps.pool,
    );
    if (!rows.length) return reply.code(404).send({ error: "writeback not found" });
    await audit("connector", "writeback.ack", `writeback/${id}`, "PHI");
    return { ok: true };
  });

  // ═══ dashboard-facing ═══════════════════════════════════════════════════
  app.get("/api/practices", async () => {
    const rows = await query<Record<string, unknown>>(`select id, name, tz from practice order by name`, [], deps.pool);
    return { practices: rows };
  });

  app.post("/api/batch/run", async (req, reply) => {
    const body = req.body as { practiceId?: string; date?: string };
    if (!body.practiceId || !body.date) return reply.code(400).send({ error: "practiceId and date required" });
    const res = await runBatch(deps, body.practiceId, body.date);
    return res;
  });

  app.get("/api/practices/:id/day/:date/verifications", async (req) => {
    const { id, date } = req.params as { id: string; date: string };
    const rows = await query<Record<string, unknown>>(
      `select v.id, v.scope, v.status, v.completed_at,
              a.starts_at, a.provider, a.cdt_codes,
              pl.first_name, pl.last_name,
              c.carrier_name
         from verification v
         join coverage c on c.id = v.coverage_id
         join patient_link pl on pl.id = c.patient_link_id
         left join appointment a on a.id = v.appointment_id
        where v.practice_id=$1 and v.appt_date=$2::date and v.superseded_by is null
        order by a.starts_at nulls last, v.created_at`,
      [id, date],
      deps.pool,
    );
    const items = [];
    for (const r of rows) {
      const exceptions = await exceptionsFor(deps, r.id as string);
      items.push({
        id: r.id,
        patientName: `${r.first_name} ${r.last_name}`,
        appointmentAt: (r.starts_at as Date | null)?.toISOString() ?? null,
        provider: (r.provider as string) ?? null,
        cdtCodes: (r.cdt_codes as string[]) ?? [],
        carrierName: (r.carrier_name as string) ?? null,
        scope: r.scope,
        status: r.status,
        displayStatus: displayStatus(r.status as string, exceptions),
        exceptions,
        completedAt: (r.completed_at as Date | null)?.toISOString() ?? null,
      });
    }
    return { items };
  });

  app.get("/api/verifications/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const v = await query<Record<string, unknown>>(
      `select v.*, c.id as _cov, a.id as _apt from verification v
         join coverage c on c.id=v.coverage_id
         left join appointment a on a.id=v.appointment_id
        where v.id=$1`,
      [id],
      deps.pool,
    );
    if (!v.length) return reply.code(404).send({ error: "not found" });
    const vr = v[0];
    const coverage = await query<Record<string, unknown>>(
      `select c.*, pl.od_patnum, pl.first_name, pl.last_name, pl.birthdate
         from coverage c join patient_link pl on pl.id=c.patient_link_id where c.id=$1`,
      [vr.coverage_id],
      deps.pool,
    );
    const patient = await query<Record<string, unknown>>(
      `select pl.* from patient_link pl join coverage c on c.patient_link_id=pl.id where c.id=$1`,
      [vr.coverage_id],
      deps.pool,
    );
    const appointment = vr.appointment_id
      ? await query<Record<string, unknown>>(`select * from appointment where id=$1`, [vr.appointment_id], deps.pool)
      : [];
    const steps = await query<Record<string, unknown>>(
      `select * from verification_step where verification_id=$1 order by started_at`,
      [id],
      deps.pool,
    );
    const snapshotRows = await query<Record<string, unknown>>(
      `select canonical, validator_issues, created_at from benefit_snapshot where verification_id=$1`,
      [id],
      deps.pool,
    );
    const exceptions = await exceptionsFor(deps, id);
    const writebacks = await query<Record<string, unknown>>(
      `select id, target, payload, status, before_image, error, created_at, applied_at from writeback where verification_id=$1 order by created_at`,
      [id],
      deps.pool,
    );
    await audit("dashboard", "verification.read", `verification/${id}`, "PHI");

    return {
      verification: camel(vr),
      patient: patient[0] ? camel(patient[0]) : null,
      coverage: coverage[0] ? camel(coverage[0]) : null,
      appointment: appointment[0] ? camel(appointment[0]) : null,
      steps: steps.map(camel),
      snapshot: snapshotRows[0]
        ? {
            verificationId: id,
            breakdown: snapshotRows[0].canonical,
            validatorIssues: snapshotRows[0].validator_issues,
          }
        : null,
      exceptions,
      writebacks: writebacks.map(camel),
    };
  });

  app.post("/api/verifications/:id/reverify", async (req, reply) => {
    const { id } = req.params as { id: string };
    const old = await query<Record<string, unknown>>(
      `select v.coverage_id, v.appointment_id, v.appt_date, v.practice_id, a.cdt_codes, c.last_verified_at
         from verification v join coverage c on c.id=v.coverage_id
         left join appointment a on a.id=v.appointment_id where v.id=$1`,
      [id],
      deps.pool,
    );
    if (!old.length) return reply.code(404).send({ error: "not found" });
    const o = old[0];
    const scope = planScope((o.last_verified_at as Date) ?? null, (o.cdt_codes as string[]) ?? []);
    const nv = await one<{ id: string }>(
      `insert into verification (practice_id, coverage_id, appointment_id, appt_date, scope, status, requested_by)
       values ($1,$2,$3,$4,$5,'PLANNED','reverify') returning id`,
      [o.practice_id, o.coverage_id, o.appointment_id, o.appt_date, scope],
      deps.pool,
    );
    await query(`update verification set superseded_by=$1 where id=$2`, [nv.id, id], deps.pool);
    await enqueue(deps, nv.id);
    return { verificationId: nv.id };
  });

  app.post("/api/patients/:patientLinkId/verify-now", async (req, reply) => {
    const { patientLinkId } = req.params as { patientLinkId: string };
    const body = req.body as { date?: string };
    if (!body.date) return reply.code(400).send({ error: "date required" });
    const cov = await query<Record<string, unknown>>(
      `select c.id, c.last_verified_at, pl.practice_id from coverage c
         join patient_link pl on pl.id=c.patient_link_id
        where c.patient_link_id=$1 order by c.ordinal limit 1`,
      [patientLinkId],
      deps.pool,
    );
    if (!cov.length) return reply.code(404).send({ error: "no coverage for patient" });
    const c = cov[0];
    const apt = await query<Record<string, unknown>>(
      `select a.id, a.cdt_codes from appointment a
        join practice pr on pr.id=a.practice_id
       where a.patient_link_id=$1 and (a.starts_at at time zone pr.tz)::date=$2::date order by a.starts_at limit 1`,
      [patientLinkId, body.date],
      deps.pool,
    );
    const cdt = (apt[0]?.cdt_codes as string[]) ?? [];
    const scope = planScope((c.last_verified_at as Date) ?? null, cdt);
    const nv = await one<{ id: string }>(
      `insert into verification (practice_id, coverage_id, appointment_id, appt_date, scope, status, requested_by)
       values ($1,$2,$3,$4::date,$5,'PLANNED','verify_now') returning id`,
      [c.practice_id, c.id, apt[0]?.id ?? null, body.date, scope],
      deps.pool,
    );
    await enqueue(deps, nv.id);
    return { verificationId: nv.id };
  });

  app.post("/api/exceptions/:id/resolve", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { resolvedBy?: string };
    const rows = await query(
      `update exception set resolved_by=$1, resolved_at=now() where id=$2 returning verification_id`,
      [body.resolvedBy ?? "unknown", id],
      deps.pool,
    );
    if (!rows.length) return reply.code(404).send({ error: "not found" });
    await audit(body.resolvedBy ?? "dashboard", "exception.resolve", `exception/${id}`, "PHI");
    return { ok: true };
  });

  app.get("/api/review-tasks", async (req) => {
    const status = (req.query as { status?: string }).status ?? "open";
    const rows = await query<Record<string, unknown>>(
      `select rt.id, rt.verification_id, rt.status, rt.reason, rt.draft, rt.created_at,
              pl.first_name, pl.last_name, py.payer_key
         from review_task rt
         join verification v on v.id=rt.verification_id
         join coverage c on c.id=v.coverage_id
         join patient_link pl on pl.id=c.patient_link_id
         join payer py on py.id=c.payer_id
        where rt.status=$1 order by rt.created_at`,
      [status],
      deps.pool,
    );
    return {
      tasks: rows.map((r) => ({
        id: r.id,
        verificationId: r.verification_id,
        status: r.status,
        reason: r.reason,
        draft: r.draft,
        patientName: `${r.first_name} ${r.last_name}`,
        payerKey: r.payer_key,
        createdAt: (r.created_at as Date).toISOString(),
      })),
    };
  });

  app.post("/api/review-tasks/:id/complete", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { fields: Record<string, unknown>; reviewer: string };
    const rows = await query<Record<string, unknown>>(
      `select verification_id, draft, status from review_task where id=$1`,
      [id],
      deps.pool,
    );
    if (!rows.length) return reply.code(404).send({ error: "not found" });
    if (rows[0].status === "done") return reply.code(409).send({ error: "already completed" });
    const verificationId = rows[0].verification_id as string;

    const b = BenefitBreakdown.parse(rows[0].draft);
    const labels: Record<string, { model: unknown; human: unknown }> = {};
    for (const [path, value] of Object.entries(body.fields ?? {})) {
      const [group, key] = path.split(".");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const grp = (b as any)[group];
      if (!grp || !(key in grp)) continue;
      const prev = grp[key]?.value ?? null;
      grp[key] = {
        value,
        provenance: { source: "human", artifactId: null, locator: "review", retrievedAt: new Date().toISOString() },
        confidence: "high",
        unavailableReason: null,
      };
      labels[path] = { model: prev, human: value };
    }

    await query(
      `update review_task set status='done', completed_at=now(), labels=$1, draft=$2, assignee=$3 where id=$4`,
      [JSON.stringify(labels), JSON.stringify(b), body.reviewer, id],
      deps.pool,
    );
    await audit(body.reviewer ?? "reviewer", "review.complete", `review_task/${id}`, "PHI");

    await resumeFromReview(deps, verificationId, b);
    return { ok: true, verificationId };
  });

  app.get("/api/artifacts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const { path, contentType } = await deps.artifacts.getPath(id);
      await audit("dashboard", "artifact.read", `artifact/${id}`, "PHI");
      reply.header("content-type", contentType);
      return reply.send(createReadStream(path));
    } catch {
      return reply.code(404).send({ error: "artifact not found" });
    }
  });

  app.get("/api/practices/:id/metrics/summary", async (req) => {
    const { id } = req.params as { id: string };
    const date = (req.query as { date?: string }).date;
    const dateClause = date ? " and appt_date=$2::date" : "";
    const params = date ? [id, date] : [id];
    const vs = await query<Record<string, unknown>>(
      `select id, status, created_at, completed_at from verification where practice_id=$1 and superseded_by is null${dateClause}`,
      params,
      deps.pool,
    );
    const total = vs.length;
    const done = vs.filter((v) => v.status === "DONE").length;
    const ids = vs.map((v) => v.id as string);
    let exceptionCount = 0;
    let reviewedIds = new Set<string>();
    if (ids.length) {
      const ex = await query<{ n: string }>(
        `select count(*)::text as n from exception where verification_id = any($1) and resolved_at is null`,
        [ids],
        deps.pool,
      );
      exceptionCount = Number(ex[0].n);
      const rt = await query<{ verification_id: string }>(
        `select distinct verification_id from review_task where verification_id = any($1)`,
        [ids],
        deps.pool,
      );
      reviewedIds = new Set(rt.map((r) => r.verification_id));
    }
    const durations = vs
      .filter((v) => v.status === "DONE" && v.completed_at)
      .map((v) => (v.completed_at as Date).getTime() - (v.created_at as Date).getTime());
    const avgDurationMs = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
    const fullAuto = vs.filter((v) => v.status === "DONE" && !reviewedIds.has(v.id as string)).length;
    const byStepRows = ids.length
      ? await query<{ kind: string; n: string }>(
          `select kind, count(*)::text as n from verification_step where verification_id = any($1) group by kind`,
          [ids],
          deps.pool,
        )
      : [];
    const byStep: Record<string, number> = {};
    for (const r of byStepRows) byStep[r.kind] = Number(r.n);

    return {
      fullAutoRate: total ? fullAuto / total : 0,
      total,
      done,
      exceptions: exceptionCount,
      avgDurationMs,
      byStep,
    };
  });

  app.get("/health", async () => ({ ok: true }));

  return app;
}

async function enqueue(deps: Deps, verificationId: string): Promise<void> {
  const { enqueueJob } = await import("./jobs/runner.js");
  await enqueueJob(deps, "verify_patient", { verificationId });
}

/** In-process cron: once per minute, if the practice-local hour == BATCH_HOUR, plan tomorrow. */
function startCron(deps: Deps): NodeJS.Timeout {
  const fired = new Set<string>();
  return setInterval(async () => {
    try {
      const practices = await query<{ id: string; tz: string }>(`select id, tz from practice`, [], deps.pool);
      for (const p of practices) {
        const now = new Date();
        const localHour = Number(new Intl.DateTimeFormat("en-US", { hour: "2-digit", hour12: false, timeZone: p.tz }).format(now));
        const localDay = new Intl.DateTimeFormat("en-CA", { timeZone: p.tz }).format(now); // YYYY-MM-DD
        const key = `${p.id}:${localDay}`;
        if (localHour === deps.config.batchHour && !fired.has(key)) {
          fired.add(key);
          const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: p.tz }).format(new Date(now.getTime() + 86_400_000));
          await runBatch(deps, p.id, tomorrow);
        }
      }
    } catch (err) {
      console.error(`[cron] ${(err as Error).message}`);
    }
  }, 60_000);
}
