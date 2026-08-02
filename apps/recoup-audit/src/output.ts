import { toCsv } from "./csv.js";
import { fmtMoney, fmtPct } from "./money.js";
import {
  FINDING_LABELS,
  FINDING_TYPES,
  type AuditResult,
  type Finding,
} from "./types.js";

export const FINDINGS_CSV_HEADERS = [
  "finding_id",
  "type",
  "payer_name",
  "claim_id",
  "service_date",
  "cdt_code",
  "tooth",
  "patient_hash",
  "expected_amount",
  "actual_amount",
  "delta_amount",
  "confidence",
  "rate_basis",
  "rate_support",
  "rate_mode_share",
  "evidence_rows",
  "related_rows",
  "related_codes",
  "cluster_size",
  "rate_statement",
  "why",
];

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function findingsToCsv(findings: Finding[]): string {
  return toCsv(
    FINDINGS_CSV_HEADERS,
    findings.map((f) => ({
      finding_id: f.id,
      type: f.type,
      payer_name: f.payerName,
      claim_id: f.claimId,
      service_date: f.serviceDate,
      cdt_code: f.cdtCode,
      tooth: f.tooth ?? "",
      patient_hash: f.patientHash ?? "",
      expected_amount: dollars(f.expected),
      actual_amount: dollars(f.actual),
      delta_amount: dollars(f.delta),
      confidence: f.confidence,
      rate_basis: f.evidence.rateBasis,
      rate_support: f.evidence.rateSupport ?? "",
      rate_mode_share: f.evidence.rateModeShare !== undefined ? f.evidence.rateModeShare.toFixed(3) : "",
      evidence_rows: f.evidence.rows.join(" "),
      related_rows: (f.evidence.relatedRows ?? []).join(" "),
      related_codes: (f.evidence.relatedCodes ?? []).join(" "),
      cluster_size: f.evidence.clusterSize ?? "",
      rate_statement: f.evidence.rateStatement,
      why: f.why,
    })),
  );
}

export function findingsToJson(result: AuditResult): string {
  return (
    JSON.stringify(
      {
        tool: "@nightshift/recoup-audit",
        generatedAt: result.generatedAt,
        window: result.window,
        tolerance: {
          absoluteDollars: result.tolerance.absCents / 100,
          percent: result.tolerance.pct,
          rule: "max(absolute, percent x expected) per line",
        },
        totals: {
          linesAudited: result.totals.linesAudited,
          dollarsAudited: Number(dollars(result.totals.dollarsAudited)),
          candidateUnderpayment: Number(dollars(result.totals.candidateTotal)),
          byType: Object.fromEntries(
            FINDING_TYPES.map((t) => [
              t,
              {
                count: result.totals.byType[t].count,
                dollars: Number(dollars(result.totals.byType[t].dollars)),
              },
            ]),
          ),
          byPayer: result.totals.byPayer.map((p) => ({
            payer: p.payerName,
            lines: p.lines,
            dollarsAudited: Number(dollars(p.dollarsAudited)),
            findings: p.count,
            candidateDollars: Number(dollars(p.dollars)),
          })),
        },
        coverage: result.coverage,
        unschedulable: result.unschedulable,
        findings: result.findings.map((f) => ({
          id: f.id,
          type: f.type,
          payer: f.payerName,
          claimId: f.claimId,
          serviceDate: f.serviceDate,
          cdtCode: f.cdtCode,
          tooth: f.tooth,
          patientHash: f.patientHash,
          expected: Number(dollars(f.expected)),
          actual: Number(dollars(f.actual)),
          delta: Number(dollars(f.delta)),
          confidence: f.confidence,
          why: f.why,
          evidence: f.evidence,
        })),
      },
      null,
      2,
    ) + "\n"
  );
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}
function padL(s: string, n: number): string {
  return s.length >= n ? s : " ".repeat(n - s.length) + s;
}

export function consoleSummary(result: AuditResult): string {
  const t = result.totals;
  const c = result.coverage;
  const out: string[] = [];
  const rule = (ch = "─") => ch.repeat(78);

  out.push("");
  out.push("RECOUP AUDIT — candidate underpayment summary");
  out.push(rule("="));
  out.push(
    `Claim lines audited : ${t.linesAudited.toLocaleString("en-US")}` +
      (result.excludedByWindow > 0 ? `  (${result.excludedByWindow} excluded by date window)` : ""),
  );
  out.push(`Billed dollars      : ${fmtMoney(t.dollarsAudited)}`);
  out.push(
    `Service date range  : ${result.window.minDate ?? "n/a"} to ${result.window.maxDate ?? "n/a"}`,
  );
  out.push(
    `Tolerance           : greater of ${fmtMoney(result.tolerance.absCents)} or ${fmtPct(result.tolerance.pct, 0)} per line`,
  );
  out.push("");
  out.push(`CANDIDATE UNDERPAYMENTS: ${fmtMoney(t.candidateTotal)} across ${result.findings.length} claim lines`);
  out.push("");

  out.push("By mechanism");
  out.push(rule());
  out.push(`${pad("Mechanism", 46)}${padL("Lines", 8)}${padL("Dollars", 14)}`);
  for (const type of FINDING_TYPES) {
    const row = t.byType[type];
    if (row.count === 0) continue;
    out.push(`${pad(FINDING_LABELS[type], 46)}${padL(String(row.count), 8)}${padL(fmtMoney(row.dollars), 14)}`);
  }
  out.push(`${pad("TOTAL", 46)}${padL(String(result.findings.length), 8)}${padL(fmtMoney(t.candidateTotal), 14)}`);
  out.push("");

  out.push("By payer");
  out.push(rule());
  out.push(`${pad("Payer", 34)}${padL("Lines", 8)}${padL("Billed", 14)}${padL("Findings", 10)}${padL("Candidate", 14)}`);
  for (const p of t.byPayer) {
    out.push(
      `${pad(p.payerName.slice(0, 33), 34)}${padL(String(p.lines), 8)}${padL(fmtMoney(p.dollarsAudited), 14)}` +
        `${padL(String(p.count), 10)}${padL(fmtMoney(p.dollars), 14)}`,
    );
  }
  out.push("");

  out.push("Rate coverage");
  out.push(rule());
  const pct = c.totalLines > 0 ? c.schedulableLines / c.totalLines : 0;
  out.push(
    `Lines with a usable rate : ${c.schedulableLines.toLocaleString("en-US")} of ${c.totalLines.toLocaleString("en-US")} (${fmtPct(pct, 1)})`,
  );
  out.push(
    `Payer x code pairs       : ${c.pairsSchedulable} of ${c.pairsTotal} priced ` +
      `(${c.pairsFromContract} from your fee schedule, ${c.pairsReconstructed} reconstructed from payment history)`,
  );
  if (result.unschedulable.length > 0) {
    out.push(
      `Unpriced pairs excluded  : ${result.unschedulable.length} ` +
        `(too few paid lines to establish a rate — never flagged, never guessed)`,
    );
  }
  out.push("");
  out.push(
    "Candidate is not collectable. Every line above needs a contract check before it is disputed.",
  );
  out.push("");
  return out.join("\n");
}
