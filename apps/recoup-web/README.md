# Recoup Web

**The upload-and-see-your-money front end for [`@nightshift/recoup-audit`](../recoup-audit).**

The audit engine is a CLI. A practice owner taking the free-audit offer is not going to run a
CLI. This is the three screens between "here is my export" and "here is what your payers owe
you" — and nothing else.

```bash
npm run dev:recoup-web            # from the repo root
npm run -w @nightshift/recoup-web dev
# → http://localhost:4500
```

Port is `4500`, override with `RECOUP_WEB_PORT`. `RECOUP_WEB_HOST` (default `0.0.0.0`) and
`RECOUP_WEB_LOG=1` (fastify request logging) are the only other knobs.

---

## The flow

### 1. Landing — `GET /`

One page: a drop zone for the paid-claims CSV, a second optional one for a contracted fee
schedule, and everything else (practice name, service-date window, tolerances) folded under
**Advanced settings**. The prominent second path is **See a sample audit** → `/demo`, which runs
the engine's deterministic synthetic dataset immediately — for the prospect who is interested but
has not pulled an export yet.

The footer carries the two claims that have to be true and visible: what happens to the file, and
that candidate ≠ collectable.

### 2. Column mapping — `POST /upload`

The CSV is parsed server-side with the engine's own reader. The screen shows the **first five
rows of the actual file** and, for every canonical field, a dropdown of that file's headers
**preselected by auto-detection**. Required fields that could not be identified are highlighted,
and **Run audit** stays disabled until all seven are resolved.

Auto-detection runs four passes, most trustworthy first, and never assigns one column to two
fields:

| Pass | Basis | Example |
|---|---|---|
| 1 | `canonical` — the header *is* the canonical name (case/space/underscore/dash-insensitive) | `Claim ID` → `claim_id` |
| 2 | `preset` — a header listed in `generic` / `opendental` / `dentrix` | `InsPayAmt` → `paid_amount` |
| 3 | `synonym` — office vernacular dictionary | `Carrier` → `payer_name`, `Ins Paid` → `paid_amount`, `DOS` → `service_date`, `Proc Code` / `ADA Code` → `cdt_code`, `Gross` → `billed_fee` |
| 4 | `contains` — a distinctive token inside a longer header | `Plan Allowed Amount Net` → `allowed_amount` |

The dictionary lives in [`src/detect.ts`](./src/detect.ts) and is the file to edit when a new PMS
export shows up with unfamiliar spellings. Adding an entry needs no other change.

The fee-schedule CSV is auto-only — the engine's own parser already accepts a range of spellings,
so the screen just reports what it found. A fee file that cannot be read is reported and
**skipped**, not fatal: the audit still runs against reconstructed rates.

### 3. Results — `POST /run` → `GET /runs/:id`

The engine runs synchronously (a 1,500-line file audits in well under a second). The results page
is a slim bar — *start over · download report.html · findings.csv · findings.json* — above the
engine's own HTML report, embedded full-width in a same-origin iframe and auto-sized to its
content. The report is byte-identical to the file behind the download link: self-contained, no
external assets, opens from an email attachment.

`GET /demo` produces the same page from the synthetic dataset, with a banner saying so.

---

## Storage and the 60-minute TTL

Runs live in `apps/recoup-web/var/runs/<id>/` (gitignored):

```
claims.csv      the upload, verbatim
fees.csv        the fee schedule, if one was supplied and usable
upload.json     filename, headers, row count, advanced settings
meta.json       confirmed mapping, tolerances, totals
report.html     findings.csv     findings.json
```

Ids are 26 characters of `crypto.randomBytes` in lowercase base32 — a run URL is the only
credential this build has, so it must not be enumerable. Every id that reaches the filesystem is
validated against `/^[0-9a-z]{26}$/` first, so a traversal attempt never becomes a path.

The **60-minute TTL is enforced, not documented**: `RunStore.sweep()` runs on boot and on a
five-minute unref'd interval, deleting any run directory whose mtime is older than the TTL. It is
promised in the page footer, so it is asserted in the tests (`test/sweep.test.ts`).

Subscriber IDs are hashed by the engine on read — the raw value never reaches disk, the report,
or the findings files.

---

## Limits and error handling

- **25 MB per file, two files per upload, CSV only.** Uploads are content-sniffed before parsing:
  NUL bytes, a high control-character ratio, or a `%PDF` / `PK` / SQLite / image signature is
  rejected with "this looks like a PDF, not a CSV" rather than a CSV-parser stack trace.
- Every failure renders a human page with the engine's own message verbatim plus concrete fixes:
  unparseable CSV, headers with no rows, no header row, unmapped required fields, zero usable
  rows (with the first five rejection reasons), an empty date window, and engine errors.
- Unknown or expired run ids 404 with an explanation of the TTL rather than a bare status code.

---

## Design

No frontend framework, no build step, no external assets, no network requests from the page.
Fastify serves server-rendered HTML with two small inline scripts (drag-and-drop wiring, and the
mapping screen's required-field gate). The stylesheet is one string in
[`src/views/layout.ts`](./src/views/layout.ts) and deliberately mirrors the engine report's
restraint: system font stack, one accent, ink on off-white, whitespace instead of ornament.
Desktop-first, usable on a phone.

## Layout

```
src/
  main.ts        thin entry point: port, listen, shutdown
  server.ts      buildServer() — all routes, upload handling, the run pipeline
  detect.ts      canonical fields, auto-detection dictionary, Mapping construction
  store.ts       RunStore: ids, per-run files, TTL sweep
  views/
    layout.ts    page shell, the single stylesheet, the privacy footer
    landing.ts   screen 1
    mapping.ts   screen 2
    results.ts   screen 3
    error.ts     error and 404 pages
test/            detect, flow (full happy path), errors, store, sweep
```

`buildServer(opts)` is a factory returning a plain `FastifyInstance` — same pattern as
[`apps/api`](../api). Tests drive it through `fastify.inject()` with `runRoot` pointed at a temp
directory and the sweep timer off; nothing listens on a socket and nothing touches `var/`.

---

## Development

```bash
npm run -w @nightshift/recoup-web dev      # tsx watch, :4500
npm test -w @nightshift/recoup-web         # vitest, no network, no DB
npx tsc -p apps/recoup-web/tsconfig.json --noEmit
```

The engine is imported through `@nightshift/recoup-audit/lib` — a pure re-export barrel added for
this workspace. A web audit and a terminal audit of the same file run the same code and produce
the same findings; the full-flow test asserts this by generating its claims CSV from the engine's
own synthetic module rather than from a fixture.

---

## What production needs that this does not have

This is a dev tool and an internal demo instrument. Before it touches a real practice's claims
over the public internet:

1. **Authentication.** There is none. Anyone who can reach the port can upload, and a run URL is
   protected only by being unguessable. Real deployment needs accounts, per-practice isolation,
   and authorization on `/runs/:id` rather than security-by-URL.
2. **A signed BAA, and the controls behind it.** Claim lines are PHI. Even with subscriber IDs
   hashed, dates of service and procedure codes tied to a practice are identifiable. That means a
   BAA with the hosting provider, encryption at rest, audit logging of every access, a documented
   retention policy, and breach procedures.
3. **TLS, terminated properly.** The server binds plain HTTP. Put it behind a proxy with HSTS;
   uploads must never cross the network in the clear.
4. **Durable, encrypted storage instead of a local directory.** `var/runs` is a single-node
   filesystem — it does not survive a redeploy, cannot be shared across instances, and is
   encrypted only if the disk is. Object storage with server-side encryption and lifecycle rules
   replaces both the directory and the sweep timer.
5. **A queue for large files.** The audit runs synchronously inside the request. That is right for
   1,500 lines and wrong for a 20-practice DSO export: a big file would hold a connection open and
   block the event loop. Production accepts the upload, enqueues the audit, and notifies on
   completion — which also removes the 25 MB cap.
6. **Rate limiting and upload abuse controls.** No throttling exists; `/demo` regenerates and
   re-audits the synthetic dataset on every request.
7. **Structured logging and metrics** — currently off by default, and there is deliberately no
   logging of file contents.

## Known limitations

- Comma-delimited CSV only. Semicolon and tab exports are rejected rather than sniffed.
- The uploaded file is re-parsed on `POST /run` instead of being cached between screens — simple,
  and cheap at these sizes, but it is linear work done twice.
- Auto-detection is dictionary-based. It will mis-guess on genuinely novel headers; that is why
  every dropdown remains editable and the preview rows sit directly above them.
- One audit per upload: changing a tolerance means re-uploading. The mapping screen carries the
  advanced settings forward as hidden fields but does not expose them for editing.
