import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { odsimPool, odsimUrl } from "./db.js";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/**
 * Tiny idempotent migration runner for the odsim database.
 * Mirrors packages/db's runner but is scoped to ODSIM_DATABASE_URL and this
 * app's ./migrations directory, so the practice PMS schema stays independent
 * of the cloud schema.
 */
export async function runOdsimMigrations(): Promise<string[]> {
  const pool = odsimPool();
  await pool.query(
    `create table if not exists odsim_migrations (name text primary key, applied_at timestamptz not null default now())`,
  );
  const applied = new Set(
    (await pool.query<{ name: string }>(`select name from odsim_migrations`)).rows.map((r) => r.name),
  );
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query(`insert into odsim_migrations (name) values ($1)`, [file]);
      await client.query("commit");
      ran.push(file);
    } catch (err) {
      await client.query("rollback");
      throw new Error(`odsim migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  return ran;
}

// CLI: npm run -w @nightshift/od-sim migrate
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runOdsimMigrations()
    .then((ran) => {
      console.log(`[od-sim migrate] target=${odsimUrl()}`);
      console.log(ran.length ? `[od-sim migrate] applied: ${ran.join(", ")}` : "[od-sim migrate] up to date");
      return odsimPool().end();
    })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`[od-sim migrate] ${err.message}`);
      process.exit(1);
    });
}
