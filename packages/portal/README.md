# @nightshift/portal

The payer-portal **automation fleet**: per-payer Playwright adapters that log into a
payer portal, navigate to a member's benefits, and **capture raw artifacts**
(full-page screenshot + DOM HTML) for the extraction pipeline. Extraction is
deliberately *not* here — adapters capture, the LLM/heuristic pipeline extracts
(capture-then-extract, TDD §3.4).

Targets the mock portal (`@nightshift/mock-portal`) at `PORTAL_URL`
(default `http://127.0.0.1:4300`).

## Interface

```ts
import { getAdapter, listAdapters } from "@nightshift/portal";
import type { PayerAdapter } from "@nightshift/portal";

const adapter = getAdapter("mock-delta");          // PayerAdapter | null
const captures = await adapter.fetchBreakdown(query, { artifacts });  // RawCapture[]
```

- `PayerAdapter.capabilities()` → `Record<string, boolean>` of canonical field paths
  the payer exposes (delta = full; metlife = sparse subset).
- `fetchBreakdown(q, { artifacts })` → for each meaningful page persists **two**
  artifacts via the injected `ArtifactStore` — screenshot (`kind:"screenshot"`,
  `image/png`) and DOM (`kind:"dom"`, `text/html`) — and returns one `RawCapture`
  per page:
  ```
  { kind:"portal_page", payerKey, content:<page HTML>,
    artifactIds:[screenshotId, domId],
    meta:{ pageName:"benefits"|"history", url, screenshotArtifactId, domArtifactId } }
  ```
- Pages captured: `mock-delta` → `benefits` + `history`; `mock-metlife` → `benefits`.

### Behaviour contract

| Situation | Result |
|---|---|
| Member not found | `[]` (portal-miss → API fallback), zero artifacts persisted |
| Terminated member | normal capture (page shows TERMINATED) |
| Portal down / login fails / timeout | **throws** (orchestrator handles fallback) |
| Sparse payer history page 404 | skipped (not captured), benefits still returned |

### Session reuse

Playwright `storageState` (cookies) is cached in memory per payer, so repeated
fetches skip login (TDD §3.4 session persistence). `resetSessions()` clears it
(tests / per-payer kill switch). One shared headless browser instance is reused
across all fetches; call `closeBrowser()` at teardown.

## Browser resolution

The pinned Playwright client (1.55.0) expects chromium revision 1187, but the
preinstalled build under `PLAYWRIGHT_BROWSERS_PATH` is 1194. `resolveChromiumExecutable()`
locates a launchable chromium (`.../chrome-linux/chrome`, falling back to
`headless_shell`) and passes it to `chromium.launch({ executablePath })`, which is
robust to that mismatch. Override with `CHROMIUM_EXECUTABLE_PATH`. **Do not run
`playwright install`** — browsers are preinstalled.

## Canary (drift detection)

```bash
npm run -w @nightshift/portal canary                 # both payers
npm run -w @nightshift/portal canary mock-delta      # one payer
```

Requires a running portal (`npm run dev:portal`). Logs in and asserts the benefits
page for a synthetic member (delta SUB-1001 / metlife SUB-1006) renders its key
landmarks; exit 1 + `missing` list on failure (auto-quarantine signal).
`runCanary(payerKey)` is also exported for programmatic health checks.

## Test

```bash
npm test -w @nightshift/portal
```

Spins the real mock portal on an ephemeral port (imports its `buildServer()`), then
drives the **real Playwright adapters** against it with a temp-dir `ArtifactStore`
(`TempArtifactStore`). Asserts: delta SUB-1001 → 2 captures / ≥4 artifacts, content
has `Cal Yr Max` + prophy history `01/15/2026`; SUB-1004 capture contains
`TERMINATED`; metlife SUB-1006 → benefits page only; unknown subscriber → `[]`.
Full suite ~5s.

## Design notes / deviations

- One shared `MockPortalAdapter` class parameterised by `{ payerKey, pages,
  capabilities }` backs both `mock-delta` and `mock-metlife` (real-payer adapters
  would subclass / override navigation). Registered in `src/index.ts`.
- `TempArtifactStore` (`src/memory-artifacts.ts`) is a filesystem-backed
  `ArtifactStore` stand-in for canary + tests; the production store lives in
  `apps/api`. Adapters depend only on the `ArtifactStore` seam.
- Benefits page is loaded with `waitUntil:"networkidle"` before screenshotting so the
  full-page capture is stable.
- `RawCapture.meta` carries `screenshotArtifactId` / `domArtifactId` in addition to the
  ordered `artifactIds` array, so downstream code can address them by role without
  positional assumptions.
