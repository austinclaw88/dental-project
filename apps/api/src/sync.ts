import { audit, one, query } from "@nightshift/db";
import type { ConnectorSyncRequest } from "@nightshift/schema";
import type { Deps } from "./deps.js";

/** Practice display defaults when auto-creating on first sync (API-CONTRACT). */
const DEFAULT_PRACTICE_NAME = "Cedar Park Dental Studio";
const DEFAULT_PRACTICE_TZ = "America/Chicago";

/**
 * Upsert practice-scoped patients/coverages/appointments from a connector sync.
 * Auto-creates the practice (fixed dev UUID) and payer rows (by payerKey) on
 * first sight. All natural-key upserts; idempotent.
 */
export async function applySync(deps: Deps, req: ConnectorSyncRequest): Promise<{ counts: Record<string, number> }> {
  const practiceId = req.practiceId;

  await query(
    `insert into practice (id, name, tz) values ($1,$2,$3) on conflict (id) do nothing`,
    [practiceId, DEFAULT_PRACTICE_NAME, DEFAULT_PRACTICE_TZ],
    deps.pool,
  );
  await query(
    `insert into connector (practice_id, version, last_seen_at) values ($1,$2,now())`,
    [practiceId, req.connectorVersion],
    deps.pool,
  ).catch(() => undefined); // connector row is best-effort telemetry

  // ── patients ──
  const patientIdByOd = new Map<number, string>();
  for (const p of req.patients) {
    const row = await one<{ id: string }>(
      `insert into patient_link (practice_id, od_patnum, first_name, last_name, birthdate)
       values ($1,$2,$3,$4,$5::date)
       on conflict (practice_id, od_patnum)
         do update set first_name=excluded.first_name, last_name=excluded.last_name, birthdate=excluded.birthdate
       returning id`,
      [practiceId, p.odPatNum, p.firstName, p.lastName, p.birthdate],
      deps.pool,
    );
    patientIdByOd.set(p.odPatNum, row.id);
  }

  // ── coverages (payer + payer_plan + coverage) ──
  for (const c of req.coverages) {
    const payer = await one<{ id: string }>(
      `insert into payer (payer_key, name) values ($1,$2)
       on conflict (payer_key) do update set name=excluded.name
       returning id`,
      [c.payerKey, c.carrierName],
      deps.pool,
    );
    let payerPlanId: string | null = null;
    if (c.groupNumber) {
      const pp = await one<{ id: string }>(
        `insert into payer_plan (payer_id, group_number, employer_name) values ($1,$2,$3)
         on conflict (payer_id, group_number) do update set employer_name=coalesce(excluded.employer_name, payer_plan.employer_name)
         returning id`,
        [payer.id, c.groupNumber, c.groupName ?? null],
        deps.pool,
      );
      payerPlanId = pp.id;
    }
    const patientLinkId = patientIdByOd.get(c.odPatNum);
    if (!patientLinkId) continue; // coverage for an unsynced patient — skip
    await query(
      `insert into coverage
         (patient_link_id, payer_id, payer_plan_id, od_inssub_num, od_plan_num, carrier_name,
          subscriber_id, subscriber_name, relationship, ordinal, last_verified_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (patient_link_id, od_inssub_num) do update set
          payer_id=excluded.payer_id, payer_plan_id=excluded.payer_plan_id, od_plan_num=excluded.od_plan_num,
          carrier_name=excluded.carrier_name, subscriber_id=excluded.subscriber_id, subscriber_name=excluded.subscriber_name,
          relationship=excluded.relationship, ordinal=excluded.ordinal, last_verified_at=excluded.last_verified_at`,
      [
        patientLinkId,
        payer.id,
        payerPlanId,
        c.odInsSubNum,
        c.odPlanNum,
        c.carrierName,
        c.subscriberId,
        c.subscriberName,
        c.relationship,
        c.ordinal,
        c.lastVerifiedAt,
      ],
      deps.pool,
    );
  }

  // ── appointments ──
  for (const a of req.appointments) {
    const patientLinkId = patientIdByOd.get(a.odPatNum);
    if (!patientLinkId) continue;
    await query(
      `insert into appointment (practice_id, patient_link_id, od_aptnum, starts_at, minutes, provider, cdt_codes, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (practice_id, od_aptnum) do update set
          patient_link_id=excluded.patient_link_id, starts_at=excluded.starts_at, minutes=excluded.minutes,
          provider=excluded.provider, cdt_codes=excluded.cdt_codes, status=excluded.status`,
      [practiceId, patientLinkId, a.odAptNum, a.startsAt, a.minutes, a.provider, a.cdtCodes, a.status],
      deps.pool,
    );
  }

  await audit("connector", "sync", `practice/${practiceId}`, "PHI");

  return {
    counts: {
      patients: req.patients.length,
      coverages: req.coverages.length,
      appointments: req.appointments.length,
    },
  };
}
