/**
 * Screen 1 — the landing page.
 *
 * One job: get a CSV out of a practice-management system and into the upload zone.
 * Everything that is not that (tolerances, date window, practice name) is folded
 * under "Advanced", and the prospect who has no export yet gets the sample audit
 * instead of a dead end.
 */

import { esc, page, PRIVACY_FOOTER } from "./layout.js";

const DROPZONE_JS = `
(function () {
  var zones = document.querySelectorAll(".dropzone");
  Array.prototype.forEach.call(zones, function (zone) {
    var input = zone.querySelector('input[type="file"]');
    var out = zone.querySelector(".dz-file");
    var placeholder = out ? out.getAttribute("data-empty") || "" : "";
    if (!input) return;

    function show() {
      var f = input.files && input.files[0];
      if (out) {
        out.textContent = f ? f.name + "  \\u00b7  " + Math.max(1, Math.round(f.size / 1024)) + " KB" : placeholder;
        out.classList.toggle("empty", !f);
      }
      zone.classList.toggle("filled", !!f);
      sync();
    }
    zone.addEventListener("click", function (e) {
      if (e.target !== input) { e.preventDefault(); input.click(); }
    });
    zone.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
    });
    ["dragenter", "dragover"].forEach(function (t) {
      zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.add("dragover"); });
    });
    ["dragleave", "drop"].forEach(function (t) {
      zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.remove("dragover"); });
    });
    zone.addEventListener("drop", function (e) {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        input.files = e.dataTransfer.files;
        show();
      }
    });
    input.addEventListener("change", show);
  });

  var claims = document.getElementById("claims");
  var submit = document.getElementById("go");
  function sync() {
    if (!claims || !submit) return;
    submit.disabled = !(claims.files && claims.files.length);
  }
  sync();

  var form = document.getElementById("uploadform");
  if (form) {
    form.addEventListener("submit", function () {
      if (submit) { submit.classList.add("busy"); submit.disabled = true; }
    });
  }
})();
`;

export function landingPage(error?: string): string {
  return page(
    { title: "Recoup Audit — find out what insurance actually owes you" },
    `<div class="wrap">

<p class="eyebrow">Recoup Audit · insurance payment integrity review</p>
<h1>Find out what insurance actually owes you.</h1>
<p class="lede">Upload twelve months of paid claims from any practice management system. We compare every
line against the rate your payers themselves establish — or against your contracted schedule, if you have
it — and hand back the claims worth disputing, with the evidence attached.</p>

${error ? `<div class="banner warn" role="alert"><p>${esc(error)}</p></div>` : ""}

<form id="uploadform" method="post" action="/upload" enctype="multipart/form-data">
  <div class="zones">
    <label class="dropzone" for="claims" tabindex="0">
      <input type="file" id="claims" name="claims" accept=".csv,text/csv,text/plain" required>
      <span class="dz-tag">Required</span>
      <div class="dz-title">Paid claims CSV</div>
      <p class="dz-note">Drag a file here, or click to browse. One row per <em>procedure</em> — a claim with a
      crown and a build-up is two rows. Any PMS, any column names; you confirm the mapping on the next screen.</p>
      <div class="dz-file empty" data-empty="No file chosen yet · CSV, up to 25 MB">No file chosen yet · CSV, up to 25 MB</div>
    </label>

    <label class="dropzone dz-optional" for="fees" tabindex="0">
      <input type="file" id="fees" name="fees" accept=".csv,text/csv,text/plain">
      <span class="dz-tag">Optional</span>
      <div class="dz-title">Contracted fee schedule</div>
      <p class="dz-note">payer, CDT code, contracted rate. Supplying real rates upgrades findings from
      medium to high confidence — it is the single highest-value thing you can add.</p>
      <div class="dz-file empty" data-empty="No file chosen · the audit runs without one">No file chosen · the audit runs without one</div>
    </label>
  </div>

  <details class="adv">
    <summary>Advanced settings</summary>
    <div class="grid-adv">
      <div class="field">
        <label class="cap" for="practice">Practice name</label>
        <input type="text" id="practice" name="practice" placeholder="Your practice" autocomplete="organization">
        <div class="help">Printed on the report header.</div>
      </div>
      <div class="field">
        <label class="cap" for="since">Service dates from</label>
        <input type="date" id="since" name="since">
        <div class="help">Blank audits the whole file.</div>
      </div>
      <div class="field">
        <label class="cap" for="until">Service dates to</label>
        <input type="date" id="until" name="until">
        <div class="help">Rates are rebuilt from the window only.</div>
      </div>
      <div class="field">
        <label class="cap" for="tolerance">Tolerance ($)</label>
        <input type="number" id="tolerance" name="tolerance" value="1.00" min="0" step="0.01">
        <div class="help">Absolute floor per line.</div>
      </div>
      <div class="field">
        <label class="cap" for="tolerancePct">Tolerance (%)</label>
        <input type="number" id="tolerancePct" name="tolerancePct" value="1" min="0" step="0.1">
        <div class="help">A line is flagged only when it misses by more than the greater of the two.</div>
      </div>
    </div>
  </details>

  <div class="actions">
    <button class="btn" id="go" type="submit" disabled><span class="spinner" aria-hidden="true"></span>Map the columns →</button>
    <span class="sub" style="margin:0">Nothing runs until you confirm which column is which.</span>
  </div>
</form>

<div class="altpath">
  <div class="copy">
    <h3>Haven't pulled your export yet?</h3>
    <p>See a full audit run against a synthetic twelve-month dataset — 1,500 claim lines, five payers,
    with a known answer key. Same engine, same report you would receive.</p>
  </div>
  <a class="btn ghost" href="/demo">See a sample audit →</a>
</div>

<h2>What the file needs</h2>
<p class="sub">Seven columns are non-negotiable: <strong>claim ID</strong>, <strong>service date</strong>,
<strong>payer</strong>, <strong>CDT code</strong>, <strong>billed fee</strong>,
<strong>allowed amount</strong> and <strong>insurance paid</strong>. The allowed amount is the one most
exports omit and the only one nothing can substitute for — if your export has billed, paid and write-off but
no allowed amount, add a computed column: <code>allowed = billed − write-off</code>.</p>
<p class="sub">Nine more are optional and are what <em>rule out</em> false positives: plan or group,
subscriber ID, tooth, patient portion, write-off, deductible applied, adjustment/remark codes,
primary-or-secondary, network, coverage %. The four that carry the most weight are deductible applied,
patient portion, adjustment codes and claim ordinal — they are how the engine recognises ordinary
coinsurance, a met deductible, an exhausted annual maximum and a secondary claim. Every one you omit means
more findings that need manual review.</p>

${PRIVACY_FOOTER}
</div>
<script>${DROPZONE_JS}</script>`,
  );
}
