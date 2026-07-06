# @nightshift/api — Cloud API & Verification Orchestrator

The core of the NightShift MVP: the HTTP API the connector and dashboard talk to,
plus the durable workflow that verifies a patient's dental insurance benefits
(eligibility → portal → voice → human review → normalize → QA → writeback).

## Run

```bash
# from repo root — DB must be migrated (npm run migrate)
npm run -w @nightshift/api dev        # tsx watch src/main.ts  (port 4000)
npm test  -w @nightshift/api          # vitest (real Postgres `nightshift` DB)
```

`main.ts` runs migrations (idempotent), builds real dependencies, starts the HTTP
server, the in-process job poller, and the nightly cron. The connector and portal
packages being absent does **not** crash boot — the portal path simply disables and
verifications fall through to voice/human review.

Env (defaults in `/.env.example`): `API_PORT`, `CONNECTOR_TOKEN`, `ARTIFACTS_DIR`,
`JOB_CONCURRENCY` (4), `JOB_LOCK_TIMEOUT_SEC` (60), `EXTRACTOR` (`heuristic`|`anthropic`),
`ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (`claude-sonnet-5`), `BATCH_HOUR` (2),
`DISABLE_CRON` (set `1` in tests).

## Architecture — file map

```
src/
  main.ts                    thin entry: migrate → buildDefaultDeps → buildServer → listen → startBackground
  config.ts                  env → Config; PRACTICE_ID dev constant
  seed.ts                    loader for docs/SEED-UNIVERSE.json (mock providers only)
  deps.ts                    Deps interface + buildDefaultDeps(); optional @nightshift/portal import (defensive)
  server.ts                  buildServer(deps) — every HTTP route + displayStatus mapping + in-process cron
  sync.ts                    applySync() — connector sync upserts (practice/payer/patient/coverage/appointment)
  artifacts/store.ts         FsArtifactStore — writes ARTIFACTS_DIR + `artifact` row; GET /api/artifacts/:id streams
  jobs/runner.ts             JobRunner — durable poller (claim-for-update-skip-locked, concurrency, retry/backoff, crash-safe)
  providers/
    clearinghouse.ts         MockClearinghouse (EligibilityProvider) — deterministic 271 from SEED, persists x12 artifact
    voice.ts                 SimulatedVoice (VoicePipeline) — mock-guardian scripted transcript; others abort no_ivr_map
    extractor/
      heuristic.ts           HeuristicExtractor (default) — cheerio + keyword rules; parses BOTH portal vocabularies + transcripts
      anthropic.ts           AnthropicExtractor — schema-constrained LLM (EXTRACTOR=anthropic); graceful fallback
      factory.ts             makeExtractorFactory(config) — heuristic default; anthropic-with-heuristic-fallback wrapper
  workflow/
    plan.ts                  planScope() + runBatch() — plan/enqueue verifications for a date
    verify.ts                VerifyPatientWorkflow state machine (runVerification, resumeFromReview)
    qa.ts                    computeQa() + REQUIRED_FIELDS / CRITICAL_FIELDS
    exceptions.ts            computeExceptions() — frequency/waiting/deductible vs today's CDT
    writeback.ts             buildWritebackRows() — insverify/insplan_note/benefit_rows/commlog/document_pdf payloads
test/
  helpers.ts                 fake adapter registry + SEED-derived fixture HTML + db reset + sync builder
  workflow.test.ts           scenarios (a)–(f) with injected fakes
```

## Durable job runner (instead of Temporal)

Per the TDD §3.2 note, the workflow engine is a Postgres-backed poller, not Temporal.
`JobRunner` claims with `update job set status='running', attempts=attempts+1 where id in
(select id … for update skip locked)`, runs up to `JOB_CONCURRENCY` concurrently, retries
with exponential backoff up to `max_attempts`, and is **crash-safe**: a row left in
`running` becomes claimable again once `locked_at` is older than `JOB_LOCK_TIMEOUT_SEC`
(a killed process never strands its jobs). Job kind `verify_patient` carries `{verificationId}`;
on exhausted retries the runner sets the verification `FAILED` + a `verification_failed` exception.
Tests drive it deterministically via `jobRunner.drain()`.

## QA gate — enforced required fields

`completeness = populated / 9 ≥ 0.7`, over:
`planStatus.active`, `annualMaximum.total`, `annualMaximum.remaining`,
`deductible.individual`, `deductible.individualMet`,
`categoryCoverage.{preventive,basic,major,ortho}`.
Pass requires **also**: no `validateBreakdown()` issues **and** no low-confidence
**critical** field (`planStatus.active`, `categoryCoverage.*`). Fail → review_task +
`HUMAN_REVIEW` + info `low_confidence` exception. Human-completed reviews always pass QA.

## benefit_rows CDT-range mapping (derived from categoryCoverage)

| category | CDT ranges |
|---|---|
| preventive | D0100–D1999 |
| basic | D2000–D2699, D3000–D3999, D4000–D4999, D7000–D7999 |
| major | D2700–D2999, D5000–D5899, D6000–D6999 |
| ortho | D8000–D8999 |

Rows are emitted only where the category percent is known; the connector tags them
`entry_source='nightshift'` so human-entered rows are never touched.

## Voice transcript line grammar (shared by SimulatedVoice + HeuristicExtractor)

Benefit facts are parsed **only** from lines shaped `REP: <label>: <value>`
(e.g. `REP: Annual maximum: $1,500.00`, `REP: Prophylaxis: 2 per calendar year, 1 used, last on 02/10/2026`).
Non-`REP:` lines (`IVR:`, `HOLD`, `AGENT:`, `SYSTEM:`) and `REP:` lines without a
`key: value` pair are conversational scaffolding and ignored. The label keyword set is
identical to the HTML extractor's, so one matcher handles portal tables and transcripts.
Full spec in `src/providers/voice.ts`.

## Provenance & confidence

Every populated field carries `{source, artifactId, locator, retrievedAt}`:
`portal` (DOM artifact), `voice_call` (transcript artifact), `x12_271` (eligibility),
or `human` (reviewer). Confidence: `high` for directly-labelled values, `medium` for
derived (`remaining = total − used`) or footnote-sourced, `low` for inferred. Sparse
payers (MetLife) return `value:null` + `unavailableReason` — never silently blank (PRD R8).

## Contract ambiguities resolved

- **eligibility_only scope end-state.** The contract details the full_breakdown path;
  for `eligibility_only` (never triggered by the seed, since every coverage is
  first-sight/unverified) the workflow writes `insverify` (scope `eligibility_only`) +
  `commlog` + a planStatus snapshot and goes `DONE`, skipping the breakdown QA gate.
- **Waiting-period source.** `waiting_period_conflict` reads `breakdown.waitingPeriods`.
  The heuristic now parses a "… Waiting Period" row (category + `ends MM/DD/YYYY`); the
  real mock-portal must render waiting-period data for this to fire in integration.
- **Low_confidence resolution.** On review completion the info `low_confidence` exception
  is auto-resolved (so a human-finished verification reads `verified`, not `attention`).
- **displayStatus for parked reviews.** `HUMAN_REVIEW` with only the info `low_confidence`
  exception → `in_progress` (PRD R20 "being completed by our team").
- **reverify / verify-now scope** is re-planned from `planScope()` at request time.

## Known issues / notes

- `SubscriberQuery.groupNumber` comes from `payer_plan` if the connector synced a group;
  the mock providers key off `subscriberId` regardless.
- The `job` table is global (not practice-scoped); tests reset it in setup.
- `AnthropicExtractor` uses `output_config.format` structured output against the
  BenefitBreakdown JSON schema; any failure logs and falls back to the heuristic.
  It is only loaded when `EXTRACTOR=anthropic` and a key is present.
- Frequency exceptions can legitimately fire more than once per patient (e.g. both
  prophy and exam exhausted) — each scheduled CDT is evaluated independently.

## Frozen-package needs flagged (no migrations added)

None required — all workflow state fits the existing tables. Partial breakdowns,
labels, and 271 payloads use existing `jsonb` columns (`review_task.draft/labels`,
`benefit_snapshot.canonical`, `writeback.payload`, `artifact`). No schema/db changes made.
```
