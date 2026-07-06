import type { MemberView } from "./data.js";

/**
 * Server-rendered HTML for the two mock payer portals. The two payers are
 * deliberately DIFFERENT in structure, labels and styling so the extraction
 * pipeline is exercised against realistic layout drift:
 *
 *  - mock-delta  : dense blue "legacy" table portal, terse abbreviations,
 *                  frequency used-counts + last-service dates, downgrade
 *                  footnotes, missing-tooth clause, COB, history page.
 *  - mock-metlife: sparse teal "modern card" portal using MetLife-style
 *                  Type I/II/III class language. Omits frequency used-counts,
 *                  history, downgrades, missing-tooth and COB (sparse payer).
 *
 * See README for the exact label vocabulary the extractor keys off.
 */

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function usDate(iso: string | null): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

// ---------------------------------------------------------------------------
// shared shell
// ---------------------------------------------------------------------------

const DELTA_CSS = `
  body{font-family:Verdana,Geneva,sans-serif;font-size:12px;color:#152238;background:#eef1f6;margin:0}
  .wrap{max-width:920px;margin:0 auto;padding:16px}
  .brandbar{background:#003a70;color:#fff;padding:10px 16px;border-bottom:4px solid #f2a900}
  .brandbar b{font-size:16px;letter-spacing:.5px}
  a{color:#00539b}
  h1{font-size:15px;margin:12px 0 4px}
  h2{font-size:13px;background:#d5deeb;padding:4px 6px;margin:16px 0 4px;border-left:4px solid #003a70}
  table.grid{border-collapse:collapse;width:100%;margin:4px 0}
  table.grid th,table.grid td{border:1px solid #9fb2c9;padding:3px 6px;text-align:left;vertical-align:top}
  table.grid th{background:#c3d0e2;font-weight:bold}
  .kv{border-collapse:collapse}
  .kv td{padding:2px 10px 2px 0}
  .kv td.k{color:#4a5b73;white-space:nowrap}
  .banner-ok{background:#e4f2e0;border:1px solid #4a8a3c;color:#2f6d23;padding:6px 10px;font-weight:bold}
  .banner-term{background:#fbe3e3;border:1px solid #b12a2a;color:#a01010;padding:6px 10px;font-weight:bold}
  .fn{color:#6a3a00;font-size:11px;margin-top:6px}
  .muted{color:#7a8aa0}
  form.login{background:#fff;border:1px solid #9fb2c9;padding:16px;max-width:320px}
  input[type=text],input[type=password]{width:100%;padding:5px;margin:3px 0 10px;box-sizing:border-box;border:1px solid #9fb2c9}
  button{background:#003a70;color:#fff;border:0;padding:7px 14px;cursor:pointer}
  .err{background:#fbe3e3;border:1px solid #b12a2a;color:#a01010;padding:8px;margin-bottom:10px}
`;

const METLIFE_CSS = `
  body{font-family:'Segoe UI',Arial,sans-serif;font-size:14px;color:#20303a;background:#f4f8f8;margin:0}
  .wrap{max-width:760px;margin:0 auto;padding:20px}
  .brandbar{background:#0a7d6b;color:#fff;padding:14px 20px}
  .brandbar b{font-size:20px}
  a{color:#0a7d6b}
  h1{font-size:18px;margin:16px 0 2px;font-weight:600}
  h2{font-size:14px;color:#0a7d6b;text-transform:uppercase;letter-spacing:1px;margin:22px 0 8px}
  .card{background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.12);padding:16px 18px;margin:10px 0}
  .dl{display:grid;grid-template-columns:200px 1fr;row-gap:6px}
  .dl dt{color:#5a6b73}
  .dl dd{margin:0;font-weight:600}
  .cls{display:flex;gap:10px;flex-wrap:wrap}
  .cls .chip{background:#e6f3f0;border:1px solid #bcdcd4;border-radius:6px;padding:8px 12px;min-width:120px}
  .cls .chip .pct{font-size:20px;font-weight:700;color:#0a7d6b}
  .pill-ok{display:inline-block;background:#e6f3f0;color:#0a7d6b;border-radius:12px;padding:3px 12px;font-weight:600}
  .pill-term{display:inline-block;background:#fce4e4;color:#b12a2a;border-radius:12px;padding:3px 12px;font-weight:600}
  form.login{background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.12);padding:20px;max-width:340px}
  input[type=text],input[type=password]{width:100%;padding:8px;margin:4px 0 12px;box-sizing:border-box;border:1px solid #bcd;border-radius:4px}
  button{background:#0a7d6b;color:#fff;border:0;padding:9px 16px;border-radius:4px;cursor:pointer;font-size:14px}
  .err{background:#fce4e4;color:#b12a2a;padding:10px;border-radius:4px;margin-bottom:12px}
  .muted{color:#8899a0}
`;

interface Brand {
  key: string;
  title: string;
  css: string;
}

const BRANDS: Record<string, Brand> = {
  "mock-delta": { key: "mock-delta", title: "Delta Dental MockState — Provider Portal", css: DELTA_CSS },
  "mock-metlife": { key: "mock-metlife", title: "MetLife Mock — Dental eServices", css: METLIFE_CSS },
};

function shell(payerKey: string, body: string): string {
  const b = BRANDS[payerKey];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(b.title)}</title><style>${b.css}</style></head>
<body><div class="brandbar"><b>${esc(b.title)}</b></div><div class="wrap">${body}</div></body></html>`;
}

// ---------------------------------------------------------------------------
// login
// ---------------------------------------------------------------------------

export function renderLogin(payerKey: string, opts: { error?: string } = {}): string {
  const err = opts.error ? `<div class="err">${esc(opts.error)}</div>` : "";
  const body = `
    <h1>Provider / Office Sign In</h1>
    ${err}
    <form class="login" method="post" action="/${esc(payerKey)}/login">
      <label>Username / Office ID</label>
      <input type="text" name="username" autocomplete="username">
      <label>Password</label>
      <input type="password" name="password" autocomplete="current-password">
      <button type="submit">Sign In</button>
    </form>
    <p class="muted">Authorized dental office use only.</p>`;
  return shell(payerKey, body);
}

// ---------------------------------------------------------------------------
// member search
// ---------------------------------------------------------------------------

export function renderSearch(
  payerKey: string,
  opts: { subscriberId?: string; member?: MemberView | null } = {},
): string {
  const q = opts.subscriberId ?? "";
  let results = "";
  if (opts.subscriberId != null) {
    if (opts.member) {
      const m = opts.member;
      results = `
        <h2>Search Results</h2>
        <table class="grid">
          <tr><th>Subscriber ID</th><th>Member</th><th>Group</th><th>Plan</th><th></th></tr>
          <tr>
            <td>${esc(m.subscriberId)}</td>
            <td>${esc(m.patientName)}</td>
            <td>${esc(m.groupNumber)}</td>
            <td>${esc(m.employer)}</td>
            <td><a href="/${esc(payerKey)}/member/${esc(m.subscriberId)}/benefits">View Benefits &raquo;</a></td>
          </tr>
        </table>`;
    } else {
      results = `<h2>Search Results</h2><p class="err">No member found for &quot;${esc(q)}&quot;.</p>`;
    }
  }
  const body = `
    <h1>Member Eligibility Search</h1>
    <form method="get" action="/${esc(payerKey)}/members">
      <label>Subscriber ID</label>
      <input type="text" name="subscriberId" value="${esc(q)}" style="max-width:220px">
      <button type="submit">Search</button>
    </form>
    ${results}`;
  return shell(payerKey, body);
}

// ---------------------------------------------------------------------------
// benefits — DELTA (dense, rich)
// ---------------------------------------------------------------------------

function deltaBenefits(m: MemberView): string {
  const banner = m.active
    ? `<div class="banner-ok" data-field="eligibility.status">Eligibility Status: ACTIVE</div>`
    : `<div class="banner-term" data-field="eligibility.status">Eligibility Status: TERMINATED eff ${usDate(
        m.terminationDate,
      )}</div>`;

  const covRows = [
    ["Preventive &amp; Diagnostic", m.coverage.preventive],
    ["Basic Restorative", m.coverage.basic],
    ["Major Restorative", m.coverage.major],
    ["Orthodontia", m.coverage.ortho],
  ]
    .map(([label, pct]) => `<tr><td>${label}</td><td>${pct}%</td></tr>`)
    .join("");

  const freqRows = m.frequencies
    .map((f) => {
      const used =
        f.usedCount == null ? "—" : `Used ${f.usedCount}`;
      const last = f.lastServiceDate ? ` (last ${usDate(f.lastServiceDate)})` : "";
      return `<tr><td>${esc(f.label)} (${esc(f.cdt)})</td><td>${esc(f.terse)}</td><td>${used}${last}</td></tr>`;
    })
    .join("");

  const waitRows = m.waitingPeriods.length
    ? m.waitingPeriods
        .map(
          (w) =>
            `<tr><td>${esc(w.category[0].toUpperCase() + w.category.slice(1))}</td><td>${w.months} mo waiting period, member effective ${usDate(
              w.effective,
            )} (eligible ${usDate(w.endsOn)})</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="2" class="muted">None on file</td></tr>`;

  // Downgrade footnotes.
  const dgText: Record<string, string> = {
    posterior_composite_to_amalgam: "Posterior composites paid at amalgam rate",
    crown_pfm_to_base_metal: "PFM crowns paid at base-metal rate",
  };
  const footnotes = m.downgrades
    .map((d, i) => `<div class="fn">${"†".repeat(i + 1)} ${esc(dgText[d] ?? d)}</div>`)
    .join("");
  const majorMark = m.downgrades.includes("crown_pfm_to_base_metal") ? "†" : "";

  const fedMet = m.dedFamily != null ? "—" : "n/a";

  const body = `
    ${banner}
    <h1>Benefits &amp; Eligibility — ${esc(m.patientName)}</h1>
    <table class="kv">
      <tr><td class="k">Subscriber ID</td><td>${esc(m.subscriberId)}</td>
          <td class="k">Group</td><td>${esc(m.groupNumber)} — ${esc(m.employer)}</td></tr>
      <tr><td class="k">Member</td><td>${esc(m.patientName)} (${esc(m.relationship)})</td>
          <td class="k">DOB</td><td>${usDate(m.birthdate)}</td></tr>
      <tr><td class="k">Eff. Date</td><td>${usDate(m.effectiveDate)}</td>
          <td class="k">Term Date</td><td>${m.terminationDate ? usDate(m.terminationDate) : "—"}</td></tr>
      <tr><td class="k">Benefit Yr</td><td>${esc(
        m.planYearStart === "calendar" ? "Calendar Yr" : m.planYearStart,
      )}</td><td class="k"></td><td></td></tr>
    </table>

    <h2>Maximums &amp; Deductibles</h2>
    <table class="grid">
      <tr><th>Cal Yr Max</th><th>Max Used YTD</th><th>Max Remaining</th>
          <th>Ind. Ded.</th><th>Ind. Ded. Met</th><th>Ind. Ded. Rem.</th>
          <th>Fam. Ded.</th><th>Fam. Ded. Met</th></tr>
      <tr>
        <td>$${m.annualMax.toFixed(2)}</td>
        <td>$${m.maxUsed.toFixed(2)}</td>
        <td>$${m.maxRemaining.toFixed(2)}</td>
        <td>$${m.dedIndividual.toFixed(2)}</td>
        <td>$${m.dedIndividualMet.toFixed(2)}</td>
        <td>$${Math.max(0, m.dedIndividual - m.dedIndividualMet).toFixed(2)}</td>
        <td>${m.dedFamily != null ? "$" + m.dedFamily.toFixed(2) : "—"}</td>
        <td>${fedMet}</td>
      </tr>
    </table>
    <div class="muted">Deductible applies to: ${esc(m.dedAppliesTo.join(", "))}</div>

    <h2>Coverage by Category</h2>
    <table class="grid" style="max-width:340px">
      <tr><th>Category</th><th>Plan Pays</th></tr>
      ${covRows.replace("Major Restorative", "Major Restorative" + majorMark)}
    </table>

    <h2>Frequencies &amp; Utilization</h2>
    <table class="grid">
      <tr><th>Service</th><th>Limit</th><th>History</th></tr>
      ${freqRows}
    </table>

    <h2>Waiting Periods</h2>
    <table class="grid"><tr><th>Category</th><th>Detail</th></tr>${waitRows}</table>

    <h2>Plan Provisions</h2>
    <table class="kv">
      <tr><td class="k">Missing Tooth Clause</td><td>${
        m.missingToothClause == null ? "—" : m.missingToothClause ? "Yes — applies" : "No"
      }</td></tr>
      <tr><td class="k">Coordination of Benefits (COB)</td><td>${esc(
        m.cobRule ? cobLabel(m.cobRule) : "—",
      )}</td></tr>
      <tr><td class="k">Assignment of Benefits</td><td>Accepted</td></tr>
    </table>
    ${footnotes}

    <p style="margin-top:14px"><a href="/${esc(m.payerKey)}/member/${esc(
      m.subscriberId,
    )}/history">Service History &raquo;</a> &nbsp; | &nbsp;
    <a href="/${esc(m.payerKey)}/members?subscriberId=${esc(m.subscriberId)}">Back to search</a></p>`;
  return shell(m.payerKey, body);
}

function cobLabel(rule: string): string {
  if (rule === "non_duplication") return "Non-Duplication";
  if (rule === "maintenance_of_benefits") return "Maintenance of Benefits";
  return "Standard";
}

// ---------------------------------------------------------------------------
// benefits — METLIFE (sparse, modern cards, Type I/II/III language)
// ---------------------------------------------------------------------------

function metlifeBenefits(m: MemberView): string {
  const status = m.active
    ? `<span class="pill-ok">Coverage: Active</span>`
    : `<span class="pill-term">Coverage: Terminated ${usDate(m.terminationDate)}</span>`;

  const classes = [
    ["Type I — Preventive", m.coverage.preventive],
    ["Type II — Basic", m.coverage.basic],
    ["Type III — Major", m.coverage.major],
    ["Type IV — Orthodontia", m.coverage.ortho],
  ]
    .map(
      ([label, pct]) =>
        `<div class="chip"><div class="muted">${label}</div><div class="pct">${pct}%</div></div>`,
    )
    .join("");

  // Sparse: limits only, no used-counts / last dates.
  const freq = m.frequencies.length
    ? m.frequencies
        .map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(f.limit)}</dd>`)
        .join("")
    : `<dt class="muted">No frequency data</dt><dd>—</dd>`;

  const body = `
    <h1>Eligibility &amp; Plan Benefits</h1>
    <div class="card">
      <div class="dl">
        <dt>Status</dt><dd>${status}</dd>
        <dt>Member</dt><dd>${esc(m.patientName)}</dd>
        <dt>Subscriber ID</dt><dd>${esc(m.subscriberId)}</dd>
        <dt>Group</dt><dd>${esc(m.groupNumber)} — ${esc(m.employer)}</dd>
        <dt>Effective Date</dt><dd>${usDate(m.effectiveDate)}</dd>
      </div>
    </div>

    <h2>Plan Maximum &amp; Deductible</h2>
    <div class="card">
      <div class="dl">
        <dt>Annual Benefit Maximum</dt><dd>$${m.annualMax.toFixed(0)}</dd>
        <dt>Benefits Used</dt><dd>$${m.maxUsed.toFixed(0)}</dd>
        <dt>Remaining Maximum</dt><dd>$${m.maxRemaining.toFixed(0)}</dd>
        <dt>Deductible (Individual)</dt><dd>$${m.dedIndividual.toFixed(0)}</dd>
        <dt>Deductible Met</dt><dd>$${m.dedIndividualMet.toFixed(0)}</dd>
      </div>
    </div>

    <h2>Coverage Classes</h2>
    <div class="card"><div class="cls">${classes}</div></div>

    <h2>Frequency Limitations</h2>
    <div class="card"><div class="dl">${freq}</div></div>

    <p class="muted" style="margin-top:16px">Service history, downgrade, missing-tooth and COB
    details are not available through this portal — contact the plan for additional information.</p>
    <p style="margin-top:8px"><a href="/${esc(m.payerKey)}/members?subscriberId=${esc(
      m.subscriberId,
    )}">Back to search</a></p>`;
  return shell(m.payerKey, body);
}

export function renderBenefits(m: MemberView): string {
  return m.payerKey === "mock-delta" ? deltaBenefits(m) : metlifeBenefits(m);
}

// ---------------------------------------------------------------------------
// history — DELTA only
// ---------------------------------------------------------------------------

export function renderHistory(m: MemberView): string {
  const rows: string[] = [];
  for (const f of m.frequencies) {
    if (f.usedCount == null) continue;
    rows.push(
      `<tr><td>${esc(f.cdt)}</td><td>${esc(f.label)}</td><td>${f.usedCount}</td><td>${
        f.lastServiceDate ? usDate(f.lastServiceDate) : "—"
      }</td></tr>`,
    );
  }
  const body = `
    <h1>Service History — ${esc(m.patientName)}</h1>
    <table class="kv">
      <tr><td class="k">Subscriber ID</td><td>${esc(m.subscriberId)}</td>
          <td class="k">Group</td><td>${esc(m.groupNumber)}</td></tr>
    </table>
    <h2>Utilization on File</h2>
    <table class="grid">
      <tr><th>CDT</th><th>Service</th><th>Used (this benefit yr)</th><th>Last Service Date</th></tr>
      ${rows.join("") || `<tr><td colspan="4" class="muted">No history on file</td></tr>`}
    </table>
    <p style="margin-top:12px"><a href="/${esc(m.payerKey)}/member/${esc(
      m.subscriberId,
    )}/benefits">&laquo; Back to benefits</a></p>`;
  return shell(m.payerKey, body);
}

export function renderError(payerKey: string, code: number, message: string): string {
  return shell(BRANDS[payerKey] ? payerKey : "mock-delta", `<h1>${code}</h1><p>${esc(message)}</p>`);
}
