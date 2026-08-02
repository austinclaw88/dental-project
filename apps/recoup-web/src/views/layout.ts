/**
 * Page shell and the single stylesheet.
 *
 * Deliberately the same restraint as the engine's HTML report: system fonts, one
 * accent hue, ink on off-white, whitespace instead of ornament. A practice owner
 * arrives here from a cold email; the page has to look like an instrument, not a
 * funnel. No external assets — nothing here makes a network request.
 */

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CSS = `
:root {
  color-scheme: light;
  --surface-1: #fcfcfb;
  --surface-2: #f4f3f0;
  --surface-3: #eceae5;
  --line: #e2e1dc;
  --line-strong: #c9c8c2;
  --text-primary: #0b0b0b;
  --text-secondary: #52514e;
  --text-muted: #78776f;
  --accent: #2a78d6;
  --accent-deep: #1d5ca8;
  --accent-wash: #eef4fd;
  --warn: #9a5b12;
  --warn-wash: #fdf3e6;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--surface-1);
  color: var(--text-primary);
  font: 15px/1.55 ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--accent-deep); }
code {
  font: 12.5px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  background: var(--surface-2); border: 1px solid var(--line);
  border-radius: 3px; padding: 1px 5px; white-space: nowrap;
}
.wrap { max-width: 880px; margin: 0 auto; padding: 56px 24px 80px; }
.wrap.wide { max-width: 1080px; }
.eyebrow {
  font-size: 12px; letter-spacing: .09em; text-transform: uppercase;
  color: var(--text-muted); margin: 0 0 10px;
}
h1 { font-size: 30px; line-height: 1.18; margin: 0 0 12px; font-weight: 620; letter-spacing: -0.01em; max-width: 20ch; }
.wrap.wide h1 { max-width: 34ch; }
h2 { font-size: 17px; margin: 44px 0 4px; font-weight: 620; }
h3 { font-size: 13.5px; margin: 0 0 4px; font-weight: 620; }
p { max-width: 68ch; }
.lede { color: var(--text-secondary); font-size: 16px; margin: 0 0 8px; max-width: 60ch; }
.sub { color: var(--text-secondary); font-size: 13.5px; margin: 4px 0 0; max-width: 68ch; }
.muted { color: var(--text-muted); }
.nowrap { white-space: nowrap; }
hr.rule { border: 0; border-top: 1px solid var(--line); margin: 40px 0; }

/* ---- forms ---- */
form { margin: 0; }
fieldset { border: 0; margin: 0; padding: 0; }
label { display: block; }
input[type="text"], input[type="date"], input[type="number"], select {
  font: inherit; font-size: 14px; color: var(--text-primary);
  background: #fff; border: 1px solid var(--line-strong); border-radius: 3px;
  padding: 7px 9px; width: 100%; max-width: 100%;
}
select { appearance: none; -webkit-appearance: none;
  background-image: linear-gradient(45deg, transparent 50%, var(--text-muted) 50%),
                    linear-gradient(135deg, var(--text-muted) 50%, transparent 50%);
  background-position: calc(100% - 16px) calc(50% + 1px), calc(100% - 11px) calc(50% + 1px);
  background-size: 5px 5px, 5px 5px; background-repeat: no-repeat; padding-right: 30px;
}
input:focus-visible, select:focus-visible, button:focus-visible, .dropzone:focus-visible, a:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px;
}
.btn {
  font: inherit; font-size: 15px; font-weight: 560; cursor: pointer;
  background: var(--accent); color: #fff; border: 1px solid var(--accent);
  border-radius: 3px; padding: 11px 22px; display: inline-flex; align-items: center; gap: 9px;
}
.btn:hover { background: var(--accent-deep); border-color: var(--accent-deep); }
.btn[disabled] { background: var(--surface-3); border-color: var(--line-strong); color: var(--text-muted); cursor: not-allowed; }
.btn.ghost { background: transparent; color: var(--text-primary); border-color: var(--line-strong); }
.btn.ghost:hover { background: var(--surface-2); border-color: var(--text-muted); }
.btn.small { font-size: 13px; padding: 6px 13px; }
.actions { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; margin-top: 28px; }

/* ---- upload zones ---- */
.zones { display: grid; grid-template-columns: 1fr; gap: 14px; margin-top: 28px; }
@media (min-width: 720px) { .zones { grid-template-columns: 1.35fr 1fr; } }
.dropzone {
  position: relative; display: block; cursor: pointer;
  border: 1px dashed var(--line-strong); border-radius: 4px;
  background: var(--surface-2); padding: 24px 22px 60px; min-height: 208px;
  transition: border-color .12s, background .12s;
}
.dropzone:hover { border-color: var(--accent); background: var(--accent-wash); }
.dropzone.dragover { border-color: var(--accent); border-style: solid; background: var(--accent-wash); }
.dropzone.filled { border-style: solid; border-color: var(--accent); background: var(--accent-wash); }
.dropzone input[type="file"] { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.dz-tag { font-size: 11.5px; letter-spacing: .07em; text-transform: uppercase; color: var(--text-muted); }
.dz-title { font-size: 16px; font-weight: 600; margin: 8px 0 4px; }
.dz-note { font-size: 13px; color: var(--text-secondary); margin: 0; max-width: 42ch; }
.dz-file {
  font-size: 13px; color: var(--accent-deep); font-weight: 560; word-break: break-all;
  position: absolute; left: 22px; right: 22px; bottom: 20px;
  padding-top: 11px; border-top: 1px solid var(--line);
}
.dz-file.empty { color: var(--text-muted); font-weight: 400; }
.dropzone.filled .dz-file { border-top-color: #cfe0f7; }
.dz-optional { border-style: dashed; background: var(--surface-1); }

/* ---- disclosure ---- */
details.adv { margin-top: 22px; border-top: 1px solid var(--line); padding-top: 14px; }
details.adv > summary {
  cursor: pointer; font-size: 13.5px; color: var(--text-secondary); font-weight: 560;
  list-style: none; display: inline-flex; align-items: center; gap: 7px;
}
details.adv > summary::-webkit-details-marker { display: none; }
details.adv > summary::before { content: "+"; color: var(--text-muted); font-weight: 400; width: 10px; }
details.adv[open] > summary::before { content: "\\2212"; }
.grid-adv { display: grid; grid-template-columns: repeat(auto-fit, minmax(146px, 1fr)); gap: 14px 16px; margin-top: 18px; align-items: start; }
.field label.cap { font-size: 12px; letter-spacing: .04em; text-transform: uppercase; color: var(--text-muted); margin-bottom: 5px; }
.field .help { font-size: 12px; color: var(--text-muted); margin-top: 5px; }

/* ---- alt path ---- */
.altpath {
  margin-top: 30px; padding: 20px 22px; border: 1px solid var(--line);
  border-left: 3px solid var(--accent); border-radius: 3px; background: var(--surface-2);
  display: flex; flex-wrap: wrap; gap: 16px; align-items: center; justify-content: space-between;
}
.altpath .copy { flex: 1 1 340px; }
.altpath h3 { margin: 0 0 3px; }
.altpath p { margin: 0; font-size: 13.5px; color: var(--text-secondary); max-width: 52ch; }

/* ---- tables ---- */
.tablewrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 3px; background: #fff; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
caption { text-align: left; color: var(--text-secondary); font-size: 12.5px; padding: 0 0 8px; }
th, td { text-align: left; padding: 8px 12px; vertical-align: top; }
thead th {
  font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: var(--text-muted);
  font-weight: 560; border-bottom: 1px solid var(--line-strong); white-space: nowrap; background: var(--surface-2);
}
tbody tr { border-bottom: 1px solid var(--line); }
tbody tr:last-child { border-bottom: 0; }
.preview td { white-space: nowrap; font-variant-numeric: tabular-nums; color: var(--text-secondary); max-width: 190px; overflow: hidden; text-overflow: ellipsis; }
.preview tbody tr:nth-child(even) { background: var(--surface-1); }

/* ---- mapping table ---- */
table.mapping { font-size: 13.5px; }
table.mapping td { vertical-align: middle; }
table.mapping .fieldcell { width: 34%; min-width: 210px; }
table.mapping .selcell { width: 36%; min-width: 210px; }
table.mapping .statuscell { width: 30%; min-width: 150px; }
.fieldname { font-weight: 560; }
.fieldname .req { color: var(--accent-deep); font-weight: 640; }
.fieldhint { display: block; font-size: 12px; color: var(--text-muted); margin-top: 2px; max-width: 46ch; }
tr.unmapped { background: var(--warn-wash); }
tr.unmapped select { border-color: #d9a45c; }
.tag {
  display: inline-block; font-size: 11px; letter-spacing: .04em; text-transform: uppercase;
  border: 1px solid var(--line-strong); border-radius: 3px; padding: 1px 6px; color: var(--text-muted);
  white-space: nowrap;
}
.tag.ok { border-color: var(--accent); color: var(--accent-deep); }
.tag.guess { border-color: #d9a45c; color: var(--warn); }
.tag.need { border-color: #c98a3c; background: #f7e4c8; color: var(--warn); font-weight: 600; }
.tag.off { opacity: .7; }
.sectionhead { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin: 40px 0 6px; flex-wrap: wrap; }
.sectionhead h2 { margin: 0; }
.sectionhead .count { font-size: 12.5px; color: var(--text-muted); }

/* ---- banners ---- */
.banner { padding: 13px 18px; border-radius: 3px; font-size: 13.5px; margin-bottom: 20px; }
.banner p { margin: 0; max-width: 76ch; }
.banner.info { background: var(--accent-wash); border: 1px solid #cfe0f7; color: var(--accent-deep); }
.banner.warn { background: var(--warn-wash); border: 1px solid #ecd4ae; color: var(--warn); }

/* ---- results ---- */
.resultbar {
  position: sticky; top: 0; z-index: 5; background: var(--surface-1);
  border-bottom: 1px solid var(--line-strong);
  display: flex; flex-wrap: wrap; align-items: center; gap: 12px 18px; padding: 12px 22px;
}
.resultbar .brand { font-weight: 620; font-size: 14px; letter-spacing: -0.005em; margin-right: 2px; }
.resultbar .meta { font-size: 12.5px; color: var(--text-muted); flex: 1 1 220px; }
.resultbar .links { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.resultbar a.dl { font-size: 12.5px; text-decoration: none; color: var(--text-primary);
  border: 1px solid var(--line-strong); border-radius: 3px; padding: 5px 11px; background: #fff; white-space: nowrap; }
.resultbar a.dl:hover { border-color: var(--accent); color: var(--accent-deep); }
.demobanner { background: var(--accent-wash); border-bottom: 1px solid #cfe0f7; color: var(--accent-deep);
  font-size: 13px; padding: 9px 22px; }
.demobanner strong { font-weight: 620; }
.reportframe { display: block; width: 100%; border: 0; min-height: 78vh; background: var(--surface-1); }

/* ---- footer ---- */
footer.foot {
  margin-top: 64px; padding-top: 18px; border-top: 1px solid var(--line);
  color: var(--text-muted); font-size: 12px;
}
footer.foot p { max-width: 78ch; margin: 0 0 8px; }
footer.foot strong { color: var(--text-secondary); font-weight: 600; }

/* ---- error page ---- */
.errbox { border: 1px solid var(--line-strong); border-left: 3px solid #c05b2a; border-radius: 3px;
  background: #fff; padding: 20px 22px; margin: 22px 0 8px; }
.errbox pre { margin: 12px 0 0; padding: 12px 14px; background: var(--surface-2); border-radius: 3px;
  font: 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap;
  word-break: break-word; overflow-x: auto; color: var(--text-secondary); }
.errbox ul { margin: 10px 0 0; padding-left: 20px; font-size: 13.5px; color: var(--text-secondary); }
.errbox li { margin-bottom: 6px; max-width: 68ch; }
.spinner {
  width: 13px; height: 13px; border: 2px solid rgba(255,255,255,.45); border-top-color: #fff;
  border-radius: 50%; display: none; animation: spin .7s linear infinite;
}
.btn.busy .spinner { display: inline-block; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
`;

export interface PageOptions {
  title: string;
  /** Rendered instead of the standard `.wrap` container when true. */
  bare?: boolean;
  bodyClass?: string;
  head?: string;
}

export function page(opts: PageOptions, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(opts.title)}</title>
<style>${CSS}</style>${opts.head ?? ""}
</head>
<body${opts.bodyClass ? ` class="${esc(opts.bodyClass)}"` : ""}>
${body}
</body>
</html>
`;
}

export const PRIVACY_FOOTER = `
<footer class="foot">
  <p><strong>What happens to your file.</strong> The CSV is parsed and audited in memory on this server. The
  uploaded file and every output are written to a temporary directory and <strong>deleted after 60 minutes</strong>.
  Subscriber IDs are one-way hashed the moment they are read — no raw patient identifier is retained in the report,
  the findings files, or on disk. This build has no accounts and no login: a run URL is unguessable, and that is its
  only protection. A production deployment would sit behind authentication, TLS and a signed BAA.</p>
  <p><strong>Candidate is not collectable.</strong> Every dollar this tool reports is a <em>candidate</em>: a line
  where payment does not match the rate we could establish. Turning one into a check requires reading your actual
  contract with that payer — its alternate-benefit, bundling and network-access clauses. Some findings will turn out
  to be contractually permitted; that is a finding too, because it tells you what to renegotiate.</p>
  <p>Recoup Audit · this is an analysis of your own exported data, and is not legal, coding or billing advice.</p>
</footer>`;
