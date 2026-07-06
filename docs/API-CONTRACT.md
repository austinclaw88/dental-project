# NightShift MVP — Internal Build Contract

Binding contract between components. **If a component needs something not listed here, extend your own package — do not change `@nightshift/schema`, `@nightshift/db` migrations, or this doc** (integration owner will reconcile).

## Repo layout & ownership

```
packages/schema        shared types (zod)            — FROZEN (integration owner)
packages/db            pg pool + migrations          — FROZEN (integration owner)
packages/portal        adapter framework + adapters  — Agent "portal"
apps/mock-portal       fake payer portal web app     — Agent "portal"
apps/od-sim            OpenDental simulator + seed   — Agent "practice"
apps/connector         practice-side sync agent      — Agent "practice"
apps/api               cloud API + orchestrator      — Agent "api"
apps/dashboard         front-desk UI                 — Agent "dashboard"
```

## Conventions (all agents)

- TypeScript ESM (`"type": "module"`), Node 22, npm workspaces. Import shared code as `@nightshift/schema` / `@nightshift/db` (they export raw `.ts` — consumers run via **tsx**; dashboard transpiles them via Next.js `transpilePackages` or duplicates only display types).
- Dev runner: `tsx` (`"dev": "tsx src/main.ts"` or `tsx watch`). Tests: `vitest`. No build step except dashboard.
- Env via `process.env` with the defaults in `/.env.example`. Never hardcode ports elsewhere.
- All timestamps ISO-8601 UTC. All ids are cloud-side UUIDs unless prefixed `od`.
- Every OpenDental write and PHI-bearing API mutation calls `audit()` from `@nightshift/db`.
- Do NOT run `playwright install` (browsers preinstalled; `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`).
- Postgres available at the URLs in `.env.example` (dbs `nightshift` and `odsim` exist).

## Ports

| Service | Port | Env |
|---|---|---|
| apps/api | 4000 | `API_PORT` |
| apps/dashboard | 3000 | `DASHBOARD_PORT` |
| apps/mock-portal | 4300 | `PORTAL_PORT` |

## Seed universe (Agent "practice" MUST seed exactly this shape)

- 1 practice: **"Cedar Park Dental Studio"**, tz `America/Chicago`.
- Payers (carrier name → payerKey):
  - "Delta Dental MockState" → `mock-delta` (portal-capable)
  - "MetLife Mock" → `mock-metlife` (portal-capable, sparser data)
  - "Guardian Mock" → `mock-guardian` (**phone-only** → voice path)
  - "SunCoast Dental Trust" → `mock-suncoast` (**no portal, no voice script** → human review path)
- 12 patients with appointments **tomorrow** (relative to seed run time, 08:00–16:00 local), CDT codes mixed: prophy/exam/BWX (D1110, D0120, D0274), SRP (D4341), crowns (D2740), composite (D2392), implant crown (D6065). Include at least:
  - 1 patient whose coverage is **terminated** (portal will say so),
  - 1 patient with a **frequency conflict** (D1110 scheduled, 2/2 prophies used),
  - 1 patient with a **waiting period** covering a scheduled crown,
  - 1 patient on `mock-guardian` (voice path), 1 on `mock-suncoast` (human review path),
  - the rest clean verifications.
- Subscriber IDs `SUB-1001`…; group numbers `GRP-ACME`, `GRP-TECHCO`, `GRP-SCHOOL`.
- The **mock portal must recognize the same subscriber IDs** — the portal agent seeds its own member data using this exact table (duplicated constant is fine; file `docs/SEED-UNIVERSE.json` is the source of truth — practice agent writes it, portal agent reads it. Portal agent: if the file doesn't exist yet, create your own members for SUB-1001..SUB-1012 covering the scenarios above and note it).

## apps/api HTTP contract

Auth: dashboard endpoints unauthenticated in dev; connector endpoints require header `x-connector-token: $CONNECTOR_TOKEN`.

### Connector-facing (`/internal`)
- `POST /internal/connector/sync` — body `ConnectorSyncRequest` (schema pkg). Upserts practice-scoped patients/coverages/appointments; creates payer rows on first sight (by `payerKey`). Response `{ok:true, counts:{...}}`.
  - The connector sends the practice id it was configured with. First sync auto-creates the practice row with id = configured UUID `11111111-1111-1111-1111-111111111111` (fixed dev constant `PRACTICE_ID`).
- `GET /internal/connector/writebacks?practiceId=` — `{writebacks: WritebackCommand[]}` with `status='pending'`.
- `POST /internal/connector/writebacks/:id/ack` — body `WritebackAck`. Marks applied/failed, stores before-image.

### Dashboard-facing (`/api`)
- `GET /api/practices` → `{practices:[{id,name,tz}]}`
- `POST /api/batch/run` — body `{practiceId, date}` (date `YYYY-MM-DD`). Plans + enqueues verifications for that date's appointments. Response `{batchId, planned: n}`.
- `GET /api/practices/:id/day/:date/verifications` → `{items: VerificationListItem[]}` sorted by appointment time.
- `GET /api/verifications/:id` → `{verification, patient, coverage, appointment, steps:[verification_step], snapshot: BenefitSnapshot|null, exceptions:[], writebacks:[]}` (snake_case DB rows passed through camelCased).
- `POST /api/verifications/:id/reverify` → `{verificationId}` (new verification superseding the old).
- `POST /api/patients/:patientLinkId/verify-now` — body `{date}` → `{verificationId}`.
- `POST /api/exceptions/:id/resolve` — body `{resolvedBy}`.
- `GET /api/review-tasks?status=open` → `{tasks:[review_task + patientName + payerKey + draft]}`.
- `POST /api/review-tasks/:id/complete` — body `{fields: Record<string, unknown>, reviewer: string}`. Merges corrections into draft breakdown, records labels, resumes the verification (→ NORMALIZE/QA/WRITEBACK).
- `GET /api/artifacts/:id` → serves the artifact file with its content type.
- `GET /api/practices/:id/metrics/summary?date=` → `{fullAutoRate, total, done, exceptions, avgDurationMs, byStep:{...}}` (best effort).

### Job processing
API process runs the job poller in-process (no separate worker binary). `POST /api/batch/run` must result in verifications reaching terminal state without further input (except human-review path, which parks until review completion).

## Writeback payloads (connector interprets)

- `insverify`: `{odPlanNum, odInsSubNum, verifiedAt, scope}` → upsert od `insverify` row (`dateLastVerified`).
- `insplan_note`: `{odPlanNum, note}` → set `od_insplan.plan_note` (before-image = prior note).
- `benefit_rows`: `{odPlanNum, rows:[{cdtFrom, cdtTo, percent, category}]}` → replace agent-tagged benefit rows for that plan (tag via `benefit.entry_source='nightshift'` column in od-sim schema; never touch human-entered rows).
- `commlog`: `{odPatNum, text}` → insert od `commlog` row.
- `document_pdf`: `{odPatNum, title, text}` → od-sim stores as a text "document" row (no real PDF rendering in MVP).

## Portal adapter contract (packages/portal)

```ts
import type { RawCapture, SubscriberQuery, ArtifactStore } from "@nightshift/schema";

export interface PayerAdapter {
  payerKey: string;
  capabilities(): Record<string, boolean>;  // canonical field paths it can populate
  fetchBreakdown(q: SubscriberQuery, deps: { artifacts: ArtifactStore }): Promise<RawCapture[]>;
}
export function getAdapter(payerKey: string): PayerAdapter | null;
export function listAdapters(): PayerAdapter[];
```

- Adapters launch Playwright chromium (`chromium.launch()`; rely on env `PLAYWRIGHT_BROWSERS_PATH`), log in to `PORTAL_URL` with per-payer creds (dev constants exported from the package, e.g. `office@cedarpark.example` / `verify123!`), navigate, and persist artifacts: full-page **screenshot** (png) + **DOM HTML** per meaningful page via the injected `ArtifactStore`.
- `RawCapture.content` = the page HTML. Include `meta.pageName` (`"eligibility" | "benefits" | "history"`).
- Member not found → return `[]` (API treats as portal-miss → fallback).
- Terminated coverage is a normal capture (the portal page shows TERMINATED; extraction reports it).

## Mock portal (apps/mock-portal) requirements

- Payers `mock-delta` and `mock-metlife` under one app: `/:payerKey/login`, `/:payerKey/members?subscriberId=`, `/:payerKey/member/:subscriberId/benefits`, `/:payerKey/member/:subscriberId/history`.
- Session cookie login (dev creds above). Server-rendered HTML tables with realistic messy labels ("Ind. Ded. Rem.", "Prophy 2/CY", footnote-style downgrade text) — the extraction pipeline must work for real content, so make it realistically ugly. `mock-metlife` omits history and downgrades (sparse-data payer).
- Data: from `docs/SEED-UNIVERSE.json` (or its own constants per note above). Must cover: 1 terminated member, 1 frequency-exhausted member (2/2 prophies used), 1 waiting-period-on-major member, plus clean members.

## Extraction / voice / eligibility (apps/api internals)

- `EligibilityProvider`: `MockClearinghouse` — deterministic from coverage data (terminated member returns active:false). Persists a fake-271 JSON artifact.
- `ExtractionProvider`: `HeuristicExtractor` (DOM/table parsing via cheerio or regex — deterministic, default) and `AnthropicExtractor` (used only when `EXTRACTOR=anthropic` and `ANTHROPIC_API_KEY` set) behind one factory. Integration owner reviews the Anthropic implementation.
- `VoicePipeline`: `SimulatedVoice` — for `mock-guardian` returns a scripted realistic benefits-call transcript (hold, IVR, rep read-back) + persists transcript artifact; extraction runs on the transcript. For unknown payers returns `completed:false, abortReason:"no_ivr_map"`.
- QA gate: required-field completeness ≥0.7 AND no validator issues AND no low-confidence critical fields (planStatus.active, categoryCoverage.*) → writeback; else → review_task + status HUMAN_REVIEW + exception `low_confidence`.
- Exceptions computed at NORMALIZE/QA (PRD R16-17): terminated, frequency conflict vs. scheduled CDT, waiting period vs. scheduled CDT, low confidence, verification_failed. Message must say why it matters today.

## Dashboard (apps/dashboard) requirements

Next.js (App Router) or Vite+React if Next install misbehaves (document choice). Pages:
1. **Morning queue** `/` — practice + date picker (default today+1); list from day endpoint; status pills (✅ Verified / ⚠️ Attention / ⏳ In progress / ❌ Failed); exception messages inline; buttons: Re-verify, Resolve exception; "Run nightly batch" button (calls `/api/batch/run`); auto-refresh every 3s while anything in progress.
2. **Verification detail** `/verifications/[id]` — breakdown rendered as the classic paper "insurance breakdown form" (grouped sections; per-field confidence badge + source icon; link to artifact via `/api/artifacts/:id` — screenshots render inline); step timeline; writeback status.
3. **Review queue** `/review` — open tasks; edit draft field values (JSON-ish form is fine for MVP); complete → POST.

Proxy API calls through Next rewrites or fetch directly to `http://127.0.0.1:4000` (env `NEXT_PUBLIC_API_URL`).

## Definition of done (each agent)

- `npm run dev` (or documented equivalent) works from repo root for your workspace.
- `npm test -w <your pkg>` passes; include at least smoke-level tests.
- A `README.md` in your package: run instructions, design notes, deviations.
- No changes outside your owned paths (root package.json devDeps additions allowed only in your own workspace's package.json).
