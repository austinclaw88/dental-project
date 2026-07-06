import {
  type BenefitBreakdown,
  type EligibilityResult,
  type RawCapture,
  type SubscriberQuery,
  emptyBreakdown,
} from "@nightshift/schema";
import { audit, one, query } from "@nightshift/db";
import type { Deps, PayerAdapter } from "../deps.js";
import { computeExceptions } from "./exceptions.js";
import { computeQa } from "./qa.js";
import { type WritebackContext, buildWritebackRows, compactSummary } from "./writeback.js";

/** Joined view of everything a verification needs. */
interface VerificationCtx {
  id: string;
  practiceId: string;
  scope: "eligibility_only" | "full_breakdown";
  status: string;
  supersededBy: string | null;
  apptDate: string;
  cdtCodes: string[];
  provider: string | null;
  // coverage
  coverageId: string;
  odPlanNum: number;
  odInsSubNum: number;
  subscriberId: string;
  subscriberName: string;
  carrierName: string;
  groupNumber: string | null;
  // patient
  odPatNum: number;
  firstName: string;
  lastName: string;
  birthdate: string;
  // payer
  payerKey: string;
  practiceName: string;
}

export async function loadVerificationCtx(deps: Deps, verificationId: string): Promise<VerificationCtx | null> {
  const rows = await query<Record<string, unknown>>(
    `select v.id, v.practice_id, v.scope, v.status, v.superseded_by, v.appt_date,
            a.cdt_codes, a.provider,
            c.id as coverage_id, c.od_plan_num, c.od_inssub_num, c.subscriber_id, c.subscriber_name, c.carrier_name,
            pl.od_patnum, pl.first_name, pl.last_name, pl.birthdate,
            py.payer_key, pp.group_number,
            pr.name as practice_name
       from verification v
       join coverage c on c.id = v.coverage_id
       join patient_link pl on pl.id = c.patient_link_id
       join payer py on py.id = c.payer_id
       join practice pr on pr.id = v.practice_id
       left join appointment a on a.id = v.appointment_id
       left join payer_plan pp on pp.id = c.payer_plan_id
      where v.id = $1`,
    [verificationId],
    deps.pool,
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id as string,
    practiceId: r.practice_id as string,
    scope: r.scope as VerificationCtx["scope"],
    status: r.status as string,
    supersededBy: (r.superseded_by as string) ?? null,
    apptDate: toIso(r.appt_date),
    cdtCodes: (r.cdt_codes as string[]) ?? [],
    provider: (r.provider as string) ?? null,
    coverageId: r.coverage_id as string,
    odPlanNum: Number(r.od_plan_num),
    odInsSubNum: Number(r.od_inssub_num),
    subscriberId: r.subscriber_id as string,
    subscriberName: r.subscriber_name as string,
    carrierName: r.carrier_name as string,
    groupNumber: (r.group_number as string) ?? null,
    odPatNum: Number(r.od_patnum),
    firstName: r.first_name as string,
    lastName: r.last_name as string,
    birthdate: toIso(r.birthdate),
    payerKey: r.payer_key as string,
    practiceName: r.practice_name as string,
  };
}

function toIso(d: unknown): string {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

function queryFrom(ctx: VerificationCtx): SubscriberQuery {
  return {
    subscriberId: ctx.subscriberId,
    subscriberName: ctx.subscriberName,
    patientFirstName: ctx.firstName,
    patientLastName: ctx.lastName,
    patientBirthdate: ctx.birthdate,
    groupNumber: ctx.groupNumber,
    payerKey: ctx.payerKey,
  };
}

async function setStatus(deps: Deps, id: string, status: string, completed = false): Promise<void> {
  await query(
    `update verification set status=$1${completed ? ", completed_at=now()" : ""} where id=$2`,
    [status, id],
    deps.pool,
  );
}

/** Record a verification_step around `fn`. fn may return artifacts/detail/status. */
async function step<T extends { artifactIds?: string[]; detail?: string; status?: string }>(
  deps: Deps,
  verificationId: string,
  kind: string,
  fn: () => Promise<T>,
): Promise<T> {
  const s = await one<{ id: string }>(
    `insert into verification_step (verification_id, kind, status) values ($1,$2,'running') returning id`,
    [verificationId, kind],
    deps.pool,
  );
  try {
    const r = await fn();
    await query(
      `update verification_step set status=$1, ended_at=now(), artifact_ids=$2, detail=$3 where id=$4`,
      [r.status ?? "succeeded", r.artifactIds ?? [], r.detail ?? null, s.id],
      deps.pool,
    );
    return r;
  } catch (err) {
    await query(
      `update verification_step set status='failed', ended_at=now(), detail=$1 where id=$2`,
      [(err as Error).message, s.id],
      deps.pool,
    );
    throw err;
  }
}

// ── entry point (from job runner) ────────────────────────────────────────────

export async function runVerification(deps: Deps, verificationId: string): Promise<void> {
  const ctx = await loadVerificationCtx(deps, verificationId);
  if (!ctx) throw new Error(`verification ${verificationId} not found`);
  if (ctx.supersededBy) return; // a newer verification replaced this one
  if (["DONE", "EXCEPTION", "FAILED", "HUMAN_REVIEW"].includes(ctx.status)) return; // already terminal/parked

  const q = queryFrom(ctx);

  // 1/2 ── ELIGIBILITY ────────────────────────────────────────────────────
  await setStatus(deps, ctx.id, "ELIGIBILITY");
  const elig = await step(deps, ctx.id, "eligibility", async () => {
    const res = await deps.eligibility.check(q);
    return { result: res, artifactIds: res.artifactId ? [res.artifactId] : [], detail: `active=${res.active}` };
  });
  const eligibility = elig.result;

  if (eligibility.active === false) {
    await handleTerminated(deps, ctx, eligibility);
    return;
  }

  // eligibility_only scope: no breakdown needed.
  if (ctx.scope === "eligibility_only") {
    await finishEligibilityOnly(deps, ctx, eligibility);
    return;
  }

  // 3/4 ── PORTAL then VOICE ───────────────────────────────────────────────
  let captures: RawCapture[] = [];
  const adapter = safeGetAdapter(deps, ctx.payerKey);
  if (adapter) {
    await setStatus(deps, ctx.id, "PORTAL");
    captures = await step(deps, ctx.id, "portal", async () => {
      try {
        const caps = await adapter.fetchBreakdown(q, { artifacts: deps.artifacts });
        if (!caps || caps.length === 0) return { result: [] as RawCapture[], status: "skipped", detail: "portal-miss (empty)" };
        return {
          result: caps,
          artifactIds: caps.flatMap((c) => c.artifactIds),
          detail: `captured ${caps.length} page(s)`,
        };
      } catch (err) {
        return { result: [] as RawCapture[], status: "skipped", detail: `portal-miss: ${(err as Error).message}` };
      }
    }).then((r) => r.result);
  }

  if (captures.length === 0) {
    await setStatus(deps, ctx.id, "VOICE");
    const voice = await step(deps, ctx.id, "voice", async () => {
      const res = await deps.voice.callPayer(q, { practiceName: ctx.practiceName });
      return {
        result: res,
        artifactIds: res.transcriptArtifactId ? [res.transcriptArtifactId] : [],
        status: res.completed ? "succeeded" : "failed",
        detail: res.completed ? "call completed" : `aborted: ${res.abortReason}`,
      };
    }).then((r) => r.result);

    if (voice.completed && voice.transcriptArtifactId) {
      captures = [
        {
          kind: "voice_transcript",
          payerKey: ctx.payerKey,
          artifactIds: [voice.transcriptArtifactId],
          content: voice.transcript,
          capturedAt: new Date().toISOString(),
          meta: { source: "voice" },
        },
      ];
    } else {
      // 5 ── HUMAN_REVIEW (voice failed / no path) ──────────────────────────
      const draft = mergeEligibility(emptyBreakdown(), eligibility);
      await parkForReview(deps, ctx, `voice_incomplete: ${voice.abortReason ?? "no_voice_path"}`, draft);
      return;
    }
  }

  await normalizeAndFinish(deps, ctx, eligibility, captures);
}

// ── terminated ───────────────────────────────────────────────────────────────

async function handleTerminated(deps: Deps, ctx: VerificationCtx, elig: EligibilityResult): Promise<void> {
  const termDate = elig.planEnd ?? "unknown date";
  const firstCdt = ctx.cdtCodes[0] ?? "scheduled";
  const message = `Coverage shows terminated ${termDate} — today's ${firstCdt} visit is patient-pay unless resolved.`;
  await query(
    `insert into exception (verification_id, type, severity, message) values ($1,'coverage_terminated','critical',$2)`,
    [ctx.id, message],
    deps.pool,
  );
  // insplan_note writeback recording the finding (no insverify on terminated).
  const note = `NightShift: coverage TERMINATED ${termDate} per eligibility (271). Verify before treatment — patient-pay otherwise.`;
  await insertWriteback(deps, ctx, "insplan_note", { odPlanNum: ctx.odPlanNum, note });
  await audit("nightshift:workflow", "writeback.create", `verification/${ctx.id}`, "PHI");
  await setStatus(deps, ctx.id, "EXCEPTION");
}

// ── eligibility-only success ─────────────────────────────────────────────────

async function finishEligibilityOnly(deps: Deps, ctx: VerificationCtx, elig: EligibilityResult): Promise<void> {
  const b = mergeEligibility(emptyBreakdown(), elig);
  await saveSnapshot(deps, ctx.id, b);
  const wbCtx = writebackCtx(ctx);
  await insertWriteback(deps, ctx, "insverify", {
    odPlanNum: ctx.odPlanNum,
    odInsSubNum: ctx.odInsSubNum,
    verifiedAt: wbCtx.verifiedAt,
    scope: "eligibility_only",
  });
  await insertWriteback(deps, ctx, "commlog", {
    odPatNum: ctx.odPatNum,
    text: "Eligibility refreshed via NightShift (271).",
  });
  await audit("nightshift:workflow", "writeback.create", `verification/${ctx.id}`, "PHI");
  await setStatus(deps, ctx.id, "DONE", true);
}

// ── normalize → QA → writeback / review ──────────────────────────────────────

async function normalizeAndFinish(
  deps: Deps,
  ctx: VerificationCtx,
  elig: EligibilityResult,
  captures: RawCapture[],
): Promise<void> {
  await setStatus(deps, ctx.id, "NORMALIZE");
  const b = await step(deps, ctx.id, "normalize", async () => {
    const extractor = deps.makeExtractor(ctx.payerKey);
    const extracted = await extractor.extract(captures, { payerKey: ctx.payerKey });
    const merged = mergeEligibility(extracted, elig);
    return { result: merged, artifactIds: captures.flatMap((c) => c.artifactIds) };
  }).then((r) => r.result);

  await setStatus(deps, ctx.id, "QA_GATE");
  const qa = await step(deps, ctx.id, "qa", async () => {
    const verdict = computeQa(b);
    return { result: verdict, detail: `completeness=${verdict.completeness.toFixed(2)} route=${verdict.routeTo}` };
  }).then((r) => r.result);

  if (!qa.pass) {
    const reason =
      `qa_gate: completeness ${qa.completeness.toFixed(2)}` +
      (qa.validatorIssues.length ? `, validator: ${qa.validatorIssues.join("; ")}` : "") +
      (!qa.minConfidenceMet ? ", low-confidence critical field(s)" : "");
    await parkForReview(deps, ctx, reason, b);
    return;
  }

  await finishSuccess(deps, ctx, b);
}

async function finishSuccess(deps: Deps, ctx: VerificationCtx, b: BenefitBreakdown): Promise<void> {
  const exceptions = computeExceptions(b, ctx.cdtCodes);
  await setStatus(deps, ctx.id, "WRITEBACK");

  for (const e of exceptions) {
    await query(
      `insert into exception (verification_id, type, severity, message) values ($1,$2,$3,$4)`,
      [ctx.id, e.type, e.severity, e.message],
      deps.pool,
    );
  }

  await saveSnapshot(deps, ctx.id, b);

  const wbCtx = writebackCtx(ctx);
  const rows = buildWritebackRows(b, wbCtx, exceptions);
  await step(deps, ctx.id, "writeback", async () => {
    for (const row of rows) await insertWriteback(deps, ctx, row.target, row.payload);
    return { detail: `${rows.length} writebacks queued` };
  });
  await audit("nightshift:workflow", "writeback.create", `verification/${ctx.id}`, "PHI");

  await setStatus(deps, ctx.id, "DONE", true);
}

// ── human review parking + resume ────────────────────────────────────────────

async function parkForReview(deps: Deps, ctx: VerificationCtx, reason: string, draft: BenefitBreakdown): Promise<void> {
  await query(
    `insert into review_task (verification_id, status, reason, draft) values ($1,'open',$2,$3)`,
    [ctx.id, reason, JSON.stringify(draft)],
    deps.pool,
  );
  await query(
    `insert into exception (verification_id, type, severity, message) values ($1,'low_confidence','info',$2)`,
    [ctx.id, "Benefits could not be fully verified automatically — queued for our verification team."],
    deps.pool,
  );
  await setStatus(deps, ctx.id, "HUMAN_REVIEW");
}

/** Resume after a reviewer completes a task (called from the review-complete route). */
export async function resumeFromReview(
  deps: Deps,
  verificationId: string,
  correctedBreakdown: BenefitBreakdown,
): Promise<void> {
  const ctx = await loadVerificationCtx(deps, verificationId);
  if (!ctx) throw new Error(`verification ${verificationId} not found`);
  // Human-completed always passes QA → exceptions → writeback → done.
  // Resolve the automated low_confidence exception now that a human finished it.
  await query(
    `update exception set resolved_by='reviewer', resolved_at=now()
      where verification_id=$1 and type='low_confidence' and resolved_at is null`,
    [verificationId],
    deps.pool,
  );
  await finishSuccess(deps, ctx, correctedBreakdown);
}

// ── helpers ──────────────────────────────────────────────────────────────────

function safeGetAdapter(deps: Deps, payerKey: string): PayerAdapter | null {
  try {
    return deps.getAdapter(payerKey);
  } catch {
    return null;
  }
}

export function mergeEligibility(b: BenefitBreakdown, elig: EligibilityResult): BenefitBreakdown {
  const prov = {
    source: "x12_271" as const,
    artifactId: elig.artifactId,
    locator: "271:EB",
    retrievedAt: new Date().toISOString(),
  };
  if (elig.active != null) {
    b.planStatus.active = { value: elig.active, provenance: prov, confidence: "high", unavailableReason: null };
  }
  if (b.planStatus.effectiveDate.value == null && elig.planBegin) {
    b.planStatus.effectiveDate = { value: elig.planBegin, provenance: prov, confidence: "high", unavailableReason: null };
  }
  if (elig.planEnd) {
    b.planStatus.terminationDate = { value: elig.planEnd, provenance: prov, confidence: "high", unavailableReason: null };
  }
  const pys = (elig.raw as { planYearStart?: string }).planYearStart;
  if (b.planStatus.planYearStart.value == null && pys) {
    b.planStatus.planYearStart = { value: pys, provenance: prov, confidence: "high", unavailableReason: null };
  }
  return b;
}

function writebackCtx(ctx: VerificationCtx): WritebackContext {
  return {
    odPlanNum: ctx.odPlanNum,
    odInsSubNum: ctx.odInsSubNum,
    odPatNum: ctx.odPatNum,
    carrierName: ctx.carrierName,
    scope: ctx.scope,
    verifiedAt: new Date().toISOString(),
  };
}

async function saveSnapshot(deps: Deps, verificationId: string, b: BenefitBreakdown): Promise<void> {
  const issues = computeQa(b).validatorIssues;
  await query(
    `insert into benefit_snapshot (verification_id, canonical, validator_issues)
     values ($1,$2,$3)
     on conflict (verification_id) do update set canonical=excluded.canonical, validator_issues=excluded.validator_issues`,
    [verificationId, JSON.stringify(b), JSON.stringify(issues)],
    deps.pool,
  );
}

async function insertWriteback(
  deps: Deps,
  ctx: VerificationCtx,
  target: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await query(
    `insert into writeback (verification_id, practice_id, target, payload, status) values ($1,$2,$3,$4,'pending')`,
    [ctx.id, ctx.practiceId, target, JSON.stringify(payload)],
    deps.pool,
  );
}

// re-exported for tests / metrics
export { compactSummary };
