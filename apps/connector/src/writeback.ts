import type pg from "pg";
import { WritebackAck, type WritebackCommand } from "@nightshift/schema";
import { odsimPool } from "@nightshift/od-sim";

/**
 * Apply one WritebackCommand to the od-sim (OpenDental) database.
 * Each command runs in its own transaction; before-images are captured for the
 * revert journal (PRD R14). Returns a WritebackAck (never throws) so the caller
 * can POST the ack regardless of outcome.
 */
export async function applyWriteback(
  cmd: WritebackCommand,
  pool: pg.Pool = odsimPool(),
): Promise<WritebackAck> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const beforeImage = await applyByTarget(cmd, client);
    await client.query("commit");
    return WritebackAck.parse({ status: "applied", beforeImage, error: null });
  } catch (err) {
    await client.query("rollback").catch(() => {});
    return WritebackAck.parse({
      status: "failed",
      beforeImage: null,
      error: (err as Error).message,
    });
  } finally {
    client.release();
  }
}

type P = Record<string, unknown>;

async function applyByTarget(
  cmd: WritebackCommand,
  client: pg.PoolClient,
): Promise<Record<string, unknown> | null> {
  const p = cmd.payload as P;
  switch (cmd.target) {
    case "insverify":
      return applyInsverify(p, client);
    case "insplan_note":
      return applyInsplanNote(p, client);
    case "benefit_rows":
      return applyBenefitRows(p, client);
    case "commlog":
      return applyCommlog(p, client);
    case "document_pdf":
      return applyDocument(p, client);
    default:
      throw new Error(`unknown writeback target: ${(cmd as { target: string }).target}`);
  }
}

// insverify: upsert od_insverify (date_last_verified), before = prior row or null.
async function applyInsverify(p: P, client: pg.PoolClient) {
  const planNum = num(p.odPlanNum, "odPlanNum");
  const subNum = num(p.odInsSubNum, "odInsSubNum");
  const verifiedAt = p.verifiedAt == null ? null : String(p.verifiedAt);
  const scope = p.scope == null ? null : String(p.scope);

  const prev = (
    await client.query(
      `select insverify_num, plan_num, inssub_num, date_last_verified, verify_scope
         from od_insverify where plan_num=$1 and inssub_num=$2`,
      [planNum, subNum],
    )
  ).rows[0] ?? null;

  await client.query(
    `insert into od_insverify (plan_num, inssub_num, date_last_verified, verify_scope)
     values ($1,$2,$3,$4)
     on conflict (plan_num, inssub_num)
     do update set date_last_verified = excluded.date_last_verified,
                   verify_scope       = excluded.verify_scope`,
    [planNum, subNum, verifiedAt, scope],
  );
  return { previous: prev };
}

// insplan_note: set plan_note, before = prior note.
async function applyInsplanNote(p: P, client: pg.PoolClient) {
  const planNum = num(p.odPlanNum, "odPlanNum");
  const note = p.note == null ? "" : String(p.note);
  const prev = (
    await client.query<{ plan_note: string }>(
      `select plan_note from od_insplan where plan_num=$1`,
      [planNum],
    )
  ).rows[0];
  if (!prev) throw new Error(`insplan_note: plan_num ${planNum} not found`);
  await client.query(`update od_insplan set plan_note=$2 where plan_num=$1`, [planNum, note]);
  return { planNote: prev.plan_note };
}

// benefit_rows: replace only entry_source='nightshift' rows; never touch 'human'.
async function applyBenefitRows(p: P, client: pg.PoolClient) {
  const planNum = num(p.odPlanNum, "odPlanNum");
  const rows = Array.isArray(p.rows) ? (p.rows as P[]) : [];

  const deleted = (
    await client.query(
      `select benefit_num, plan_num, cdt_from, cdt_to, percent, category, entry_source
         from od_benefit where plan_num=$1 and entry_source='nightshift'
         order by benefit_num`,
      [planNum],
    )
  ).rows;

  await client.query(
    `delete from od_benefit where plan_num=$1 and entry_source='nightshift'`,
    [planNum],
  );

  for (const r of rows) {
    await client.query(
      `insert into od_benefit (plan_num, cdt_from, cdt_to, percent, category, entry_source)
       values ($1,$2,$3,$4,$5,'nightshift')`,
      [
        planNum,
        r.cdtFrom ?? null,
        r.cdtTo ?? null,
        r.percent ?? null,
        r.category ?? null,
      ],
    );
  }
  return { deletedRows: deleted, inserted: rows.length };
}

// commlog: insert a communication log entry (no prior state).
async function applyCommlog(p: P, client: pg.PoolClient) {
  const patNum = num(p.odPatNum, "odPatNum");
  const text = p.text == null ? "" : String(p.text);
  await client.query(
    `insert into od_commlog (pat_num, log_datetime, note) values ($1, now(), $2)`,
    [patNum, text],
  );
  return null;
}

// document_pdf: store as a text "document" row (no real PDF in MVP).
async function applyDocument(p: P, client: pg.PoolClient) {
  const patNum = num(p.odPatNum, "odPatNum");
  const title = p.title == null ? "" : String(p.title);
  const text = p.text == null ? "" : String(p.text);
  await client.query(
    `insert into od_document (pat_num, title, body_text, created_at)
     values ($1,$2,$3, now())`,
    [patNum, title, text],
  );
  return null;
}

function num(v: unknown, field: string): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw new Error(`invalid ${field}: ${String(v)}`);
  return n;
}
