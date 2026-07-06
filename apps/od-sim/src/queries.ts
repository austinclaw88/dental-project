import type pg from "pg";
import { query as dbQuery } from "@nightshift/db";
import { odsimPool } from "./db.js";

export { odsimPool, odsimUrl } from "./db.js";
export { runOdsimMigrations } from "./migrate.js";
export { seed } from "./seed.js";
export {
  loadSeedUniverse,
  carrierToPayerKeyMap,
  splitPlanKey,
} from "./seed-universe.js";
export type { SeedUniverse, SeedMember, SeedPlan } from "./seed-universe.js";

/** Run a query against the odsim pool (or a caller-supplied pool/client). */
export function q<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
  pool: pg.Pool = odsimPool(),
): Promise<T[]> {
  return dbQuery<T>(text, params, pool);
}

// ---- Row shapes (snake_case, as stored) ---------------------------------

export interface OdPatientRow {
  pat_num: number;
  l_name: string;
  f_name: string;
  birthdate: string; // YYYY-MM-DD
}

/** One row per patplan (patient <-> subscription), joined to plan + carrier. */
export interface OdCoverageRow {
  pat_num: number;
  inssub_num: number;
  plan_num: number;
  carrier_name: string;
  group_num: string | null;
  group_name: string | null;
  subscriber_external_id: string;
  subscriber_name: string;
  relationship: string;
  ordinal: number;
  date_last_verified: string | null; // ISO datetime or null
}

export interface OdAppointmentRow {
  apt_num: number;
  pat_num: number;
  apt_datetime: string; // ISO UTC
  minutes: number;
  provider: string | null;
  status: string;
}

export interface OdProcedureRow {
  proc_num: number;
  apt_num: number;
  pat_num: number;
  cdt_code: string;
}

export interface OdBenefitRow {
  benefit_num: number;
  plan_num: number;
  cdt_from: string | null;
  cdt_to: string | null;
  percent: number | null;
  category: string | null;
  entry_source: string;
}

export interface OdInsverifyRow {
  insverify_num: number;
  plan_num: number;
  inssub_num: number;
  date_last_verified: string | null;
  verify_scope: string | null;
}

// ---- Read helpers --------------------------------------------------------

export function getPatients(pool?: pg.Pool): Promise<OdPatientRow[]> {
  return q<OdPatientRow>(
    `select pat_num, l_name, f_name, to_char(birthdate,'YYYY-MM-DD') as birthdate
       from od_patient order by pat_num`,
    [],
    pool,
  );
}

export function getCoverages(pool?: pg.Pool): Promise<OdCoverageRow[]> {
  return q<OdCoverageRow>(
    `select pp.pat_num,
            iss.inssub_num,
            ip.plan_num,
            c.carrier_name,
            ip.group_num,
            ip.group_name,
            iss.subscriber_external_id,
            iss.subscriber_name,
            pp.relationship,
            pp.ordinal,
            iv.date_last_verified
       from od_patplan pp
       join od_inssub iss on iss.inssub_num = pp.inssub_num
       join od_insplan ip on ip.plan_num = iss.plan_num
       join od_carrier c  on c.carrier_num = ip.carrier_num
       left join od_insverify iv
             on iv.plan_num = ip.plan_num and iv.inssub_num = iss.inssub_num
      order by pp.pat_num, pp.ordinal`,
    [],
    pool,
  );
}

export function getAppointments(pool?: pg.Pool): Promise<OdAppointmentRow[]> {
  return q<OdAppointmentRow>(
    `select apt_num, pat_num, apt_datetime, minutes, provider, status
       from od_appointment order by apt_datetime, apt_num`,
    [],
    pool,
  );
}

export function getProcedures(pool?: pg.Pool): Promise<OdProcedureRow[]> {
  return q<OdProcedureRow>(
    `select proc_num, apt_num, pat_num, cdt_code
       from od_procedurelog order by apt_num, proc_num`,
    [],
    pool,
  );
}

export function getBenefits(planNum: number, pool?: pg.Pool): Promise<OdBenefitRow[]> {
  return q<OdBenefitRow>(
    `select benefit_num, plan_num, cdt_from, cdt_to, percent, category, entry_source
       from od_benefit where plan_num = $1 order by benefit_num`,
    [planNum],
    pool,
  );
}

export function getInsverify(
  planNum: number,
  inssubNum: number,
  pool?: pg.Pool,
): Promise<OdInsverifyRow | null> {
  return q<OdInsverifyRow>(
    `select insverify_num, plan_num, inssub_num, date_last_verified, verify_scope
       from od_insverify where plan_num = $1 and inssub_num = $2`,
    [planNum, inssubNum],
    pool,
  ).then((rows) => rows[0] ?? null);
}

export function getInsplanNote(planNum: number, pool?: pg.Pool): Promise<string | null> {
  return q<{ plan_note: string }>(
    `select plan_note from od_insplan where plan_num = $1`,
    [planNum],
    pool,
  ).then((rows) => (rows[0] ? rows[0].plan_note : null));
}
