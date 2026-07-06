import * as cheerio from "cheerio";
import {
  type BenefitBreakdown,
  type Confidence,
  type ExtractionProvider,
  type FieldSource,
  type FrequencyLimitation,
  type RawCapture,
  emptyBreakdown,
} from "@nightshift/schema";

/**
 * HeuristicExtractor — deterministic, dependency-free extraction of a
 * BenefitBreakdown from raw captures (default extractor for dev/tests).
 *
 * Two capture vocabularies + one transcript format are all reduced to a flat
 * list of {label, value} PAIRS, then a single keyword-driven ruleset maps pairs
 * onto canonical fields. This mirrors real portals: labels are messy
 * ("Ind. Ded. Rem.", "Max Applied YTD", "Prophy 2/CY") so we match by keyword
 * presence, never exact strings.
 *
 * Provenance: every populated field references the capture's DOM/transcript
 * artifact id + the matched label as locator. Confidence:
 *   high   — value read directly from a labelled cell/line
 *   medium — value derived (remaining = total − used) or footnote-sourced
 *   low    — inferred / left at default
 * Fields a sparse payer will not publish are returned value:null with
 * unavailableReason (PRD R8) — never silently blank.
 */
export class HeuristicExtractor implements ExtractionProvider {
  name = "heuristic";

  async extract(captures: RawCapture[], _hint: { payerKey: string }): Promise<BenefitBreakdown> {
    const b = emptyBreakdown();
    for (const cap of captures) {
      if (cap.kind === "portal_page" || cap.kind === "portal_pdf") applyPortal(b, cap);
      else if (cap.kind === "voice_transcript") applyTranscript(b, cap);
    }
    finalizeDerivations(b, captures);
    return b;
  }
}

/** Cross-field derivations run once, after all captures are folded in. */
function finalizeDerivations(b: BenefitBreakdown, captures: RawCapture[]) {
  const source = captures.length ? sourceOf(captures[0]) : "portal";
  const artifactId = captures[0]?.artifactIds[0] ?? null;
  const am = b.annualMaximum;
  if (am.remaining.value == null && am.total.value != null && am.used.value != null) {
    setFv(am.remaining, am.total.value - am.used.value, source, artifactId, "derived: total − used", "medium");
  }
  if (am.used.value == null && am.total.value != null && am.remaining.value != null) {
    setFv(am.used, am.total.value - am.remaining.value, source, artifactId, "derived: total − remaining", "medium");
  }
  const dedRem = (b as unknown as { __dedRem?: number }).__dedRem;
  const ded = b.deductible;
  if (ded.individualMet.value == null && dedRem != null && ded.individual.value != null) {
    setFv(ded.individualMet, ded.individual.value - dedRem, source, artifactId, "derived: individual − remaining", "medium");
  }
  delete (b as unknown as { __dedRem?: number }).__dedRem;
}

// ── helpers ──────────────────────────────────────────────────────────────────

interface Pair {
  label: string;
  value: string;
}

const now = () => new Date().toISOString();

function sourceOf(cap: RawCapture): FieldSource {
  return cap.kind === "voice_transcript" ? "voice_call" : "portal";
}

function setFv(
  target: { value: unknown; provenance: unknown; confidence: Confidence; unavailableReason: string | null },
  value: unknown,
  source: FieldSource,
  artifactId: string | null,
  locator: string,
  confidence: Confidence = "high",
) {
  // Do not overwrite an already high-confidence value with a weaker one.
  if (target.value != null && (target.confidence === "high" || confidence === "low")) return;
  target.value = value;
  target.confidence = confidence;
  target.unavailableReason = null;
  target.provenance = { source, artifactId, locator, retrievedAt: now() };
}

function markUnavailable(
  target: { value: unknown; provenance: unknown; confidence: Confidence; unavailableReason: string | null },
  reason: string,
) {
  if (target.value != null) return;
  target.value = null;
  target.provenance = null;
  target.confidence = "low";
  target.unavailableReason = reason;
}

function money(s: string): number | null {
  const m = s.replace(/[, $]/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}
function percent(s: string): number | null {
  if (/not covered|no coverage|n\/a|not applicable/i.test(s)) return 0;
  const m = s.match(/(\d+(\.\d+)?)\s*%/);
  if (m) return Number(m[1]);
  const n = s.match(/^\s*(\d+(\.\d+)?)\s*$/);
  return n ? Number(n[1]) : null;
}
function toIsoDate(s: string): string | null {
  const mdy = s.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  return iso ? iso[0] : null;
}
function planYear(s: string): string | null {
  if (/calendar/i.test(s)) return "calendar";
  const mmdd = s.match(/(\d{2})[-/](\d{2})/);
  return mmdd ? `${mmdd[1]}-${mmdd[2]}` : null;
}

// ── portal HTML → pairs ──────────────────────────────────────────────────────

function applyPortal(b: BenefitBreakdown, cap: RawCapture) {
  const $ = cheerio.load(cap.content);
  const source = sourceOf(cap);
  const artifactId = cap.artifactIds[0] ?? null;
  const pairs: Pair[] = [];

  $("table").each((_i, table) => {
    const rows = $(table).find("tr").toArray();
    const headerText = rows[0] ? $(rows[0]).text().toLowerCase() : "";
    const isFreqTable = /limit|frequen/.test(headerText) && /used/.test(headerText);
    if (isFreqTable) {
      const headers = $(rows[0])
        .find("th,td")
        .toArray()
        .map((c) => $(c).text().trim().toLowerCase());
      const colService = headers.findIndex((h) => /service|procedure|benefit/.test(h));
      const colLimit = headers.findIndex((h) => /limit|frequen/.test(h));
      const colUsed = headers.findIndex((h) => /used/.test(h));
      const colLast = headers.findIndex((h) => /last|date/.test(h));
      for (const r of rows.slice(1)) {
        const cells = $(r).find("td,th").toArray().map((c) => $(c).text().trim());
        if (cells.length < 2) continue;
        const freq = parseFrequency(
          cells[colService] ?? cells[0],
          cells[colLimit] ?? "",
          colUsed >= 0 ? cells[colUsed] : "",
          colLast >= 0 ? cells[colLast] : "",
          source,
          artifactId,
        );
        if (freq) upsertFrequency(b, freq);
      }
      return;
    }
    // generic 2-column table → label/value pairs
    for (const r of rows) {
      const cells = $(r).find("td,th").toArray();
      if (cells.length < 2) continue;
      const label = $(cells[0]).text().trim();
      const value = $(cells[cells.length - 1]).text().trim();
      if (label && value && label.toLowerCase() !== value.toLowerCase()) pairs.push({ label, value });
    }
  });

  // definition-list / labelled div fallback
  $("[data-field]").each((_i, el) => {
    pairs.push({ label: $(el).attr("data-field") ?? "", value: $(el).text().trim() });
  });

  for (const p of pairs) applyPair(b, p, source, artifactId);

  // Footnotes / notes (downgrades, missing-tooth, sparse markers).
  const noteText = $(".footnotes, .notes, .note, footer, p").text();
  applyNotes(b, noteText, source, artifactId);
  handleSparse(b, cap.content + " " + noteText);
}

// ── voice transcript → pairs ─────────────────────────────────────────────────

function applyTranscript(b: BenefitBreakdown, cap: RawCapture) {
  const source = sourceOf(cap);
  const artifactId = cap.artifactIds[0] ?? null;
  for (const line of cap.content.split(/\r?\n/)) {
    const m = line.match(/^\s*REP:\s*(.+)$/i);
    if (!m) continue;
    const rest = m[1];
    const idx = rest.indexOf(":");
    if (idx < 0) continue; // conversational filler, not a fact
    const label = rest.slice(0, idx).trim();
    const value = rest.slice(idx + 1).trim();
    if (!label || !value) continue;
    // frequency lines carry limit + used + last inside the value
    if (/prophy|bitewing|bwx|exam|fmx|scaling|srp|fluoride/i.test(label)) {
      const usedM = value.match(/(\d+)\s*used/i);
      const lastM = value.match(/last on\s*([\d/-]+)/i);
      const limit = value.split(",")[0];
      const freq = parseFrequency(label, limit, usedM ? usedM[1] : "", lastM ? lastM[1] : "", source, artifactId);
      if (freq) upsertFrequency(b, freq);
      continue;
    }
    applyPair(b, { label, value }, source, artifactId);
  }
}

// ── the shared keyword ruleset ───────────────────────────────────────────────

function applyPair(b: BenefitBreakdown, p: Pair, source: FieldSource, artifactId: string | null) {
  const l = p.label.toLowerCase();
  const v = p.value;
  const loc = p.label;

  // plan status
  if (/status|eligib|coverage level|active\?/.test(l) && /active|terminat|inactive|eligible|not eligible/i.test(v)) {
    const active = /active|eligible/i.test(v) && !/not|inactive|terminat/i.test(v);
    setFv(b.planStatus.active, active, source, artifactId, loc);
    const term = toIsoDate(v);
    if (/terminat/i.test(v) && term) setFv(b.planStatus.terminationDate, term, source, artifactId, loc);
    return;
  }
  if (/effective|member since|coverage begin|benefit begin/.test(l)) {
    const d = toIsoDate(v);
    if (d) setFv(b.planStatus.effectiveDate, d, source, artifactId, loc);
    return;
  }
  if (/plan year|benefit year|plan period/.test(l)) {
    const py = planYear(v);
    if (py) setFv(b.planStatus.planYearStart, py, source, artifactId, loc);
    return;
  }

  // waiting period (must precede the category rules — label may contain "major")
  if (/waiting/.test(l)) {
    const cat = /major/.test(l)
      ? "major"
      : /basic/.test(l)
        ? "basic"
        : /prevent/.test(l)
          ? "preventive"
          : /ortho/.test(l)
            ? "ortho"
            : null;
    if (cat) {
      const endsOn = toIsoDate(v);
      const months = (v.match(/(\d+)\s*month/i) ?? [])[1];
      const prov = { source, artifactId, locator: loc, retrievedAt: now() };
      b.waitingPeriods.push({
        category: cat as "preventive" | "basic" | "major" | "ortho",
        months: {
          value: months ? Number(months) : null,
          provenance: months ? prov : null,
          confidence: "high",
          unavailableReason: null,
        },
        endsOn: { value: endsOn, provenance: endsOn ? prov : null, confidence: "high", unavailableReason: null },
      });
    }
    return;
  }

  // annual maximum
  if (/max/.test(l) && /remain|left|available/.test(l)) {
    const n = money(v);
    if (n != null) setFv(b.annualMaximum.remaining, n, source, artifactId, loc);
    return;
  }
  if (/max/.test(l) && /used|applied|to date/.test(l)) {
    const n = money(v);
    if (n != null) setFv(b.annualMaximum.used, n, source, artifactId, loc);
    return;
  }
  if (/max/.test(l)) {
    const n = money(v);
    if (n != null) setFv(b.annualMaximum.total, n, source, artifactId, loc);
    return;
  }

  // deductible (order: family-met, family, ind-met, ind-remaining, applies-to, ind)
  if (/ded/.test(l) && /fam/.test(l) && /met|satisf|applied/.test(l)) {
    const n = money(v);
    if (n != null) setFv(b.deductible.familyMet, n, source, artifactId, loc);
    return;
  }
  if (/ded/.test(l) && /fam/.test(l)) {
    const n = money(v);
    if (n != null) setFv(b.deductible.family, n, source, artifactId, loc);
    return;
  }
  if (/ded/.test(l) && /appl/.test(l) && /to|categor|basic|major/.test(l + " " + v)) {
    const cats = parseCategories(v);
    if (cats.length) setFv(b.deductible.appliesTo, cats, source, artifactId, loc);
    return;
  }
  if (/ded/.test(l) && /met|satisf/.test(l)) {
    const n = money(v);
    if (n != null) setFv(b.deductible.individualMet, n, source, artifactId, loc);
    return;
  }
  if (/ded/.test(l) && /remain|left/.test(l)) {
    // remaining deductible → derive met once we know the individual amount
    const n = money(v);
    if (n != null) (b as unknown as { __dedRem?: number }).__dedRem = n;
    return;
  }
  if (/ded/.test(l)) {
    const n = money(v);
    if (n != null) setFv(b.deductible.individual, n, source, artifactId, loc);
    return;
  }

  // category coverage
  if (/prevent|diagnostic/.test(l)) return setPct(b.categoryCoverage.preventive, v, source, artifactId, loc);
  if (/\bbasic\b/.test(l)) return setPct(b.categoryCoverage.basic, v, source, artifactId, loc);
  if (/\bmajor\b/.test(l)) return setPct(b.categoryCoverage.major, v, source, artifactId, loc);
  if (/ortho/.test(l)) return setPct(b.categoryCoverage.ortho, v, source, artifactId, loc);
}

function setPct(
  target: { value: unknown; provenance: unknown; confidence: Confidence; unavailableReason: string | null },
  v: string,
  source: FieldSource,
  artifactId: string | null,
  loc: string,
) {
  const n = percent(v);
  if (n != null) setFv(target, n, source, artifactId, loc);
}

function parseCategories(v: string): string[] {
  const out: string[] = [];
  if (/prevent/i.test(v)) out.push("preventive");
  if (/basic/i.test(v)) out.push("basic");
  if (/major/i.test(v)) out.push("major");
  if (/ortho/i.test(v)) out.push("ortho");
  return out;
}

function parseFrequency(
  service: string,
  limitText: string,
  usedText: string,
  lastText: string,
  source: FieldSource,
  artifactId: string | null,
): FrequencyLimitation | null {
  const s = service.toLowerCase();
  let key: string | null = null;
  let cdt: string[] = [];
  if (/prophy/.test(s)) (key = "prophylaxis"), (cdt = ["D1110", "D1120"]);
  else if (/bitewing|bwx/.test(s)) (key = "bitewings"), (cdt = ["D0274", "D0272"]);
  else if (/fmx|full mouth/.test(s)) (key = "fmx"), (cdt = ["D0210", "D0330"]);
  else if (/exam|eval/.test(s)) (key = "exam"), (cdt = ["D0120", "D0150"]);
  else if (/srp|scaling|root plan/.test(s)) (key = "srp_per_quadrant"), (cdt = ["D4341", "D4342"]);
  else if (/fluoride/.test(s)) (key = "fluoride"), (cdt = ["D1206", "D1208"]);
  if (!key) return null;

  const usedN = usedText ? Number((usedText.match(/\d+/) ?? ["0"])[0]) : null;
  const lastIso = lastText ? toIsoDate(lastText) : null;
  const prov = { source, artifactId, locator: service, retrievedAt: now() };
  return {
    key,
    cdtCodes: cdt,
    limit: { value: limitText.trim() || null, provenance: prov, confidence: "high", unavailableReason: null },
    usedCount: {
      value: usedN,
      provenance: usedN != null ? prov : null,
      confidence: usedN != null ? "high" : "low",
      unavailableReason: null,
    },
    lastServiceDate: {
      value: lastIso,
      provenance: lastIso ? prov : null,
      confidence: lastIso ? "high" : "low",
      unavailableReason: null,
    },
    nextEligibleDate: { value: null, provenance: null, confidence: "low", unavailableReason: null },
  };
}

function upsertFrequency(b: BenefitBreakdown, freq: FrequencyLimitation) {
  const existing = b.frequencies.find((f) => f.key === freq.key);
  if (existing) Object.assign(existing, freq);
  else b.frequencies.push(freq);
}

function applyNotes(b: BenefitBreakdown, text: string, source: FieldSource, artifactId: string | null) {
  const prov = { source, artifactId, locator: "footnote", retrievedAt: now() };
  if (/posterior composit|composite.*amalgam|amalgam/i.test(text)) {
    b.downgrades.push({
      key: "posterior_composite_to_amalgam",
      description: {
        value: "Posterior composites downgraded to amalgam benefit",
        provenance: prov,
        confidence: "medium",
        unavailableReason: null,
      },
      applies: { value: true, provenance: prov, confidence: "medium", unavailableReason: null },
    });
  }
  if (/base metal|pfm.*base|crown material/i.test(text)) {
    b.downgrades.push({
      key: "crown_pfm_to_base_metal",
      description: {
        value: "Crown benefit downgraded to base metal",
        provenance: prov,
        confidence: "medium",
        unavailableReason: null,
      },
      applies: { value: true, provenance: prov, confidence: "medium", unavailableReason: null },
    });
  }
  if (/missing tooth/i.test(text)) {
    const applies = !/no missing tooth|missing tooth.*not appl/i.test(text);
    setFv(b.missingToothClause, applies, source, artifactId, "missing tooth footnote", "medium");
  }
}

/** MetLife-style sparse portal: fields the payer does not publish (PRD R8). */
function handleSparse(b: BenefitBreakdown, fullText: string) {
  if (!/not published|not available (from|via)|sparse|omit/i.test(fullText)) return;
  const reason = "not published by payer portal";
  markUnavailable(b.deductible.family, reason);
  markUnavailable(b.deductible.familyMet, reason);
  markUnavailable(b.missingToothClause, reason);
  markUnavailable(b.cobRule, reason);
  if (b.downgrades.length === 0) {
    // record that downgrade disclosure was unavailable via a note
    b.notes.push("Downgrades / missing-tooth / COB not published by payer portal.");
  }
}
