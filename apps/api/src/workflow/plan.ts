import { randomUUID } from "node:crypto";
import { one, query } from "@nightshift/db";
import type { Deps } from "../deps.js";
import { enqueueJob } from "../jobs/runner.js";

/**
 * Planning rules (API-CONTRACT step 1 / TDD §3.2). full_breakdown when:
 *   - coverage never verified or last verified > 30 days ago, OR
 *   - a high-value family is scheduled (D27xx crowns, D43xx SRP, D60xx–D61xx implants), OR
 *   - frequency-sensitive codes (D11xx, D02xx, D0274) scheduled with no recent verification.
 * Otherwise eligibility_only.
 */
export function planScope(lastVerifiedAt: string | Date | null, cdtCodes: string[]): "full_breakdown" | "eligibility_only" {
  const stale = !lastVerifiedAt || ageDays(lastVerifiedAt) > 30;
  const highValue = cdtCodes.some((c) => /^D27\d\d$/.test(c) || /^D43\d\d$/.test(c) || /^D6[01]\d\d$/.test(c));
  const freqSensitive = cdtCodes.some((c) => /^D11\d\d$/.test(c) || /^D02\d\d$/.test(c) || c === "D0274");
  if (stale || highValue || (freqSensitive && stale)) return "full_breakdown";
  return "eligibility_only";
}

function ageDays(d: string | Date): number {
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
  return (Date.now() - t) / 86_400_000;
}

interface PlanCandidate {
  appointmentId: string;
  coverageId: string;
  lastVerifiedAt: Date | null;
  cdtCodes: string[];
}

/**
 * Plan + enqueue verifications for every scheduled appointment on `date`
 * (one per patient's primary coverage). Skips if a non-superseded DONE
 * verification already exists for that coverage+date. Returns {batchId, planned}.
 */
export async function runBatch(deps: Deps, practiceId: string, date: string): Promise<{ batchId: string; planned: number }> {
  const tzRow = await query<{ tz: string }>(`select tz from practice where id=$1`, [practiceId], deps.pool);
  const tz = tzRow[0]?.tz ?? "America/Chicago";

  const candidates = await query<Record<string, unknown>>(
    `select a.id as appointment_id, a.cdt_codes, c.id as coverage_id, c.last_verified_at
       from appointment a
       join coverage c on c.patient_link_id = a.patient_link_id and c.ordinal = 1
      where a.practice_id = $1
        and a.status = 'scheduled'
        and (a.starts_at at time zone $2)::date = $3::date
      order by a.starts_at`,
    [practiceId, tz, date],
    deps.pool,
  );

  const batchId = randomUUID();
  let planned = 0;

  for (const row of candidates) {
    const cand: PlanCandidate = {
      appointmentId: row.appointment_id as string,
      coverageId: row.coverage_id as string,
      lastVerifiedAt: (row.last_verified_at as Date) ?? null,
      cdtCodes: (row.cdt_codes as string[]) ?? [],
    };

    // Idempotent re-runs: skip if any live (non-superseded) verification exists
    // for this coverage+date, unless everything live has FAILED — only failures
    // get re-attempted, and the new attempt supersedes them.
    const existing = await query<{ id: string; status: string }>(
      `select id, status from verification
        where coverage_id=$1 and appt_date=$2::date and superseded_by is null`,
      [cand.coverageId, date],
      deps.pool,
    );
    if (existing.some((e) => e.status !== "FAILED")) continue;

    const scope = planScope(cand.lastVerifiedAt, cand.cdtCodes);
    const v = await one<{ id: string }>(
      `insert into verification (practice_id, coverage_id, appointment_id, appt_date, scope, status, requested_by)
       values ($1,$2,$3,$4::date,$5,'PLANNED','nightly_batch') returning id`,
      [practiceId, cand.coverageId, cand.appointmentId, date, scope],
      deps.pool,
    );
    if (existing.length) {
      await query(
        `update verification set superseded_by=$1 where coverage_id=$2 and appt_date=$3::date and id <> $1 and superseded_by is null`,
        [v.id, cand.coverageId, date],
        deps.pool,
      );
    }
    await enqueueJob(deps, "verify_patient", { verificationId: v.id });
    planned++;
  }

  return { batchId, planned };
}
