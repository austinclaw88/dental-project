import { fileURLToPath } from "node:url";
import { odsimPool, odsimUrl } from "./db.js";
import { runOdsimMigrations } from "./migrate.js";
import { loadSeedUniverse, splitPlanKey } from "./seed-universe.js";

/** YYYY-MM-DD for "tomorrow" in the given IANA timezone, relative to now. */
function tomorrowInTz(tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [y, m, d] = parts.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

interface SummaryRow {
  patient: string;
  subscriberId: string;
  payerCarrier: string;
  group: string | null;
  apptLocal: string;
  cdt: string;
  lastVerified: string;
  scenario: string;
}

export async function seed(): Promise<SummaryRow[]> {
  await runOdsimMigrations();
  const uni = loadSeedUniverse();
  const tz = uni.practice.tz;
  const apptDate = tomorrowInTz(tz);

  const pool = odsimPool();
  const client = await pool.connect();
  const summary: SummaryRow[] = [];
  try {
    await client.query("begin");

    // Full reset (TRUNCATE + reseed) — identity counters reset too.
    await client.query(
      `truncate od_procedurelog, od_appointment, od_patplan, od_inssub, od_insverify,
                 od_benefit, od_document, od_commlog, od_insplan, od_patient, od_carrier
       restart identity cascade`,
    );

    // 1) Carriers (distinct, stable order of first appearance).
    const carrierNum = new Map<string, number>();
    for (const plan of Object.values(uni.plans)) {
      if (!carrierNum.has(plan.carrierName)) {
        const { rows } = await client.query<{ carrier_num: number }>(
          `insert into od_carrier (carrier_name) values ($1) returning carrier_num`,
          [plan.carrierName],
        );
        carrierNum.set(plan.carrierName, rows[0].carrier_num);
      }
    }

    // 2) Plans (one per plan key) + human-entered benefit rows.
    const planNum = new Map<string, number>();
    for (const [planKey, plan] of Object.entries(uni.plans)) {
      const { groupNum } = splitPlanKey(planKey);
      const { rows } = await client.query<{ plan_num: number }>(
        `insert into od_insplan (carrier_num, group_num, group_name, plan_note)
         values ($1,$2,$3,'') returning plan_num`,
        [carrierNum.get(plan.carrierName), groupNum, plan.employer],
      );
      const pnum = rows[0].plan_num;
      planNum.set(planKey, pnum);

      // Human-entered category benefits (percent by category). These are the
      // rows the connector must NEVER touch on benefit_rows writeback.
      for (const category of ["preventive", "basic", "major", "ortho"] as const) {
        const pct = plan.coverage[category];
        await client.query(
          `insert into od_benefit (plan_num, cdt_from, cdt_to, percent, category, entry_source)
           values ($1, null, null, $2, $3, 'human')`,
          [pnum, pct, category],
        );
      }
    }

    // 3) Members: patient, subscription, patplan, insverify, appointment, procedures.
    for (const m of uni.members) {
      const patName = `${m.patient.first} ${m.patient.last}`;
      const { rows: pr } = await client.query<{ pat_num: number }>(
        `insert into od_patient (l_name, f_name, birthdate) values ($1,$2,$3) returning pat_num`,
        [m.patient.last, m.patient.first, m.patient.birthdate],
      );
      const patNum = pr[0].pat_num;

      const pnum = planNum.get(m.plan);
      if (pnum == null) throw new Error(`unknown plan key ${m.plan} for ${m.subscriberId}`);

      const subscriberName = m.relationship === "self" ? patName : m.subscriberName ?? patName;
      const { rows: sr } = await client.query<{ inssub_num: number }>(
        `insert into od_inssub (plan_num, subscriber_external_id, subscriber_name)
         values ($1,$2,$3) returning inssub_num`,
        [pnum, m.subscriberId, subscriberName],
      );
      const inssubNum = sr[0].inssub_num;

      // patplan — the practice's active link. NOTE: terminated members keep an
      // active patplan here; the PMS does not know coverage ended (the payer does).
      await client.query(
        `insert into od_patplan (pat_num, inssub_num, ordinal, relationship)
         values ($1,$2,1,$3)`,
        [patNum, inssubNum, m.relationship],
      );

      // insverify — NULL for everyone except SUB-1001 (45 days ago = stale > 30d rule).
      const isStaleSeed = m.subscriberId === "SUB-1001";
      await client.query(
        `insert into od_insverify (plan_num, inssub_num, date_last_verified, verify_scope)
         values ($1,$2, ${isStaleSeed ? "now() - interval '45 days'" : "null"}, $3)`,
        [pnum, inssubNum, isStaleSeed ? "full_breakdown" : null],
      );

      // appointment tomorrow at member's local apptTime (America/Chicago).
      const { rows: ar } = await client.query<{ apt_num: number; iso: string; local: string }>(
        `insert into od_appointment (pat_num, apt_datetime, minutes, provider, status)
         values ($1, (($2::date + $3::time) at time zone $4), $5, $6, 'scheduled')
         returning apt_num,
                   apt_datetime as iso,
                   to_char(apt_datetime at time zone $4, 'YYYY-MM-DD HH24:MI') as local`,
        [patNum, apptDate, m.apptTime, tz, m.minutes, m.provider],
      );
      const aptNum = ar[0].apt_num;

      for (const cdt of m.cdt) {
        await client.query(
          `insert into od_procedurelog (apt_num, pat_num, cdt_code) values ($1,$2,$3)`,
          [aptNum, patNum, cdt],
        );
      }

      summary.push({
        patient: patName,
        subscriberId: m.subscriberId,
        payerCarrier: uni.plans[m.plan].carrierName,
        group: splitPlanKey(m.plan).groupNum,
        apptLocal: ar[0].local,
        cdt: m.cdt.join(","),
        lastVerified: isStaleSeed ? "45d ago (stale)" : "never",
        scenario: m.scenario,
      });
    }

    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }

  return summary;
}

function printSummary(rows: SummaryRow[]): void {
  console.log(`\n[od-sim seed] ${rows.length} patients seeded (appointments = tomorrow, ${loadSeedUniverse().practice.tz}):\n`);
  const header = ["Patient", "Subscriber", "Carrier", "Group", "Appt (local)", "CDT", "LastVerified", "Scenario"];
  const table = [header, ...rows.map((r) => [
    r.patient, r.subscriberId, r.payerCarrier, r.group ?? "-", r.apptLocal, r.cdt, r.lastVerified, r.scenario,
  ])];
  const widths = header.map((_, i) => Math.max(...table.map((row) => String(row[i]).length)));
  for (const row of table) {
    console.log(row.map((c, i) => String(c).padEnd(widths[i])).join("  "));
  }
  console.log("");
}

// CLI: npm run -w @nightshift/od-sim seed
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(`[od-sim seed] target=${odsimUrl()}`);
  seed()
    .then((rows) => {
      printSummary(rows);
      return odsimPool().end();
    })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`[od-sim seed] failed: ${(err as Error).message}`);
      process.exit(1);
    });
}
