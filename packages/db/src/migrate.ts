import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./index.js";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

export async function runMigrations(databaseUrl?: string): Promise<string[]> {
  const pool = getPool(databaseUrl);
  await pool.query(
    `create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`,
  );
  const applied = new Set(
    (await pool.query<{ name: string }>(`select name from schema_migrations`)).rows.map((r) => r.name),
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
      await client.query(`insert into schema_migrations (name) values ($1)`, [file]);
      await client.query("commit");
      ran.push(file);
    } catch (err) {
      await client.query("rollback");
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  return ran;
}

// CLI entrypoint: npm run -w @nightshift/db migrate
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runMigrations()
    .then((ran) => {
      console.log(ran.length ? `applied: ${ran.join(", ")}` : "up to date");
      process.exit(0);
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
