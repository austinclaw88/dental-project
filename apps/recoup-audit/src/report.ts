import { fmtMoney, fmtMoneyRounded, fmtPct } from "./money.js";
import { MIN_MODE_SHARE, MIN_SUPPORT } from "./schedule.js";
import {
  FINDING_LABELS,
  FINDING_TYPES,
  type AuditResult,
  type Cents,
  type Confidence,
} from "./types.js";

export interface ReportOptions {
  practiceName?: string;
  /** True when the practice supplied a contracted fee schedule. */
  hasContractSchedule?: boolean;
  sourceFile?: string;
  /** Extra block rendered before the methodology (used by demo mode). */
  extraSection?: string;
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A single-series horizontal bar. Sequential job (magnitude), one hue, value in
 * ink beside the bar — never inside it, never coloured. Max 20px thick with a
 * 4px rounded data-end.
 */
function bar(value: Cents, max: Cents): string {
  const pct = max > 0 ? Math.max(value > 0 ? 1.5 : 0, (value / max) * 100) : 0;
  return (
    `<span class="barline">` +
    `<span class="bar-track"><span class="bar-fill" style="width:${pct.toFixed(2)}%"></span></span>` +
    `<span class="barval">${fmtMoney(value)}</span>` +
    `</span>`
  );
}

/** Expected vs actual as two shades of one hue — the "before → after per item" job. */
function pairedBar(expected: Cents, actual: Cents, max: Cents): string {
  const e = max > 0 ? (expected / max) * 100 : 0;
  const a = max > 0 ? (actual / max) * 100 : 0;
  return (
    `<span class="pair">` +
    `<span class="pair-row"><span class="bar-track"><span class="bar-fill ctx" style="width:${e.toFixed(2)}%"></span></span></span>` +
    `<span class="pair-row"><span class="bar-track"><span class="bar-fill" style="width:${Math.max(a > 0 ? 1.5 : 0, a).toFixed(2)}%"></span></span></span>` +
    `</span>`
  );
}

const CONFIDENCE_NOTE: Record<Confidence, string> = {
  high: "measured against a contracted rate you supplied",
  medium: "measured against this payer's own habitual rate, or a mechanism your contract may permit",
  low: "a signal worth checking, priced with a weaker rate basis",
};

export function renderReport(result: AuditResult, opts: ReportOptions = {}): string {
  const t = result.totals;
  const c = result.coverage;
  const payersWithFindings = t.byPayer.filter((p) => p.dollars > 0);
  const top = result.findings.slice(0, 20);
  const maxPayer = Math.max(1, ...t.byPayer.map((p) => p.dollars));
  const maxType = Math.max(1, ...FINDING_TYPES.map((ty) => t.byType[ty].dollars));
  const maxTop = Math.max(1, ...top.map((f) => f.expected));
  const coveragePct = c.totalLines > 0 ? c.schedulableLines / c.totalLines : 0;
  const generated = result.generatedAt.slice(0, 10);
  const practice = opts.practiceName ? esc(opts.practiceName) : "Your practice";

  const payerRows = t.byPayer
    .map(
      (p) => `
      <tr>
        <th scope="row">${esc(p.payerName)}</th>
        <td class="num">${p.lines.toLocaleString("en-US")}</td>
        <td class="num">${fmtMoney(p.dollarsAudited)}</td>
        <td class="num">${p.count.toLocaleString("en-US")}</td>
        <td class="barcell">${bar(p.dollars, maxPayer)}</td>
      </tr>`,
    )
    .join("");

  const mechanismRows = FINDING_TYPES.filter((ty) => t.byType[ty].count > 0)
    .map(
      (ty) => `
      <tr>
        <th scope="row">${esc(FINDING_LABELS[ty])}<span class="code">${ty}</span></th>
        <td class="num">${t.byType[ty].count.toLocaleString("en-US")}</td>
        <td class="barcell">${bar(t.byType[ty].dollars, maxType)}</td>
      </tr>`,
    )
    .join("");

  const topRows = top
    .map(
      (f, i) => `
      <tr class="lead">
        <td class="num muted">${i + 1}</td>
        <td>${esc(f.payerName)}<span class="code">${esc(f.patientHash ?? "no id")} · claim ${esc(f.claimId || "—")}</span></td>
        <td class="nowrap">${esc(f.serviceDate)}</td>
        <td class="nowrap">${esc(f.cdtCode)}${f.tooth ? `<span class="code">tooth ${esc(f.tooth)}</span>` : ""}</td>
        <td class="barcell narrow">${pairedBar(f.expected, f.actual, maxTop)}</td>
        <td class="num nowrap">${fmtMoney(f.expected)}<span class="code">actual ${fmtMoney(f.actual)}</span></td>
        <td class="num strong">${fmtMoney(f.delta)}</td>
        <td class="nowrap"><span class="chip chip-${f.confidence}">${f.confidence}</span></td>
      </tr>
      <tr class="why"><td></td><td colspan="7"><strong>${esc(FINDING_LABELS[f.type])}.</strong> ${esc(f.why)}</td></tr>`,
    )
    .join("");

  const reconstructionNote = opts.hasContractSchedule
    ? `<p>You supplied a contracted fee schedule, so ${c.pairsFromContract} payer × code pairs were judged against your
       actual contract (high confidence). The remaining ${c.pairsReconstructed} pairs were reconstructed from your own
       payment history using the method below.</p>`
    : `<p><strong>No contracted fee schedule was supplied</strong>, so every rate in this report was reconstructed from
       your own payment history. Nothing here is measured against a contract document — it is measured against
       <em>the payer's own most common behaviour</em>. That makes findings suggestive rather than conclusive, and it
       is why the top confidence level in this run is "medium".</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Recoup Audit — candidate underpayment report</title>
<style>
  :root {
    color-scheme: light;
    --surface-1: #fcfcfb;
    --surface-2: #f4f3f0;
    --line: #e2e1dc;
    --line-strong: #c9c8c2;
    --text-primary: #0b0b0b;
    --text-secondary: #52514e;
    --text-muted: #78776f;
    --series-1: #2a78d6;
    --series-1-ctx: #b7d3f6;
  }
  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) {
      color-scheme: dark;
      --surface-1: #1a1a19;
      --surface-2: #232322;
      --line: #383835;
      --line-strong: #4d4d49;
      --text-primary: #ffffff;
      --text-secondary: #c3c2b7;
      --text-muted: #9a998f;
      --series-1: #3987e5;
      --series-1-ctx: #184f95;
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --surface-1: #1a1a19;
    --surface-2: #232322;
    --line: #383835;
    --line-strong: #4d4d49;
    --text-primary: #ffffff;
    --text-secondary: #c3c2b7;
    --text-muted: #9a998f;
    --series-1: #3987e5;
    --series-1-ctx: #184f95;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--surface-1);
    color: var(--text-primary);
    font: 15px/1.55 ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1040px; margin: 0 auto; padding: 40px 24px 72px; }
  header.top { border-bottom: 1px solid var(--line-strong); padding-bottom: 20px; margin-bottom: 28px; }
  .eyebrow { font-size: 12px; letter-spacing: .09em; text-transform: uppercase; color: var(--text-muted); margin: 0 0 6px; }
  h1 { font-size: 25px; line-height: 1.2; margin: 0 0 6px; font-weight: 620; }
  .sub { color: var(--text-secondary); font-size: 14px; margin: 0; }
  h2 { font-size: 17px; margin: 44px 0 4px; font-weight: 620; }
  h2 + .lede { color: var(--text-secondary); font-size: 13.5px; margin: 0 0 14px; max-width: 68ch; }
  h3 { font-size: 14px; margin: 22px 0 6px; font-weight: 620; }
  p { max-width: 74ch; }
  .hero { margin: 30px 0 8px; }
  .hero .figure { font-size: 54px; line-height: 1.05; font-weight: 640; letter-spacing: -0.02em; }
  .hero .caption { color: var(--text-secondary); font-size: 15px; margin-top: 6px; max-width: 70ch; }
  .kpis { display: flex; flex-wrap: wrap; gap: 2px; margin: 26px 0 8px; }
  .kpi { flex: 1 1 168px; background: var(--surface-2); padding: 14px 16px; }
  .kpi .label { font-size: 11.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--text-muted); }
  .kpi .value { font-size: 22px; font-weight: 620; margin-top: 3px; }
  .kpi .note { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
  .tablewrap { overflow-x: auto; margin-top: 10px; }
  table { border-collapse: collapse; width: 100%; font-size: 13.5px; }
  caption { text-align: left; color: var(--text-secondary); font-size: 12.5px; padding-bottom: 8px; }
  th, td { text-align: left; padding: 9px 12px 9px 0; vertical-align: baseline; }
  thead th {
    font-size: 11.5px; letter-spacing: .05em; text-transform: uppercase; color: var(--text-muted);
    font-weight: 560; border-bottom: 1px solid var(--line-strong); white-space: nowrap;
  }
  tbody tr { border-bottom: 1px solid var(--line); }
  tbody th { font-weight: 520; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .strong { font-weight: 640; }
  .muted { color: var(--text-muted); }
  .nowrap { white-space: nowrap; }
  .code { display: block; font-size: 11.5px; color: var(--text-muted); font-weight: 400; margin-top: 2px; }
  .barcell { width: 32%; min-width: 150px; padding-right: 0; }
  .barcell.narrow { width: 16%; min-width: 88px; }
  .barline { display: flex; align-items: center; gap: 10px; }
  .barline .bar-track { flex: 1 1 auto; }
  .barval { flex: 0 0 auto; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .bar-track { display: block; width: 100%; height: 14px; }
  .bar-fill {
    display: block; height: 14px; background: var(--series-1);
    border-radius: 0 4px 4px 0; print-color-adjust: exact; -webkit-print-color-adjust: exact;
  }
  .bar-fill.ctx { background: var(--series-1-ctx); }
  .pair { display: block; }
  .pair-row { display: block; }
  .pair-row + .pair-row { margin-top: 2px; }
  .pair .bar-fill, .pair .bar-track { height: 9px; }
  .totalrow { border-bottom: none; }
  .chip {
    display: inline-block; font-size: 11px; letter-spacing: .04em; text-transform: uppercase;
    border: 1px solid var(--line-strong); border-radius: 3px; padding: 1px 6px; color: var(--text-secondary);
  }
  .chip-high { border-color: var(--text-secondary); color: var(--text-primary); font-weight: 600; }
  tr.why td { padding-top: 0; padding-bottom: 14px; font-size: 12.5px; color: var(--text-secondary); }
  tr.lead { border-bottom: none; }
  tr.why { border-bottom: 1px solid var(--line); }
  .box { background: var(--surface-2); padding: 18px 20px; margin-top: 14px; }
  .box h3 { margin-top: 0; }
  .box ol, .box ul { margin: 8px 0 0; padding-left: 20px; }
  .box li { margin-bottom: 7px; max-width: 72ch; }
  .caveat { border-left: 3px solid var(--line-strong); padding-left: 16px; margin: 16px 0; }
  dl.defs { margin: 10px 0 0; }
  dl.defs dt { font-weight: 620; margin-top: 10px; font-size: 13.5px; }
  dl.defs dd { margin: 2px 0 0; color: var(--text-secondary); font-size: 13.5px; max-width: 74ch; }
  footer { margin-top: 52px; padding-top: 16px; border-top: 1px solid var(--line); color: var(--text-muted); font-size: 12px; }
  @media print {
    :root { --surface-1: #ffffff; --surface-2: #f2f2f0; --text-primary: #000; --text-secondary: #333; --text-muted: #555; }
    .wrap { max-width: none; padding: 0; }
    h2 { break-after: avoid; }
    tr, .box, .kpi { break-inside: avoid; }
    thead { display: table-header-group; }
    .hero .figure { font-size: 42px; }
  }
</style>
</head>
<body>
<div class="wrap">

<header class="top">
  <p class="eyebrow">Recoup Audit · insurance payment integrity review</p>
  <h1>Candidate underpayment report — ${practice}</h1>
  <p class="sub">
    ${result.totals.linesAudited.toLocaleString("en-US")} paid claim lines,
    ${esc(result.window.minDate ?? "—")} to ${esc(result.window.maxDate ?? "—")} ·
    generated ${esc(generated)}${opts.sourceFile ? ` · source: ${esc(opts.sourceFile)}` : ""}
  </p>
</header>

<section class="hero">
  <div class="figure">${fmtMoneyRounded(t.candidateTotal)}</div>
  <p class="caption">
    Candidate underpayments identified: <strong>${fmtMoney(t.candidateTotal)}</strong> across
    <strong>${result.findings.length.toLocaleString("en-US")}</strong> claim lines and
    <strong>${payersWithFindings.length}</strong> ${payersWithFindings.length === 1 ? "payer" : "payers"}.
    That is ${fmtPct(t.dollarsAudited > 0 ? t.candidateTotal / t.dollarsAudited : 0, 2)} of the
    ${fmtMoney(t.dollarsAudited)} in billed fees reviewed. <em>Candidate, not collectable</em> — see methodology.
  </p>
</section>

<div class="kpis">
  <div class="kpi">
    <div class="label">Claim lines audited</div>
    <div class="value">${t.linesAudited.toLocaleString("en-US")}</div>
    <div class="note">${fmtMoney(t.dollarsAudited)} billed</div>
  </div>
  <div class="kpi">
    <div class="label">Lines flagged</div>
    <div class="value">${result.findings.length.toLocaleString("en-US")}</div>
    <div class="note">${fmtPct(t.linesAudited > 0 ? result.findings.length / t.linesAudited : 0, 1)} of lines</div>
  </div>
  <div class="kpi">
    <div class="label">Payers reviewed</div>
    <div class="value">${t.byPayer.length}</div>
    <div class="note">${payersWithFindings.length} with candidate shortfalls</div>
  </div>
  <div class="kpi">
    <div class="label">Rate coverage</div>
    <div class="value">${fmtPct(coveragePct, 1)}</div>
    <div class="note">${c.pairsSchedulable} of ${c.pairsTotal} payer × code pairs priced</div>
  </div>
</div>

<h2>Where the money is — by payer</h2>
<p class="lede">Candidate shortfall dollars per payer, against the volume each payer was reviewed on.
Bar length is candidate dollars.</p>
<div class="tablewrap">
<table>
  <caption>All payers in the file, ranked by candidate dollars.</caption>
  <thead>
    <tr><th scope="col">Payer</th><th scope="col" class="num">Lines</th><th scope="col" class="num">Billed reviewed</th>
    <th scope="col" class="num">Findings</th><th scope="col">Candidate dollars</th></tr>
  </thead>
  <tbody>${payerRows}
    <tr class="totalrow"><th scope="row" class="strong">Total</th>
      <td class="num strong">${t.linesAudited.toLocaleString("en-US")}</td>
      <td class="num strong">${fmtMoney(t.dollarsAudited)}</td>
      <td class="num strong">${result.findings.length.toLocaleString("en-US")}</td>
      <td class="barcell"><span class="barline"><span class="bar-track"></span>
        <span class="barval strong">${fmtMoney(t.candidateTotal)}</span></span></td></tr>
  </tbody>
</table>
</div>

<h2>How the money leaks — by mechanism</h2>
<p class="lede">Each mechanism is a different conversation with the payer, and a different fix.
A line is attributed to one mechanism only, so these dollars do not overlap.</p>
<div class="tablewrap">
<table>
  <caption>Candidate dollars by detected mechanism.</caption>
  <thead>
    <tr><th scope="col">Mechanism</th><th scope="col" class="num">Lines</th>
    <th scope="col">Candidate dollars</th></tr>
  </thead>
  <tbody>${mechanismRows}</tbody>
</table>
</div>

<h2>Top ${top.length} dispute candidates</h2>
<p class="lede">Ranked by dollars at stake. The upper bar is what the rate says should have been allowed;
the lower bar is what the payer actually allowed.</p>
<div class="tablewrap">
<table>
  <caption>Patient identifiers are one-way hashes — no patient data leaves your file.</caption>
  <thead>
    <tr><th scope="col" class="num">#</th><th scope="col">Payer / patient</th><th scope="col">Service date</th>
    <th scope="col">Code</th><th scope="col">Expected vs actual</th><th scope="col" class="num">Expected</th>
    <th scope="col" class="num">Shortfall</th><th scope="col">Confidence</th></tr>
  </thead>
  <tbody>${topRows}</tbody>
</table>
</div>
${opts.extraSection ?? ""}
<h2>Methodology, and what this report cannot tell you</h2>
<p class="lede">Read this section before you act on any number above. An audit you cannot defend in a phone
call with a payer is worse than no audit.</p>

<h3>How the expected rate was established</h3>
${reconstructionNote}
<p>Reconstruction works like this: for every payer × CDT code pair, we take the <strong>most common allowed
amount</strong> the payer actually paid you (the modal rate), ignoring zeroed lines and secondary claims. The mode is
only trusted when it appears at least <strong>${MIN_SUPPORT} times</strong> and accounts for at least
<strong>${fmtPct(MIN_MODE_SHARE, 0)}</strong> of that pair's priced lines. Pairs below either threshold are marked
unschedulable and <em>excluded entirely</em> — they are never flagged and never guessed at.
Deviations are therefore measured against <em>the payer's own most common rate</em>, reconstructed from your own
payment history, not against an outside benchmark.</p>
<p>In this run, ${c.pairsSchedulable} of ${c.pairsTotal} payer × code pairs cleared that bar, covering
${fmtPct(coveragePct, 1)} of your claim lines. The ${result.unschedulable.length} unpriced pairs are listed in the
JSON export.</p>

<h3>What the confidence levels mean</h3>
<dl class="defs">
  <dt>High</dt><dd>${CONFIDENCE_NOTE.high}. The comparison is to a document, not an inference.</dd>
  <dt>Medium</dt><dd>${CONFIDENCE_NOTE.medium}. Strong enough to raise; verify the contract clause first.</dd>
  <dt>Low</dt><dd>${CONFIDENCE_NOTE.low}. Treat as a lead to investigate, not a dispute to file.</dd>
</dl>

<h3>Adjudication we deliberately did not flag</h3>
<p>False positives destroy an audit's credibility faster than missed dollars, so the engine suppresses a line
whenever the export explains it: a deductible that covers the gap; a patient portion plus payment that reconstructs
the allowed amount (ordinary coinsurance); secondary and tertiary claims, unless they were allowed below schedule;
annual-maximum, frequency, non-covered, waiting-period and coordination-of-benefit remark codes; plans showing 0%
coverage; and non-covered procedures billed to the patient in full. Tolerance is the greater of
${fmtMoney(result.tolerance.absCents)} or ${fmtPct(result.tolerance.pct, 0)} per line, so rounding differences never
appear here.</p>

<div class="caveat">
  <p><strong>Candidate ≠ collectable.</strong> Every figure in this report is a <em>candidate</em>: a line where the
  payment does not match the rate we could establish. Turning a candidate into a check requires reading your actual
  contract with that payer — including its alternate-benefit (downgrade), bundling, and network-access clauses. Some
  of these findings will turn out to be contractually permitted. That is a finding too: it tells you what to
  renegotiate.</p>
</div>

<h3>What this audit cannot see</h3>
<ul>
  <li><strong>The EOB itself.</strong> This audit reads your practice-management export only. Reasons printed on a
  paper or PDF EOB but never keyed into the system are invisible to it — which is why "allowed but not paid" findings
  ask you to check the EOB rather than assert an error.</li>
  <li><strong>Your contract language.</strong> Without the signed fee schedule and its exhibits, the engine cannot know
  whether a downgrade or bundling edit was permitted.</li>
  <li><strong>Plan-level benefit limits.</strong> Frequency limits, missing-tooth clauses and waiting periods are only
  visible when the payer stated them in the export.</li>
  <li><strong>A payer that underpays consistently.</strong> Reconstruction learns the payer's <em>usual</em> rate. If a
  payer has underpaid a code more than half the time, its habit becomes the reconstructed baseline and the shortfall is
  invisible. Supplying a real fee schedule removes this blind spot entirely — it is the single highest-value thing you
  can add to this audit.</li>
  <li><strong>Claims never submitted, and lines never posted.</strong> Money lost before adjudication is out of scope.</li>
</ul>

<div class="box">
  <h3>Next steps</h3>
  <ol>
    <li><strong>Send us your contracted fee schedules</strong> for the top payers above. That converts medium-confidence
    findings into high-confidence ones and removes the consistent-underpayment blind spot.</li>
    <li><strong>Pull the EOBs for the top 20 lines.</strong> Confirm the allowed amount and look at the network logo —
    that is where repricing clusters get confirmed or dismissed.</li>
    <li><strong>Check three contract clauses</strong>: alternate benefit / downgrade, bundling of build-ups and imaging,
    and network access (leasing). Those three explain most of the dollars above.</li>
    <li><strong>Work the confirmed lines in one batch per payer.</strong> One appeal citing twelve claims moves faster
    than twelve appeals.</li>
    <li><strong>Re-run this audit quarterly.</strong> The value compounds: payer behaviour drifts, and the same edit
    applied silently across a year is the difference between an annoyance and a payroll.</li>
  </ol>
</div>

<footer>
  Generated by Recoup Audit (@nightshift/recoup-audit) on ${esc(result.generatedAt)}.
  Patient identifiers are one-way hashed; no subscriber IDs are retained in this file.
  This report is an analysis of your own exported data and is not legal, coding, or billing advice.
</footer>

</div>
</body>
</html>
`;
}
