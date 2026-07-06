import pg from "pg";

const pools = new Map<string, pg.Pool>();

/** Shared Postgres pool per connection string. */
export function getPool(databaseUrl?: string): pg.Pool {
  const url =
    databaseUrl ??
    process.env.DATABASE_URL ??
    "postgres://nightshift:nightshift@127.0.0.1:5432/nightshift";
  let pool = pools.get(url);
  if (!pool) {
    pool = new pg.Pool({ connectionString: url, max: 10 });
    pools.set(url, pool);
  }
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
  pool?: pg.Pool,
): Promise<T[]> {
  const res = await (pool ?? getPool()).query<T>(text, params as never[]);
  return res.rows;
}

export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
  pool?: pg.Pool,
): Promise<T> {
  const rows = await query<T>(text, params, pool);
  if (rows.length !== 1) throw new Error(`expected 1 row, got ${rows.length}: ${text.slice(0, 80)}`);
  return rows[0];
}

export async function maybeOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
  pool?: pg.Pool,
): Promise<T | null> {
  const rows = await query<T>(text, params, pool);
  return rows[0] ?? null;
}

/** Append-only audit log (TDD §5). Every PHI read/write and writeback goes through here. */
export async function audit(
  actor: string,
  action: string,
  object: string,
  phiScope: string | null = null,
  pool?: pg.Pool,
): Promise<void> {
  await query(
    `insert into audit_log (actor, action, object, phi_scope) values ($1,$2,$3,$4)`,
    [actor, action, object, phiScope],
    pool,
  );
}

export { runMigrations } from "./migrate.js";
