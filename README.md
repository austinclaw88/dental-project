# NightShift — AI Insurance Verification & Benefits Intelligence Agent

MVP implementation of the winning opportunity from the [dental venture discovery exercise](dental-venture-discovery.md), built to the [PRD](docs/PRD-insurance-verification-agent.md) and [TDD](docs/TDD-insurance-verification-agent.md).

NightShift verifies every patient on tomorrow's schedule overnight: eligibility via clearinghouse, **full plan-level benefit breakdowns** via payer-portal automation (real Playwright), **AI voice calls** where portals can't serve (simulated in dev), everything normalized into a canonical benefits schema with per-field **provenance + confidence**, written back into OpenDental, and surfaced to the front desk as a morning exception queue.

## What's real vs. simulated in this MVP

| Component | Status |
|---|---|
| Cloud schema, verification state machine, durable job runner | Real (Postgres; Temporal-shaped runner per TDD note) |
| Portal automation | Real Playwright/Chromium against a **mock payer portal** (2 payers, realistically messy HTML) |
| Extraction → canonical breakdown w/ provenance & confidence | Real (heuristic parser default; Anthropic structured-output extractor behind `EXTRACTOR=anthropic`) |
| Voice calls to payers | Simulated pipeline (scripted transcripts; Twilio integration is post-MVP) |
| Eligibility (270/271) | Mock clearinghouse (deterministic; real clearinghouse is a partner decision) |
| OpenDental | Simulator (`odsim` Postgres DB with OpenDental-shaped tables) + practice-side connector doing sync & auditable writeback |
| Front-desk dashboard, review queue | Real |

## Monorepo layout

```
packages/schema     canonical BenefitBreakdown, DTOs, provider interfaces (the contract)
packages/db         Postgres pool + cloud migrations (TDD §4 schema)
packages/portal     PayerAdapter framework + Playwright adapters (capture-then-extract)
apps/mock-portal    fake payer portals (mock-delta, mock-metlife)
apps/od-sim         OpenDental simulator + seed (12 patients, 4 payers, every scenario)
apps/connector      practice-side sync agent (sync up, writebacks down, before-images)
apps/api            cloud API + verification orchestrator + providers + review queue
apps/dashboard      morning exception queue, verification detail w/ provenance, review UI
docs/               PRD, TDD, API contract, seed universe
```

## Quick start

Prereqs: Node ≥20, Postgres running with databases `nightshift` and `odsim` (role `nightshift`/`nightshift`), Playwright Chromium available.

```bash
npm install
bash scripts/demo.sh
```

The demo script migrates both DBs, seeds the practice (appointments tomorrow), starts the mock portal, API, connector, and dashboard, then triggers the nightly batch. Open **http://127.0.0.1:3000** and watch the morning queue fill in: clean verifications go green; the seeded scenarios (terminated coverage, frequency conflict, waiting period, phone-only payer, no-automation payer) exercise every path — portal, voice, human review, exceptions.

Run everything individually:

```bash
npm run migrate                      # cloud DB
npm run -w @nightshift/od-sim migrate && npm run seed:odsim
npm run dev:portal                   # :4300
npm run dev:api                      # :4000
npm run dev:connector
npm run dev:dashboard                # :3000
```

Tests: `npm test` (workspace tests: seed/mapping/writeback, adapter capture, workflow paths, dashboard rendering).

## Demo walkthrough

1. **Morning queue** (`/`) — pick tomorrow's date, hit "Run nightly batch". Verifications stream through PLANNED → ELIGIBILITY → PORTAL/VOICE → NORMALIZE → QA → WRITEBACK.
2. **James Porter** shows ⚠️ critical: coverage terminated 05/31 — caught before the visit.
3. **Marcus Webb** shows ⚠️ frequency conflict: D1110 scheduled but 2/2 prophies used.
4. **Elena Rossi** shows ⚠️ waiting period: crown scheduled inside the 12-month major waiting period.
5. **Luis Romero** (Guardian, phone-only) verifies via the simulated payer call — open the detail page and read the transcript artifact.
6. **Grace Liu** (SunCoast, no automation) parks in the **review queue** (`/review`) — complete the review and watch her go green with human-source provenance.
7. Any detail page: every field shows source icon + confidence badge; screenshots of the actual portal pages open from the field's provenance link. Check the od-sim database (`od_insplan.plan_note`, `od_benefit` rows tagged `entry_source='nightshift'`, `od_insverify`) to see the writeback.

## Production deltas (documented in the TDD)

Real deployment swaps: mock clearinghouse → Stedi/DentalXChange/Onederful; mock portal adapters → real payer adapters (same interface); simulated voice → Twilio + realtime speech pipeline; job runner → Temporal; od-sim → real OpenDental (API-first connector, Go); plus the credential vault (KMS), BAAs, and the compliance posture in TDD §5.
