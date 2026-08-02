/**
 * Error pages.
 *
 * The person who hits these is an office manager who exported a CSV out of a system
 * they did not choose. "400 Bad Request" tells them nothing; the engine's own error
 * messages, on the other hand, are unusually good — they name the field, what was
 * looked for, and what was actually in the file. So we show those verbatim, add the
 * fix, and always leave a way back.
 */

import { esc, page, PRIVACY_FOOTER } from "./layout.js";

export interface ErrorViewModel {
  title: string;
  summary: string;
  /** Verbatim engine/parser message, shown in a monospace block. */
  detail?: string;
  /** Concrete things to try, in order. */
  fixes?: string[];
  backHref?: string;
  backLabel?: string;
}

export function errorPage(vm: ErrorViewModel): string {
  return page(
    { title: `${vm.title} — Recoup Audit` },
    `<div class="wrap">
<p class="eyebrow">Recoup Audit</p>
<h1>${esc(vm.title)}</h1>
<p class="lede">${esc(vm.summary)}</p>

<div class="errbox">
  ${vm.detail ? `<h3>What the audit engine said</h3><pre>${esc(vm.detail)}</pre>` : ""}
  ${
    vm.fixes && vm.fixes.length > 0
      ? `<h3${vm.detail ? ' style="margin-top:18px"' : ""}>How to fix it</h3><ul>${vm.fixes
          .map((f) => `<li>${f}</li>`)
          .join("")}</ul>`
      : ""
  }
</div>

<div class="actions">
  <a class="btn" href="${esc(vm.backHref ?? "/")}">${esc(vm.backLabel ?? "← Start over")}</a>
  <a class="btn ghost small" href="/demo">See a sample audit instead</a>
</div>

${PRIVACY_FOOTER}
</div>`,
  );
}

export function notFoundPage(what: string): string {
  return errorPage({
    title: "That run is gone",
    summary: what,
    fixes: [
      "Uploaded files and their results are deleted <strong>60 minutes</strong> after the audit runs — that is the privacy promise, not a bug.",
      "Download <code>report.html</code>, <code>findings.csv</code> and <code>findings.json</code> while the results page is open; the report is a single self-contained file that opens from an email attachment.",
      "Re-upload the same export to produce the same audit — the engine is deterministic given the same input.",
    ],
  });
}
