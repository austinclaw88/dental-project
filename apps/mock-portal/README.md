# @nightshift/mock-portal

Fake payer-portal web app standing in for real dental payer portals. Serves **two**
payers from one server so the portal automation fleet (`@nightshift/portal`) has a
realistic, messy target to log into and scrape.

- `mock-delta`   — Delta Dental MockState (dense, data-rich "legacy" portal)
- `mock-metlife` — MetLife Mock (sparse "modern card" portal, less data)

Server-rendered HTML only (Fastify + inline CSS). All content is data-driven from
`docs/SEED-UNIVERSE.json` — no per-member HTML is hand-written.

## Run

```bash
npm run -w @nightshift/mock-portal dev     # tsx watch, PORTAL_PORT=4300
# or
npm run dev:portal                          # from repo root
```

Then open http://127.0.0.1:4300/ (links to both payer logins).
Login (dev creds from SEED-UNIVERSE.json): `office@cedarpark.example` / `verify123!`

Env: `PORTAL_PORT` (default 4300), `PORTAL_HOST` (default 127.0.0.1),
`SEED_UNIVERSE_PATH` (override the seed file location).

## Routes (per payer prefix `/:payerKey/...`)

| Route | Notes |
|---|---|
| `GET/POST /:payerKey/login` | Session-cookie login. Wrong creds → 401 error page. |
| `GET /:payerKey/members?subscriberId=SUB-1004` | Member search (needs session). Unknown id → "No member found". |
| `GET /:payerKey/member/:subscriberId/benefits` | The key page. Payer-specific messy benefits layout. |
| `GET /:payerKey/member/:subscriberId/history` | **mock-delta only** — utilization/service history. `mock-metlife` → 404. |

Session gating: member pages without a valid `portal_sid` cookie 302-redirect to
`/:payerKey/login`. Unknown payer key → 404.

## Label vocabulary (what the extractor keys off)

**mock-delta (rich):** `Eligibility Status: ACTIVE` / `Eligibility Status: TERMINATED eff MM/DD/YYYY`
(red banner) · `Cal Yr Max` · `Max Used YTD` · `Max Remaining` · `Ind. Ded.` ·
`Ind. Ded. Met` · `Ind. Ded. Rem.` · `Fam. Ded.` · category rows
`Preventive & Diagnostic` / `Basic Restorative` / `Major Restorative` / `Orthodontia` ·
frequencies `Prophy (D1110)  2/CY  Used 1 (last 01/15/2026)` (terse `N/CY`, `N/PY`,
`N/36mo`) · `12 mo waiting period, member effective MM/DD/YYYY` ·
`Missing Tooth Clause: Yes — applies / No` · `Coordination of Benefits (COB): Standard /
Non-Duplication` · downgrade footnotes `†Posterior composites paid at amalgam rate`,
`†PFM crowns paid at base-metal rate` (a `†` marker also tags the affected category row).

**mock-metlife (sparse):** `Coverage: Active` / `Coverage: Terminated MM/DD/YYYY` (pill) ·
`Annual Benefit Maximum` · `Benefits Used` · `Remaining Maximum` ·
`Deductible (Individual)` · `Deductible Met` · coverage classes
`Type I — Preventive` / `Type II — Basic` / `Type III — Major` / `Type IV — Orthodontia` ·
frequency LIMITS only (no used-counts). It deliberately omits service history,
downgrades, missing-tooth and COB (one disclaimer line names them as "not available
through this portal" so the extractor can mark them unavailable-from-payer).

## Scenario coverage (from the seed)

- Terminated: **SUB-1004** (mock-delta/GRP-TECHCO) — red TERMINATED banner.
- Frequency exhausted: **SUB-1002** (mock-delta) — Prophy Used 2 of 2/CY.
- Waiting period on major: **SUB-1003** (mock-delta/GRP-TECHCO) — 12-mo major wait,
  member effective 03/01/2026.
- Sparse clean: **SUB-1006 / 1007 / 1012** (mock-metlife).
- Clean rich: SUB-1001, 1005, 1010, 1011 (mock-delta).

Note: only `mock-delta` and `mock-metlife` members are served here. `mock-guardian`
(voice) and `mock-suncoast` (human-review) members are intentionally absent — a search
for them returns "No member found".

## Test

```bash
npm test -w @nightshift/mock-portal
```

Fastify-`inject` HTTP smoke tests (no browser): auth gating, both payer styles, and
each required scenario member.

## Design notes / deviations

- **Fastify** (+ `@fastify/cookie`, `@fastify/formbody`) chosen over Express; exported
  `buildServer()` factory + tiny `main.ts` so `@nightshift/portal` tests can boot it on
  an ephemeral port.
- Effective dates are synthesized deterministically from `planYearStart` (calendar →
  2026-01-01; `MM-DD` → 2025-MM-DD) or from a member's `memberSince`. The seed has no
  explicit effective date, so this is a display convention.
- Family-deductible "met" isn't in the seed → rendered `—`.
- The seed file is the source of truth; if it is missing, startup throws with the paths
  it tried (set `SEED_UNIVERSE_PATH`).
