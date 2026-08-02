/**
 * Screen 2 — column mapping.
 *
 * The engine will not audit a file it cannot read, and a wrong mapping produces
 * confident nonsense. So this screen shows the operator the actual first rows of
 * their own file, pre-selects every column we could identify, and refuses to run
 * until all seven required fields point somewhere.
 *
 * The dropdowns are the whole interaction. Everything else on the page exists to
 * let someone sanity-check a guess in two seconds.
 */

import { OPTIONAL_FIELDS, REQUIRED_FIELDS, type CanonicalField } from "@nightshift/recoup-audit/lib";
import {
  BASIS_LABEL,
  FIELD_HINTS,
  FIELD_LABELS,
  HIGH_VALUE_OPTIONAL,
  type Detection,
  type FeeDetection,
} from "../detect.js";
import { esc, page, PRIVACY_FOOTER } from "./layout.js";

export interface MappingViewModel {
  runId: string;
  claimsFilename: string;
  feesFilename?: string;
  headers: string[];
  previewRows: Array<Record<string, string>>;
  totalRows: number;
  detection: Detection;
  feeDetection?: FeeDetection[];
  feeError?: string;
  settings: {
    practice?: string;
    since?: string;
    until?: string;
    tolerance: string;
    tolerancePct: string;
  };
  error?: string;
}

const MAPPING_JS = `
(function () {
  var required = JSON.parse(document.getElementById("required-fields").textContent);
  var run = document.getElementById("run");
  var summary = document.getElementById("mapstatus");

  function refresh() {
    var missing = [];
    var seen = {};
    var dupes = [];
    var selects = document.querySelectorAll("select.colsel");
    Array.prototype.forEach.call(selects, function (sel) {
      var field = sel.getAttribute("data-field");
      var row = sel.closest("tr");
      var status = row.querySelector(".statuscell");
      var isRequired = required.indexOf(field) !== -1;
      var value = sel.value;

      if (value === "") {
        if (isRequired) { missing.push(field); row.classList.add("unmapped"); }
        else row.classList.remove("unmapped");
      } else {
        row.classList.remove("unmapped");
        if (seen[value]) dupes.push(value); else seen[value] = field;
      }

      if (status && sel.getAttribute("data-touched") === "1") {
        status.innerHTML = value === ""
          ? (isRequired ? '<span class="tag need">required — pick a column</span>'
                        : '<span class="tag off">not in this file</span>')
          : '<span class="tag ok">you chose this</span>';
      }
    });

    if (run) run.disabled = missing.length > 0;
    if (summary) {
      if (missing.length > 0) {
        summary.className = "banner warn";
        summary.innerHTML = "<p><strong>" + missing.length + " required field" +
          (missing.length === 1 ? "" : "s") + " still unmapped.</strong> " +
          "Pick the matching column for each highlighted row below — the audit cannot run without them.</p>";
      } else if (dupes.length > 0) {
        summary.className = "banner warn";
        summary.innerHTML = "<p><strong>Two fields point at the same column.</strong> " +
          "That is usually a mistake — check the highlighted selections before running.</p>";
      } else {
        summary.className = "banner info";
        summary.innerHTML = "<p>All seven required fields are mapped. Check the preview above matches what you expect, then run the audit.</p>";
      }
    }
  }

  document.addEventListener("change", function (e) {
    if (e.target && e.target.classList && e.target.classList.contains("colsel")) {
      e.target.setAttribute("data-touched", "1");
      refresh();
    }
  });

  var form = document.getElementById("runform");
  if (form) {
    form.addEventListener("submit", function () {
      if (run) { run.classList.add("busy"); run.disabled = true; }
      var note = document.getElementById("runnote");
      if (note) note.textContent = "Auditing every line — this usually takes a couple of seconds.";
    });
  }
  refresh();
})();
`;

function statusTag(field: CanonicalField, d: Detection): string {
  const det = d[field];
  if (det.header === undefined) {
    return det.required
      ? `<span class="tag need">required — pick a column</span>`
      : `<span class="tag off">not in this file</span>`;
  }
  const cls = det.basis === "contains" ? "guess" : "ok";
  const label =
    det.basis === "preset" && det.presetName !== undefined && det.presetName !== "generic"
      ? `${det.presetName} preset`
      : BASIS_LABEL[det.basis];
  return `<span class="tag ${cls}">${esc(label)}</span>`;
}

function fieldRow(field: CanonicalField, vm: MappingViewModel): string {
  const det = vm.detection[field];
  const unmapped = det.required && det.header === undefined;
  const options = [
    `<option value=""${det.header === undefined ? " selected" : ""}>${
      det.required ? "— pick a column —" : "— not in this file —"
    }</option>`,
    ...vm.headers.map(
      (h) =>
        `<option value="${esc(h)}"${det.header === h ? " selected" : ""}>${esc(h)}</option>`,
    ),
  ].join("");

  return `
      <tr${unmapped ? ' class="unmapped"' : ""}>
        <td class="fieldcell">
          <span class="fieldname">${esc(FIELD_LABELS[field])}${det.required ? ' <span class="req">*</span>' : ""}</span>
          <span class="fieldhint">${esc(FIELD_HINTS[field])}</span>
        </td>
        <td class="selcell">
          <select class="colsel" id="col_${field}" name="col_${field}" data-field="${field}"
            aria-label="Column for ${esc(FIELD_LABELS[field])}">${options}</select>
        </td>
        <td class="statuscell">${statusTag(field, vm.detection)}</td>
      </tr>`;
}

function previewTable(vm: MappingViewModel): string {
  if (vm.headers.length === 0) return "";
  const head = vm.headers.map((h) => `<th scope="col">${esc(h)}</th>`).join("");
  const body = vm.previewRows
    .map(
      (row) =>
        `<tr>${vm.headers.map((h) => `<td title="${esc(row[h] ?? "")}">${esc(row[h] ?? "")}</td>`).join("")}</tr>`,
    )
    .join("");
  return `
<div class="tablewrap">
  <table class="preview">
    <thead><tr>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table>
</div>`;
}

function feesBlock(vm: MappingViewModel): string {
  if (vm.feesFilename === undefined) return "";
  if (vm.feeError !== undefined) {
    return `
<div class="sectionhead"><h2>Contracted fee schedule</h2></div>
<div class="banner warn"><p><strong>${esc(vm.feesFilename)} could not be read, so it will be ignored.</strong>
${esc(vm.feeError)} Every rate will be reconstructed from your payment history instead — the audit still runs,
with medium confidence rather than high.</p></div>`;
  }
  const rows = (vm.feeDetection ?? [])
    .map(
      (f) => `
      <tr>
        <td class="fieldcell"><span class="fieldname">${esc(f.field)}${f.required ? ' <span class="req">*</span>' : ""}</span></td>
        <td class="selcell">${f.header ? `<code>${esc(f.header)}</code>` : `<span class="muted">—</span>`}</td>
        <td class="statuscell">${
          f.header
            ? `<span class="tag ok">matched</span>`
            : f.required
              ? `<span class="tag need">missing</span>`
              : `<span class="tag off">not in this file</span>`
        }</td>
      </tr>`,
    )
    .join("");
  return `
<div class="sectionhead">
  <h2>Contracted fee schedule</h2>
  <span class="count">${esc(vm.feesFilename)} · matched automatically</span>
</div>
<p class="sub">Fee schedules use a fixed shape, so there is nothing to choose here — this is just what was found.
Rates from this file take precedence over reconstruction, and the findings they produce are high confidence.</p>
<div class="tablewrap" style="margin-top:12px">
  <table class="mapping">
    <thead><tr><th scope="col">Field</th><th scope="col">Column in your file</th><th scope="col">Status</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

export function mappingPage(vm: MappingViewModel): string {
  const missing = REQUIRED_FIELDS.filter((f) => vm.detection[f].header === undefined);
  const optionalFound = OPTIONAL_FIELDS.filter((f) => vm.detection[f].header !== undefined);
  const highValueMissing = HIGH_VALUE_OPTIONAL.filter((f) => vm.detection[f].header === undefined);

  const statusBanner =
    missing.length > 0
      ? `<div class="banner warn" id="mapstatus"><p><strong>${missing.length} required field${
          missing.length === 1 ? "" : "s"
        } still unmapped.</strong> Pick the matching column for each highlighted row below — the audit cannot run
        without them.</p></div>`
      : `<div class="banner info" id="mapstatus"><p>All seven required fields are mapped. Check the preview above
        matches what you expect, then run the audit.</p></div>`;

  return page(
    { title: "Confirm your columns — Recoup Audit" },
    `<div class="wrap wide">

<p class="eyebrow">Recoup Audit · step 2 of 3</p>
<h1>Confirm which column is which.</h1>
<p class="lede">We read <strong>${esc(vm.claimsFilename)}</strong> and found
${vm.headers.length} column${vm.headers.length === 1 ? "" : "s"} across
${vm.totalRows.toLocaleString("en-US")} data row${vm.totalRows === 1 ? "" : "s"}.
Anything we recognised is already selected — change what looks wrong.</p>

${vm.error ? `<div class="banner warn" role="alert"><p>${esc(vm.error)}</p></div>` : ""}

<div class="sectionhead">
  <h2>First ${vm.previewRows.length} row${vm.previewRows.length === 1 ? "" : "s"} of your file</h2>
  <span class="count">scroll sideways to see every column</span>
</div>
${previewTable(vm)}

<form id="runform" method="post" action="/run">
  <input type="hidden" name="runId" value="${esc(vm.runId)}">
  <input type="hidden" name="practice" value="${esc(vm.settings.practice ?? "")}">
  <input type="hidden" name="since" value="${esc(vm.settings.since ?? "")}">
  <input type="hidden" name="until" value="${esc(vm.settings.until ?? "")}">
  <input type="hidden" name="tolerance" value="${esc(vm.settings.tolerance)}">
  <input type="hidden" name="tolerancePct" value="${esc(vm.settings.tolerancePct)}">

  <div class="sectionhead">
    <h2>Required columns</h2>
    <span class="count">all seven must be mapped</span>
  </div>
  ${statusBanner}
  <div class="tablewrap">
    <table class="mapping">
      <thead><tr><th scope="col">Field</th><th scope="col">Column in your file</th><th scope="col">How we matched it</th></tr></thead>
      <tbody>${REQUIRED_FIELDS.map((f) => fieldRow(f, vm)).join("")}</tbody>
    </table>
  </div>

  <div class="sectionhead">
    <h2>Optional columns</h2>
    <span class="count">${optionalFound.length} of ${OPTIONAL_FIELDS.length} found automatically</span>
  </div>
  <p class="sub">These do not gate the audit — they suppress false positives. ${
    highValueMissing.length > 0
      ? `Four of them do most of that work, and ${highValueMissing.length} ${
          highValueMissing.length === 1 ? "is" : "are"
        } missing here (${highValueMissing.map((f) => esc(FIELD_LABELS[f])).join(", ")}). Without them, more
        findings will be ordinary adjudication that needs manual review.`
      : `All four of the high-value guards — deductible, patient portion, adjustment codes and claim ordinal —
        are present, which is the best case for keeping false positives down.`
  }</p>
  <div class="tablewrap" style="margin-top:12px">
    <table class="mapping">
      <thead><tr><th scope="col">Field</th><th scope="col">Column in your file</th><th scope="col">How we matched it</th></tr></thead>
      <tbody>${OPTIONAL_FIELDS.map((f) => fieldRow(f, vm)).join("")}</tbody>
    </table>
  </div>

  ${feesBlock(vm)}

  <div class="actions">
    <button class="btn" id="run" type="submit"${missing.length > 0 ? " disabled" : ""}>
      <span class="spinner" aria-hidden="true"></span>Run audit →</button>
    <a class="btn ghost small" href="/">Start over</a>
    <span class="sub" id="runnote" style="margin:0">Runs on this server, in memory. Nothing is sent anywhere else.</span>
  </div>
</form>

<script type="application/json" id="required-fields">${JSON.stringify([...REQUIRED_FIELDS])}</script>

${PRIVACY_FOOTER}
</div>
<script>${MAPPING_JS}</script>`,
  );
}
