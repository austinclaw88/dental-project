# @nightshift/dashboard

Front-desk UI for the NightShift MVP — the morning verification queue, the
per-patient benefit breakdown ("paper insurance form"), and the human review
queue. Built against `docs/API-CONTRACT.md` ("Dashboard-facing (`/api`)").

## Framework choice

- **Next.js 14.2.35, App Router, React 18, TypeScript.** (14.2.35 is the patched
  release on the 14.2 line; plain `create-next-app` was skipped in favor of a
  hand-rolled scaffold to avoid interactive/template-download friction in the
  sandbox — the result is a standard Next App-Router project.)
- **No Tailwind, no component library.** One hand-rolled stylesheet
  (`src/app/globals.css`) with CSS custom properties: calm, high-contrast, one
  teal accent, 44px touch targets, responsive down to 768px (iPad). Keeps the
  dependency surface tiny.
- **Display types are duplicated**, not imported from `@nightshift/schema`.
  `src/types.ts` is a hand-copied subset of `benefits.ts` / `verification.ts` /
  `dto.ts` — only the shapes the UI renders. The contract explicitly allows this
  as an alternative to `transpilePackages`, and it keeps `next build` free of any
  dependency on the tsx-only schema package. If a field drifts, **the schema is
  source of truth.**

## Run / test / build

From the repo root (npm workspaces):

```bash
# dev server on :3000 (override with DASHBOARD_PORT)
npm run -w @nightshift/dashboard dev

# component tests (vitest + @testing-library/react, jsdom)
npm run -w @nightshift/dashboard test

# production build (the real integration test for Next)
npm run -w @nightshift/dashboard build
```

Verified results on Node 22:
- `test` → **14 passed** (3 files: queue row, breakdown, review form).
- `build` → **compiles, type-checks, 5 routes generated** (`/`, `/review`,
  `/verifications/[id]`, `/_not-found`).
- `dev` → serves `/`, `/review`, `/verifications/:id` (all HTTP 200) with the
  API absent.

### Env

- `NEXT_PUBLIC_API_URL` — API base URL (default `http://127.0.0.1:4000`).
- `DASHBOARD_PORT` — dev/start port (default `3000`).

## Pages

1. `/` **Morning queue** — practice name + date picker (defaults to **tomorrow**,
   the demo date), "Run nightly batch" (`POST /api/batch/run` then poll), summary
   strip (counts by `displayStatus` + full-auto rate from the metrics endpoint),
   list sorted by appointment time with status pills, inline severity-colored
   exception messages, and per-row **Details / Re-verify** + per-exception
   **Resolve** (`resolvedBy: "front-desk"`). Auto-refreshes every 3s while any
   row is `in_progress`/`planned`; stops when stable. "All clear" empty state
   when everything verified clean (UX principle: exceptions, not reports).
2. `/verifications/[id]` **Verification detail** — coverage header; the canonical
   `BenefitBreakdown` rendered as the grouped paper form (Plan status /
   Maximums & deductibles / Coverage by category / Frequencies & history /
   Clauses & waiting periods / Notes), every field showing value + loud **H/M/L**
   confidence badge + **source icon** (🌐 portal / 📠 271 / 📞 call / 👤 human) +
   a one-click provenance link to `/api/artifacts/:id`; null fields render as
   *"Not published by payer"*, never blank. Vertical **step timeline** and
   **writeback** status chips below.
3. `/review` **Review queue** — open tasks (`GET /api/review-tasks?status=open`)
   as cards (patient, payer, reason, SLA). Expand to edit the draft breakdown's
   core fields; **Complete review** sends `POST /api/review-tasks/:id/complete`
   with `{ fields: {<dot-path>: value}, reviewer: "verification-team" }` carrying
   **only the fields the reviewer changed or filled**.

## Fixture strategy

`src/lib/fixtures.ts` is a by-hand derivation of `docs/SEED-UNIVERSE.json` (all
12 patients, contract-exact shapes) covering every scenario: clean, frequency
conflict, waiting period, terminated coverage, deductible-unmet, sparse-payer
(MetLife → `unavailable-from-payer` fields), voice path (Guardian), and human
review (SunCoast). Exception messages spell out *why it matters today* (PRD R17).

Two uses:

1. **Tests** import the fixtures directly.
2. **Offline fallback for the live app.** `src/lib/api.ts` attempts a real fetch
   to `NEXT_PUBLIC_API_URL` for every call; on a failure it flips a global
   "offline" flag (rendering the **API offline** banner) and delegates to
   `src/lib/mockApi.ts`, an in-memory mock backend. The mock is **interactive**:
   Run-batch / Re-verify / Resolve / Complete-review produce realistic
   `in_progress → terminal` transitions (so the 3s auto-refresh and the pulsing
   status pill are demonstrable) — never a white screen. When the real API is up,
   the fixtures and mock are never touched.

## Status → pill mapping

`displayStatus` (from the contract's `VerificationListItem`) maps directly:
`verified` ✅ green · `attention` ⚠️ amber · `in_progress` ⏳ gray-pulse ·
`failed` ❌ red · `planned` • neutral.

## Contract points that were ambiguous, and how they were rendered

- **Artifact content-type.** `GET /api/artifacts/:id` "serves the file with its
  content type", but `Provenance` carries no MIME hint. The lightbox tries to
  render the artifact as an `<img>` (portal screenshot); on `onError` (HTML/DOM
  capture, raw 271, transcript, or API offline) it swaps in an "open in new tab"
  link. This satisfies "screenshots inline, HTML/text new tab" without a type
  field.
- **`GET /api/verifications/:id` envelope** lists `{verification, patient,
  coverage, appointment, steps, snapshot, exceptions, writebacks}` but not the
  exact camelCased field names of each nested row. `src/types.ts`
  (`VerificationDetail`) documents the shapes assumed — notably `verification`
  is assumed to carry a `displayStatus`, and `steps` are assumed camelCased with
  `durationMs`/`artifactId`. Adjust `types.ts` if the API differs.
- **`verify-now` id.** The contract's `POST /api/patients/:patientLinkId/verify-now`
  needs a patient link id, which is not part of `VerificationListItem`. Fixtures
  add an optional `patientLinkId` to list items; if the API omits it, wire the
  on-demand button from the detail page instead.
- **`review-tasks` reason/SLA fields.** The contract says tasks include
  `review_task + patientName + payerKey + draft`; the exact `reason` / SLA field
  names aren't fixed. `ReviewTask` assumes `reason`, `carrierName`, `slaDueAt`,
  `createdAt`. `carrierName` is a convenience derived from `payerKey`.
- **Full-auto rate.** Taken from `GET .../metrics/summary` `fullAutoRate` when
  present; falls back to `verified / total` locally.

## Known issues / limitations

- `api.ts` treats **any** fetch rejection (network refused *or* non-2xx HTTP)
  as "offline" and serves fixtures. A real API returning 5xx would therefore
  show the offline banner rather than a distinct server-error state. Acceptable
  for the MVP demo (priority: never white-screen); revisit if the API needs its
  error bodies surfaced.
- Offline mock transitions are wall-clock timers in one browser tab; they are
  not persisted and reset on reload.
- Artifact images only load when the API is actually serving them; offline they
  fall through to the "open in new tab" link (expected).
- `next lint` is not configured (ESLint intentionally skipped during build to
  keep the dependency surface minimal); `build` still runs full type-checking.

## File map

```
apps/dashboard/
  package.json            deps: next 14.2.35, react 18; dev: vitest, testing-library
  next.config.mjs         reactStrictMode; note on transpilePackages
  tsconfig.json           strict; @/* path alias
  vitest.config.ts        jsdom + react plugin; aliases next/link & next/navigation to stubs
  vitest.setup.ts         @testing-library/jest-dom
  src/
    types.ts              duplicated display types (subset of @nightshift/schema)
    app/
      layout.tsx          NavBar + page shell + globals
      globals.css         entire design system (hand-rolled)
      page.tsx            (/) Morning queue — poll, batch, summary, list
      verifications/[id]/page.tsx   Verification detail
      review/page.tsx     (/review) Review queue
    components/
      NavBar.tsx          sticky app bar + tabs (client)
      OfflineBanner.tsx   subscribes to the api.ts offline flag
      StatusPill.tsx      ✅/⚠️/⏳/❌/• display-status pill
      QueueRow.tsx        one appointment row + inline exceptions
      SummaryStrip.tsx    counts + full-auto rate
      BreakdownForm.tsx   the paper insurance-breakdown form
      ConfidenceBadge.tsx H/M/L loud badge
      SourceIcon.tsx      🌐/📠/📞/👤 provenance source
      ArtifactLink.tsx    provenance lightbox (img-or-new-tab)
      Timeline.tsx        verification_step vertical timeline
      Writebacks.tsx      writeback target + status chips
      ReviewCard.tsx      editable draft form -> dot-path fields payload
    lib/
      api.ts              fetch client + offline flag + fallback
      mockApi.ts          interactive in-memory backend (offline only)
      fixtures.ts         SEED-UNIVERSE-derived fixtures (contract shapes)
      format.ts           date/time/money/percent + label maps
    test/stubs/           next/link + next/navigation stubs for vitest
    __tests__/            queueRow / breakdown / reviewForm tests
```
