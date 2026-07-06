# @nightshift/connector

Practice-side sync agent (TDD §3.1). A long-running process that lives inside the
dental office next to OpenDental. Every poll interval it:

1. **Syncs up** — reads `@nightshift/od-sim`, maps rows to a `ConnectorSyncRequest`
   DTO (`@nightshift/schema`), and `POST`s to
   `${API_BASE_URL}/internal/connector/sync` with header
   `x-connector-token: $CONNECTOR_TOKEN`. Sends only when the payload hash changed
   since the last successful sync (always sends on the first loop).
2. **Applies writebacks** — `GET`s pending `WritebackCommand`s from
   `${API_BASE_URL}/internal/connector/writebacks?practiceId=...`, applies each to
   od-sim **transactionally**, captures a before-image, and `POST`s a
   `WritebackAck` to `.../writebacks/:id/ack`.

`practiceId` is the fixed dev constant `11111111-1111-1111-1111-111111111111`.

## Run

```bash
# from repo root
npm run -w @nightshift/connector dev     # tsx src/main.ts, runs forever
npm test -w @nightshift/connector        # vitest (mapping + writeback)
```

Env (defaults from `.env.example`): `API_BASE_URL` (http://127.0.0.1:4000),
`CONNECTOR_TOKEN` (dev-connector-token), `CONNECTOR_POLL_MS` (5000),
`ODSIM_DATABASE_URL`.

It is expected and fine that the API `404`s / `ECONNREFUSED`s right now — the
connector logs each attempt and keeps polling (see Resilience).

## Design notes

- **payerKey mapping** (`carrier_name → payerKey`) is derived at load time from
  `docs/SEED-UNIVERSE.json` (via od-sim's `carrierToPayerKeyMap()`): each plan
  key's prefix is the payerKey and the plan carries the carrier name, e.g.
  `"Delta Dental MockState" → "mock-delta"`. Unknown carriers fall back to a
  lowercased carrier name.
- **cdtCodes** come from `od_procedurelog` joined by `apt_num`.
- **lastVerifiedAt** in `SyncCoverage` comes from `od_insverify.date_last_verified`.
- **Mapping is pure** (`buildSyncRequestFromRows`) and separate from IO
  (`buildSyncRequest`), so it is unit-testable without a DB. Every DTO is run
  through `zod.parse` before it leaves the process.
- **Writebacks** (`src/writeback.ts`) — one transaction per command, per the
  contract's "Writeback payloads":
  - `insverify` → upsert `od_insverify` (`on conflict (plan_num, inssub_num)`),
    before-image = `{ previous: <prior row|null> }`.
  - `insplan_note` → set `od_insplan.plan_note`, before-image = `{ planNote }`.
  - `benefit_rows` → delete only `entry_source='nightshift'` rows for the plan,
    insert the new rows tagged `'nightshift'`; **never touches `'human'` rows**.
    before-image = `{ deletedRows, inserted }`.
  - `commlog` → insert `od_commlog` (before-image `null`).
  - `document_pdf` → insert `od_document` text row (before-image `null`).
  - Unknown target → `WritebackAck{status:'failed', error}` (no throw).

## Resilience

`fetch` calls have an `AbortController` timeout and are individually try/caught.
API outages are logged (`sync POST failed … will retry`) and the loop continues.
A per-command guard and a per-tick backstop ensure a single bad writeback or a
network blip never crashes the process. `SIGINT`/`SIGTERM` drain the pool and exit
cleanly.

## Deviation: TypeScript instead of Go

The TDD specifies the production connector as a **Go** binary (small, static,
easy to ship into a practice as an agent/service). For the MVP this is
implemented in **TypeScript + tsx** to share `@nightshift/schema` zod DTOs and
`@nightshift/od-sim` helpers directly and keep the whole monorepo one toolchain.
The loop structure, hashing/change-detection, transactional writeback semantics,
and before-image journaling are the reference behavior a Go rewrite would port
1:1.
