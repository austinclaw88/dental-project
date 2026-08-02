/**
 * Screen 3 — results.
 *
 * The engine's own HTML report is the deliverable; this page must not compete with
 * it. So: a thin bar with the four things someone actually wants (start over, and
 * the three files), and then the report itself, full width, in an iframe served
 * from the run directory.
 *
 * The report is a complete self-contained document — its own stylesheet, its own
 * dark-mode handling — so an iframe keeps its CSS from colliding with this page's,
 * and keeps the file we hand over byte-identical to the one served at the download
 * link. The frame is resized to its content so the page scrolls once, not twice.
 */

import { fmtMoney } from "@nightshift/recoup-audit/lib";
import type { RunMeta } from "../store.js";
import { esc, page } from "./layout.js";

const RESIZE_JS = `
(function () {
  var frame = document.getElementById("report");
  if (!frame) return;
  function fit() {
    try {
      var doc = frame.contentDocument;
      if (!doc || !doc.body) return;
      var h = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
      if (h > 0) frame.style.height = (h + 24) + "px";
    } catch (e) { /* cross-origin can't happen here; ignore anyway */ }
  }
  frame.addEventListener("load", function () {
    fit();
    setTimeout(fit, 120);
    setTimeout(fit, 600);
  });
  window.addEventListener("resize", fit);
  fit();
})();
`;

export function resultsPage(meta: RunMeta): string {
  const banner = meta.isDemo
    ? `<div class="demobanner">
        <strong>Sample data — this is what your report would look like.</strong>
        Generated from a synthetic twelve-month dataset with a known answer key: 1,500 claim lines across five
        payers, deliberately planted leakage, and abundant legitimate adjudication that must not be flagged.
        No fee schedule was supplied, so every rate below was reconstructed from the fictional practice's own
        payment history. <a href="/">Audit your own export →</a>
      </div>`
    : "";

  const rejected =
    meta.rowsRejected > 0
      ? ` · <span title="Rows that could not be read — usually a blank required cell or an unparseable date.">${meta.rowsRejected.toLocaleString(
          "en-US",
        )} row${meta.rowsRejected === 1 ? "" : "s"} skipped</span>`
      : "";

  return page(
    { title: `Audit results — ${meta.practiceName ?? "your practice"}` },
    `${banner}
<div class="resultbar">
  <span class="brand">Recoup Audit</span>
  <span class="meta">${fmtMoney(Math.round(meta.candidateDollars * 100))} candidate ·
    ${meta.linesAudited.toLocaleString("en-US")} lines audited ·
    ${meta.findings.toLocaleString("en-US")} findings${rejected}</span>
  <span class="links">
    <a class="dl" href="/">Start over</a>
    <a class="dl" href="/runs/${esc(meta.id)}/report.html" download>Download report.html</a>
    <a class="dl" href="/runs/${esc(meta.id)}/findings.csv" download>findings.csv</a>
    <a class="dl" href="/runs/${esc(meta.id)}/findings.json" download>findings.json</a>
  </span>
</div>
<iframe id="report" class="reportframe" src="/runs/${esc(meta.id)}/report.html"
  title="Candidate underpayment report" loading="eager"></iframe>
<script>${RESIZE_JS}</script>`,
  );
}
