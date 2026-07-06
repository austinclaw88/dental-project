# @nightshift/od-sim

OpenDental **simulator** — a practice-side PMS stand-in. Owns its own Postgres
database (`odsim`, env `ODSIM_DATABASE_URL`) with OpenDental-shaped tables and a
seed script that materializes the demo universe from `docs/SEED-UNIVERSE.json`.

The cloud never touches these tables directly — only the connector
(`@nightshift/connector`) reads them and applies writebacks. This package also
exports typed read helpers used by the connector and tests.

## Run

```bash
# from repo root (env from .env.example; ODSIM_DATABASE_URL must point at the odsim db)
npm run -w @nightshift/od-sim migrate   # create tables (idempotent)
npm run -w @nightshift/od-sim seed      # TRUNCATE + reseed, prints a summary table
npm test -w @nightshift/od-sim          # vitest (re-seeds odsim in setup)
```

`migrate` and `seed` default `ODSIM_DATABASE_URL` to
`postgres://nightshift:nightshift@127.0.0.1:5432/odsim` if unset.

## Schema (migrations/001_odsim_init.sql)

snake_case OpenDental-ish tables, all PKs `generated always as identity`:

`od_carrier`, `od_patient`, `od_insplan` (`plan_note` default `''`), `od_inssub`,
`od_patplan`, `od_appointment`, `od_procedurelog`, `od_insverify`
(`unique(plan_num, inssub_num)`), `od_benefit` (`entry_source` default `'human'`),
`od_commlog`, `od_document`.

Own migration runner (`src/migrate.ts`) — same pattern as `@nightshift/db` but
scoped to `ODSIM_DATABASE_URL` and this app's `migrations/`, tracked in an
`odsim_migrations` table. Reuses `getPool` from `@nightshift/db`.

## Seed (src/seed.ts)

Reseeds exactly the `docs/SEED-UNIVERSE.json` shape:

- **12 patients**, one subscription (`od_inssub`) + active `od_patplan` each.
- **8 plans** (`od_insplan`) — one per SEED-UNIVERSE `plans` key; `group_num`
  from the key suffix, `group_name` = employer.
- **4 carriers** (`od_carrier`) — Delta Dental MockState, MetLife Mock, Guardian
  Mock, SunCoast Dental Trust.
- **Appointments TOMORROW** (relative to run time) at each member's `apptTime`,
  interpreted as `America/Chicago` local wall-time via
  `(date + time) AT TIME ZONE 'America/Chicago'` → stored as `timestamptz`.
- **od_procedurelog** rows for every CDT code on each appointment.
- **od_insverify**: one row per subscription, `date_last_verified = NULL` for
  everyone except `SUB-1001` (set to `now() - 45 days` — deliberately stale per
  the >30-day rule).

### Deliberate design decisions

- **Terminated members keep an active `od_patplan`.** The PMS does not know a
  member's coverage was terminated (only the payer does). `SUB-1004`'s
  termination lives in `SEED-UNIVERSE.json` for the mock portal to surface; it is
  intentionally **not** encoded in od-sim.
- **Human benefit rows are seeded** (`entry_source='human'`, one per coverage
  category — preventive/basic/major/ortho — from the plan's `coverage` map). The
  contract doesn't require seeding `od_benefit`, but real practices hand-enter
  benefits, and it lets the connector's `benefit_rows` writeback prove it never
  touches human-entered rows. NightShift-written rows are tagged
  `entry_source='nightshift'`.
- `od_commlog` / `od_document` start empty — they are populated by connector
  writebacks.

## Exports (src/queries.ts → package main `.`)

Typed read helpers: `getPatients`, `getCoverages` (patplan⋈inssub⋈insplan⋈carrier
⋈insverify), `getAppointments`, `getProcedures`, `getBenefits`, `getInsverify`,
`getInsplanNote`; plus `odsimPool`, `odsimUrl`, `runOdsimMigrations`, `seed`,
`loadSeedUniverse`, `carrierToPayerKeyMap`, `splitPlanKey`, and row types.
