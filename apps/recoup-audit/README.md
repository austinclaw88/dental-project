# Recoup Audit

**A PMS-agnostic dental underpayment audit engine. CSV in, evidence out.**

A practice exports twelve months of paid insurance claims from *any* practice management
system, optionally hands over its contracted fee schedules, and this tool finds and
quantifies what the payers underpaid — with the claim rows and the rate used attached to
every finding.

No database, no server, no PMS integration. One command, three output files.

---

## What this is, and why it exists

This is the Phase-0 validation instrument from [`docs/ATTACK-STRATEGY.md`](../../docs/ATTACK-STRATEGY.md) §5.

The strategy's premise is that twelve funded competitors are all working the *front* of the
revenue cycle (predicting benefits) and none is auditing the *back* (what payers actually
paid against what contracts require). Before building the platform on that premise, the
premise has to survive contact with real claims data. The kill gate is explicit: **under
$5,000 found across two practices' trailing year and the leakage thesis is wrong for our
payer mix.**

So this tool has one job first and a second job later:

1. **Now:** audit the founder's own clinic and a design partner's practice, and produce a
   number that either clears the kill gate or doesn't. It is deliberately standalone —
   PMS-agnostic, no NightShift infrastructure required — so a discovery conversation can
   turn into a real audit the same week, with any practice, on any system.
2. **Later:** become the first module of Recoup. The detectors, the fee-schedule
   reconstruction and the evidence model here are the ones that graduate into the product;
   the CSV boundary gets replaced by connectors and EOB ingestion, not rewritten.

The report it produces is also the sales artifact. The free-audit offer in Phase 1
("we audit your last 12 months; you keep the first $2,500 we find") is only credible if the
audit output is something a dentist can read, believe, and act on — including the parts that
say *we might be wrong about this line*.

---

## Quick start

From the repo root:

```bash
# See it work on synthetic data with a known answer key
npm run -w @nightshift/recoup-audit demo

# Audit a real export
npm run -w @nightshift/recoup-audit audit -- \
  --claims claims.csv \
  --out report.html
```

The demo generates ~1,500 synthetic claim lines across 5 payers with deliberately planted
leakage *and* abundant legitimate adjudication, runs the real engine over it, and prints how
much of the planted money it found and how much of what it flagged was never there:

```
seeded $7,441.00 recoverable across 80 lines; engine found $7,356.00 (98.9%),
false-positive rate 2.7%
```

Outputs land in `apps/recoup-audit/var/`: `demo-report.html`, `demo-claims.csv`,
`demo-fees.csv`, `demo-findings.csv`, `demo-findings.json`.

---

## Getting the data out of a practice management system

You need **one row per claim line** — that is, one row per *procedure*, not per claim.
A claim with a crown and a build-up is two rows.

### The seven columns that are non-negotiable

| Canonical field | What it is |
|---|---|
| `claim_id` | Groups procedures that were adjudicated together |
| `service_date` | Date of service (`yyyy-mm-dd` or `mm/dd/yyyy`) |
| `payer_name` | The carrier as named in your system |
| `cdt_code` | The CDT/ADA procedure code |
| `billed_fee` | What you billed |
| `allowed_amount` | **What the payer allowed** — the contracted amount |
| `paid_amount` | What insurance actually paid |

**`allowed_amount` is the one that matters and the one most exports omit.** Without it there
is nothing to compare a contract to, and the audit cannot run. If your export has billed,
paid and write-off but no allowed amount, add a computed column: `allowed = billed − write-off`.
That identity holds for in-network claims and is the standard reconstruction.

### The nine columns that make the audit trustworthy

These are optional, but they are what *rule out* false positives. Every one you omit means
more findings that need manual review:

`plan_or_group`, `subscriber_id` (hashed on read — the raw value is never retained or
written), `tooth`, `patient_portion`, `writeoff_amount`, `deductible_applied`,
`adjustment_codes` (CARC codes or remark text), `claim_ordinal` (primary/secondary),
`network_name`, `coverage_pct`.

`deductible_applied`, `patient_portion`, `adjustment_codes` and `claim_ordinal` are the four
that carry the most weight — they are how the engine recognises ordinary coinsurance, a
deductible, an exhausted annual maximum and a secondary claim. The CLI warns when they are
missing.

### Column mapping

Every PMS exports different headers, so nothing is hard-coded. Pass `--map` with a preset
name or a path to your own mapping JSON:

```json
{
  "name": "our-office",
  "columns": {
    "claim_id": "TicketNo",
    "service_date": "DOS",
    "payer_name": ["Ins Carrier", "Carrier"],
    "cdt_code": "Code",
    "billed_fee": "Gross",
    "allowed_amount": "Net Allowed",
    "paid_amount": "Received"
  }
}
```

A value may be a single header or a list of candidates (first one present wins). Header
matching ignores case, spaces, underscores and dashes, so `Claim ID` matches `claim_id`
without any mapping at all. Mapping files may contain `//` comment lines.

Three presets ship in [`presets/`](./presets):

| Preset | Notes |
|---|---|
| `generic` | Canonical names, pass-through. Use this if you can control the export headers. |
| `opendental` | Best-effort Open Dental headers, **and a User Query** that produces every field. Read the caveat about `AllowedOverride` being `-1` when unset. |
| `dentrix` | Best-effort Dentrix / Dentrix Ascend headers from the Insurance Payment / Ascend claims exports. Most Dentrix exports omit the allowed amount — see above. |

Both PMS presets are starting points that **expect per-office adjustment**. When a required
column can't be resolved, the error names the field, the headers it looked for, and every
header actually present in your file.

### Fee schedules (optional, but transformative)

```csv
payer_name,cdt_code,contracted_rate,effective_from,effective_to
Delta Dental Premier,D2740,1044.00,2025-01-01,2025-12-31
```

Supplying real contracted rates upgrades findings from medium to high confidence and removes
the biggest blind spot in the reconstruction method (below). Partial schedules are fine —
contract rates are used where they exist, reconstruction fills the rest.

---

## Running a real audit

```bash
npm run -w @nightshift/recoup-audit audit -- \
  --claims /path/to/claims.csv \
  --map opendental \
  --fees /path/to/fee-schedules.csv \
  --since 2025-07-01 --until 2026-06-30 \
  --out report.html \
  --csv findings.csv \
  --json findings.json \
  --practice "Bridge Street Dental"
```

| Flag | Meaning |
|---|---|
| `--claims <file>` | **Required.** The claim-lines CSV. |
| `--map <preset\|file>` | `generic` (default), `opendental`, `dentrix`, or a path to your mapping JSON. |
| `--fees <file>` | Contracted fee schedule CSV. |
| `--since` / `--until` | `yyyy-mm-dd` service-date window. Rates are reconstructed from the windowed lines only, so a 2025 audit is never judged against 2023 prices. |
| `--tolerance <dollars>` | Absolute tolerance floor per line (default `1.00`). |
| `--tolerance-pct <n>` | Percentage tolerance (default `1`). A line is flagged only when it misses by more than **the greater of the two**. |
| `--out` / `--csv` / `--json` | Report, findings table, and full findings + coverage stats. |
| `--practice <name>` | Name on the report header. |
| `--quiet` | Suppress the console summary. |

Three outputs:

- **Console summary** — lines and dollars audited, candidate dollars by mechanism and by
  payer, and rate-coverage statistics.
- **`findings.csv` / `findings.json`** — one row per finding with source row numbers, the
  rate used, its basis and support, and the plain-English reason.
- **`report.html`** — the artifact the dentist reads. Self-contained single file (no external
  assets, opens from an email attachment), prints cleanly, works in light and dark.

---

## How it works

### 1. Establishing the expected rate

With a fee schedule, the contracted rate is used directly and findings are **high**
confidence.

Without one, the rate is **reconstructed from the practice's own payment history**: for each
(payer × CDT code), the **modal allowed amount** — the amount that payer most commonly
allowed for that code. Zeroed lines and secondary claims are excluded from the vote, because
they are the pathologies being hunted and letting them vote would launder them into the
baseline.

The mode is only trusted when it has **at least 4 occurrences** and holds **at least 50%** of
that pair's priced lines. Below either threshold the pair is marked **unschedulable** and
excluded entirely — never flagged, never guessed at. Unschedulable pairs are reported in the
coverage statistics and listed in the JSON export, so the gap is visible rather than silently
absent. Ties break toward the *lower* amount: under-claiming is survivable, over-claiming in
front of a payer is not.

So deviations are measured against **the payer's own most common rate, reconstructed from
your own payment history** — strong evidence, but not a contract citation. That is why the
ceiling without a fee schedule is medium confidence.

### 2. Detectors

Each finding carries a type, dollars, confidence, and evidence (the source rows plus the rate
used and where it came from).

| Detector | What it catches | Confidence |
|---|---|---|
| `below_schedule` | Allowed below the contracted/reconstructed rate beyond tolerance. | high with a supplied schedule, medium reconstructed |
| `downgrade_suspect` | Allowed matches the payer's own rate for a known alternate-benefit partner code rather than the code billed — posterior composite paid at the amalgam rate, porcelain crown at the metal-crown rate, FMX at the bitewing rate, osseous surgery at the SRP rate. | medium |
| `bundled_to_zero` | A separately-payable companion allowed $0 on the same date (and tooth): build-up with a crown, periapicals with a limited exam, SRP with perio maintenance. | medium (low when the amount must be sized from other payers' rates) |
| `repriced_rate_cluster` | Within one (payer × code), a second cluster of ≥3 *identical* allowed amounts sitting ≥10% below the rate. One odd number is noise; the same odd number three times is a second fee schedule — usually a leased/rented network. | medium with a contract rate, low reconstructed |
| `zero_paid_no_reason` | Allowed above zero, paid $0, and nothing in the export explains it. | medium |

The three rate detectors are mutually exclusive per line and run most-specific-first
(downgrade → repricing cluster → generic shortfall), each claiming its rows, so one dollar of
shortfall is described once and counted once. `bundled_to_zero` and `zero_paid_no_reason`
measure different money and are additive by construction.

### 3. Guards — what is deliberately NOT flagged

False positives are the product's death. A missed underpayment costs a practice money it
never knew it had; a false positive costs it a wasted appeal, the payer's patience, and its
belief in every other number in the report.

A line is suppressed when the export explains it:

- a **deductible** that covers the gap between allowed and paid;
- **ordinary coinsurance** — patient portion + payment (+ deductible) reconstructs the
  allowed amount;
- **secondary/tertiary claims**, *unless* they were allowed below schedule;
- **stated benefit limits** in the adjustment codes — annual maximum, frequency, non-covered,
  waiting period, missing-tooth clause, coordination of benefits, eligibility, timely filing
  (CARC 1, 2, 3, 22, 23, 26, 27, 29, 31, 49, 96, 119, 151, 197, 204, plus the equivalent
  remark text);
- **0%-coverage plans**;
- **non-covered procedures billed to the patient in full** — the practice is not out the
  money;
- anything inside tolerance, and anything outside the `--since`/`--until` window.

Two CARC codes deliberately do **not** guard anything: **45** (over fee schedule) and **97**
(benefit included in another service). Those are the payer asserting the exact behaviour under
audit, not explaining it away.

Every guard has a unit test asserting the NOT-flagged case (`test/guards.test.ts`), including
a whole-file test in which a dataset of nothing but ordinary adjudication produces zero
findings.

---

## Honest limitations

**Candidate is not collectable.** Every figure is a *candidate*: a line where payment does not
match the rate we could establish. Turning one into a check requires reading the actual
contract — its alternate-benefit, bundling and network-access clauses. Some findings will turn
out to be contractually permitted. That is a finding too: it tells the practice what to
renegotiate.

**The reconstruction has a specific blind spot: a payer that underpays *consistently*.**
Reconstruction learns the payer's usual rate. If a payer has underpaid a code more than half
the time, its habit becomes the baseline and the shortfall is invisible. Supplying real fee
schedules removes this entirely and is the single highest-value input a practice can add.

**Mid-year fee schedule changes are not modelled.** The reconstruction takes one mode across
the whole window. A payer that re-priced a code in January will show two clusters, and the
smaller half may be flagged. Use `--since`/`--until` to audit either side of a known change,
or supply the dated fee schedule (which *is* effective-date aware).

**Thin volume means silence, by design.** A (payer × code) pair with fewer than 4 clean lines
is unschedulable and excluded. In a small practice this typically covers crowns and endo from
the smaller carriers — real leakage there will be missed rather than guessed at. The coverage
statistics say exactly how much of the file this affects.

**It cannot see the EOB.** This reads the PMS export only. Reasons printed on a paper or PDF
EOB but never keyed into the system are invisible, which is why `zero_paid_no_reason` asks the
practice to check the EOB rather than asserting an error. Leased-network confirmation likewise
requires looking at the network logo on the EOB.

**It cannot see plan documents.** Frequency limits, missing-tooth clauses and waiting periods
are only visible when the payer stated them in the export.

**`allowed = billed − write-off` is an assumption.** Where an export lacks a true allowed
amount and the practice computes it that way, any non-contractual write-off (courtesy
adjustments, bad debt) will masquerade as a low allowed amount and can generate findings.

**Money before adjudication is out of scope.** Claims never submitted, procedures never
posted, and patient balances never collected are not what this looks at.

**The downgrade partner map and bundling rules are small, explicit tables**
([`src/partners.ts`](./src/partners.ts)) meant to be reviewed and extended by a practising
dentist. They are not exhaustive dental coding knowledge.

---

## Development

```bash
npm run -w @nightshift/recoup-audit demo        # synthetic dataset + reconciliation
npm test -w @nightshift/recoup-audit            # vitest, no network, no DB
npx tsc -p apps/recoup-audit/tsconfig.json --noEmit
```

The demo is fully deterministic (seeded RNG, fixed date window, no `Date.now()` or
`Math.random()` in the generator) — the same seed produces byte-identical claims and findings
on every machine, so the reconciliation number is evidence rather than a mood.

The end-to-end test asserts the two numbers that matter: **≥90% recall of seeded dollars** and
**≤5% false positives as a share of flagged dollars**. The synthetic dataset deliberately
includes one genuinely ambiguous case — an employer group legitimately on a second contracted
schedule — which the engine cannot distinguish from repricing and which therefore counts
against it. A false-positive rate of exactly zero on a dataset with no ambiguity would measure
nothing.

### Layout

```
src/
  cli.ts          entry point, flags, error messages
  engine.ts       runAudit(): window → rate book → detectors → totals
  mapping.ts      canonical fields, presets, column resolution, hashing
  schedule.ts     fee schedule parsing + modal rate reconstruction
  partners.ts     downgrade map, bundling rules, CARC/remark lexicon
  detectors/      guards.ts + one file per detector
  report.ts       self-contained HTML report
  output.ts       console summary, findings CSV/JSON
  synthetic.ts    seeded dataset generator (the answer key)
  demo.ts         demo runner + seeded-vs-found reconciliation
presets/          generic.json, opendental.json, dentrix.json
test/             mapping, schedule, detectors, guards, e2e, report
```
