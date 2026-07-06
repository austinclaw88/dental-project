import type { BenefitBreakdown } from "@nightshift/schema";
import type { ComputedException } from "./exceptions.js";

export interface WritebackContext {
  odPlanNum: number;
  odInsSubNum: number;
  odPatNum: number;
  carrierName: string;
  scope: string;
  verifiedAt: string;
}

export interface WritebackRow {
  target: "insverify" | "insplan_note" | "benefit_rows" | "commlog" | "document_pdf";
  payload: Record<string, unknown>;
}

const money = (n: number | null | undefined) => (n == null ? "—" : `$${n}`);
const pct = (n: number | null | undefined) => (n == null ? "—" : `${n}%`);
const confMark = (c: string) => (c === "high" ? "" : c === "medium" ? " (~)" : " (?)");

/**
 * benefit_rows CDT-range mapping (documented in README). Derived from
 * categoryCoverage percentages; ranges follow OpenDental benefit-row conventions:
 *   preventive D0100–D1999 | basic D2000–D2699,D3000–D3999,D4000–D4999,D7000–D7999
 *   major D2700–D2999,D5000–D5899,D6000–D6999 | ortho D8000–D8999
 * Only rows whose percent is known are emitted; agent-tagged so the connector
 * never overwrites human rows (entry_source='nightshift').
 */
const RANGE_MAP: Array<{ category: "preventive" | "basic" | "major" | "ortho"; from: string; to: string }> = [
  { category: "preventive", from: "D0100", to: "D1999" },
  { category: "basic", from: "D2000", to: "D2699" },
  { category: "basic", from: "D3000", to: "D3999" },
  { category: "basic", from: "D4000", to: "D4999" },
  { category: "basic", from: "D7000", to: "D7999" },
  { category: "major", from: "D2700", to: "D2999" },
  { category: "major", from: "D5000", to: "D5899" },
  { category: "major", from: "D6000", to: "D6999" },
  { category: "ortho", from: "D8000", to: "D8999" },
];

export function buildBenefitRows(b: BenefitBreakdown, ctx: WritebackContext): WritebackRow {
  const rows = RANGE_MAP.map((r) => {
    const percent = b.categoryCoverage[r.category].value;
    return percent == null ? null : { cdtFrom: r.from, cdtTo: r.to, percent, category: r.category };
  }).filter((r): r is NonNullable<typeof r> => r !== null);
  return { target: "benefit_rows", payload: { odPlanNum: ctx.odPlanNum, rows } };
}

export function compactSummary(b: BenefitBreakdown, exceptions: ComputedException[]): string {
  const parts: string[] = [];
  parts.push(
    `Max ${money(b.annualMaximum.total.value)} (rem ${money(b.annualMaximum.remaining.value)})`,
    `Ded ${money(b.deductible.individual.value)} ind / met ${money(b.deductible.individualMet.value)}`,
    `Prev ${pct(b.categoryCoverage.preventive.value)} / Basic ${pct(b.categoryCoverage.basic.value)} / ` +
      `Major ${pct(b.categoryCoverage.major.value)} / Ortho ${pct(b.categoryCoverage.ortho.value)}`,
  );
  if (exceptions.length) parts.push("Flags: " + exceptions.map((e) => e.type).join(", "));
  return "NightShift verified. " + parts.join(" | ");
}

export function renderBreakdownText(b: BenefitBreakdown, ctx: WritebackContext, exceptions: ComputedException[]): string {
  const L: string[] = [];
  L.push(`INSURANCE BENEFITS BREAKDOWN — ${ctx.carrierName}`);
  L.push(`Verified by NightShift ${ctx.verifiedAt} (scope: ${ctx.scope})`);
  L.push(`Confidence markers: (~) medium, (?) low/inferred; blank = high.`);
  L.push("");
  L.push("PLAN STATUS");
  L.push(`  Active: ${b.planStatus.active.value ?? "—"}${confMark(b.planStatus.active.confidence)}`);
  L.push(`  Effective: ${b.planStatus.effectiveDate.value ?? "—"}   Plan year: ${b.planStatus.planYearStart.value ?? "—"}`);
  L.push("");
  L.push("ANNUAL MAXIMUM");
  L.push(
    `  Total ${money(b.annualMaximum.total.value)}${confMark(b.annualMaximum.total.confidence)}   ` +
      `Used ${money(b.annualMaximum.used.value)}   Remaining ${money(b.annualMaximum.remaining.value)}${confMark(b.annualMaximum.remaining.confidence)}`,
  );
  L.push("");
  L.push("DEDUCTIBLE");
  L.push(
    `  Individual ${money(b.deductible.individual.value)} (met ${money(b.deductible.individualMet.value)})   ` +
      `Family ${money(b.deductible.family.value)}${b.deductible.family.unavailableReason ? " [" + b.deductible.family.unavailableReason + "]" : ""}`,
  );
  L.push("");
  L.push("COVERAGE BY CATEGORY");
  L.push(
    `  Preventive ${pct(b.categoryCoverage.preventive.value)}   Basic ${pct(b.categoryCoverage.basic.value)}   ` +
      `Major ${pct(b.categoryCoverage.major.value)}   Ortho ${pct(b.categoryCoverage.ortho.value)}`,
  );
  if (b.frequencies.length) {
    L.push("");
    L.push("FREQUENCIES");
    for (const f of b.frequencies) {
      L.push(
        `  ${f.key}: ${f.limit.value ?? "—"} (used ${f.usedCount.value ?? "—"}${f.lastServiceDate.value ? ", last " + f.lastServiceDate.value : ""})`,
      );
    }
  }
  if (b.downgrades.length) {
    L.push("");
    L.push("DOWNGRADES");
    for (const d of b.downgrades) L.push(`  ${d.key}: ${d.description.value ?? ""}${confMark(d.description.confidence)}`);
  }
  if (exceptions.length) {
    L.push("");
    L.push("ATTENTION (today's visit)");
    for (const e of exceptions) L.push(`  [${e.severity}] ${e.message}`);
  }
  for (const n of b.notes) L.push(`  note: ${n}`);
  return L.join("\n");
}

/** Build all writeback rows for a successful full verification. */
export function buildWritebackRows(
  b: BenefitBreakdown,
  ctx: WritebackContext,
  exceptions: ComputedException[],
): WritebackRow[] {
  const rows: WritebackRow[] = [];
  rows.push({
    target: "insverify",
    payload: { odPlanNum: ctx.odPlanNum, odInsSubNum: ctx.odInsSubNum, verifiedAt: ctx.verifiedAt, scope: ctx.scope },
  });
  rows.push({ target: "insplan_note", payload: { odPlanNum: ctx.odPlanNum, note: compactSummary(b, exceptions) } });
  rows.push(buildBenefitRows(b, ctx));
  rows.push({
    target: "commlog",
    payload: { odPatNum: ctx.odPatNum, text: "Insurance verified via NightShift — see plan note." },
  });
  rows.push({
    target: "document_pdf",
    payload: {
      odPatNum: ctx.odPatNum,
      title: `Benefits breakdown ${ctx.carrierName} ${ctx.verifiedAt.slice(0, 10)}`,
      text: renderBreakdownText(b, ctx, exceptions),
    },
  });
  return rows;
}
