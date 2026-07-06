import pg from "pg";
import { getPool } from "@nightshift/db";

/** Connection string for the practice-side OpenDental simulator DB. */
export function odsimUrl(): string {
  return (
    process.env.ODSIM_DATABASE_URL ??
    "postgres://nightshift:nightshift@127.0.0.1:5432/odsim"
  );
}

/** Shared pool pointed at the odsim database (reuses @nightshift/db's pool cache). */
export function odsimPool(): pg.Pool {
  return getPool(odsimUrl());
}
