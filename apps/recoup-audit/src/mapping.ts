import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv, type CsvRow, type CsvTable } from "./csv.js";
import { parseMoney, parseMoneyRequired } from "./money.js";
import type { ClaimLine } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PRESET_DIR = resolve(HERE, "..", "presets");

export const REQUIRED_FIELDS = [
  "claim_id",
  "service_date",
  "payer_name",
  "cdt_code",
  "billed_fee",
  "allowed_amount",
  "paid_amount",
] as const;

export const OPTIONAL_FIELDS = [
  "plan_or_group",
  "subscriber_id",
  "tooth",
  "patient_portion",
  "writeoff_amount",
  "deductible_applied",
  "adjustment_codes",
  "claim_ordinal",
  "network_name",
  "coverage_pct",
] as const;

export type RequiredField = (typeof REQUIRED_FIELDS)[number];
export type OptionalField = (typeof OPTIONAL_FIELDS)[number];
export type CanonicalField = RequiredField | OptionalField;

export interface MappingOptions {
  /** Delimiter for adjustment_codes when several ride in one cell. Default: any of | ; , / */
  adjustmentCodeDelimiter?: string;
  /** Extra tokens treated as "secondary claim" in claim_ordinal. */
  secondaryOrdinalValues?: string[];
  /** Salt for the subscriber hash. Defaults to a fixed value so hashes are stable across runs. */
  hashSalt?: string;
}

export interface Mapping {
  name: string;
  notes?: string;
  /** canonical field -> source header (or list of candidate headers, first match wins). */
  columns: Partial<Record<CanonicalField, string | string[]>>;
  options?: MappingOptions;
}

export const GENERIC_MAPPING: Mapping = {
  name: "generic",
  columns: Object.fromEntries(
    [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].map((f) => [f, f]),
  ) as Mapping["columns"],
};

export function loadMappingFile(path: string): Mapping {
  const raw = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(raw));
  } catch (e) {
    throw new Error(`Mapping file ${path} is not valid JSON: ${(e as Error).message}`);
  }
  return validateMapping(parsed, path);
}

/** Presets ship with `//` comment lines so an office can annotate its own tweaks. */
export function stripJsonComments(text: string): string {
  return text
    .split("\n")
    .map((l) => (/^\s*\/\//.test(l) ? "" : l))
    .join("\n");
}

export function loadPreset(name: string): Mapping {
  const file = name.endsWith(".json") ? name : `${name}.json`;
  const path = isAbsolute(file) ? file : join(PRESET_DIR, file);
  return loadMappingFile(path);
}

/** `--map` accepts a preset name (generic|opendental|dentrix) or a path to a JSON file. */
export function resolveMapping(spec?: string): Mapping {
  if (!spec) return loadPreset("generic");
  if (["generic", "opendental", "dentrix"].includes(spec)) return loadPreset(spec);
  return loadMappingFile(spec);
}

export function validateMapping(value: unknown, source = "<inline>"): Mapping {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Mapping ${source}: expected a JSON object`);
  }
  const obj = value as Record<string, unknown>;
  const columns = obj.columns;
  if (typeof columns !== "object" || columns === null) {
    throw new Error(`Mapping ${source}: missing required "columns" object`);
  }
  const known = new Set<string>([...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]);
  const unknownKeys = Object.keys(columns).filter((k) => !known.has(k));
  if (unknownKeys.length > 0) {
    throw new Error(
      `Mapping ${source}: unknown canonical field(s) ${unknownKeys.join(", ")}. ` +
        `Valid fields: ${[...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].join(", ")}`,
    );
  }
  const missing = REQUIRED_FIELDS.filter((f) => !(f in (columns as object)));
  if (missing.length > 0) {
    throw new Error(
      `Mapping ${source}: required canonical field(s) not mapped: ${missing.join(", ")}`,
    );
  }
  return {
    name: typeof obj.name === "string" ? obj.name : source,
    notes: typeof obj.notes === "string" ? obj.notes : undefined,
    columns: columns as Mapping["columns"],
    options: (obj.options as MappingOptions | undefined) ?? undefined,
  };
}

interface ResolvedColumns {
  resolved: Partial<Record<CanonicalField, string>>;
  missingRequired: Array<{ field: CanonicalField; tried: string[] }>;
}

function resolveColumns(mapping: Mapping, headers: string[]): ResolvedColumns {
  const byLower = new Map<string, string>();
  for (const h of headers) byLower.set(normalizeHeader(h), h);

  const resolved: Partial<Record<CanonicalField, string>> = {};
  const missingRequired: Array<{ field: CanonicalField; tried: string[] }> = [];

  for (const field of [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS] as CanonicalField[]) {
    const spec = mapping.columns[field];
    if (spec === undefined) continue;
    const candidates = Array.isArray(spec) ? spec : [spec];
    let hit: string | undefined;
    for (const c of candidates) {
      const found = byLower.get(normalizeHeader(c));
      if (found !== undefined) {
        hit = found;
        break;
      }
    }
    if (hit !== undefined) {
      resolved[field] = hit;
    } else if ((REQUIRED_FIELDS as readonly string[]).includes(field)) {
      missingRequired.push({ field, tried: candidates });
    }
  }
  return { resolved, missingRequired };
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_\-.]+/g, "");
}

export function normalizePayer(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

export function normalizeCdt(code: string): string {
  const t = code.trim().toUpperCase().replace(/\s+/g, "");
  return t;
}

const DEFAULT_SALT = "recoup-audit/v1";

export function hashSubscriber(id: string, salt = DEFAULT_SALT): string {
  return createHash("sha256").update(`${salt}:${id.trim().toUpperCase()}`).digest("hex").slice(0, 10);
}

/** Parse a date cell to ISO yyyy-mm-dd. Supports ISO, US m/d/yyyy, m/d/yy, yyyy/mm/dd, and ISO datetimes. */
export function parseDate(raw: string, rowIndex: number): string {
  const s = raw.trim();
  if (s === "") throw new Error(`Row ${rowIndex}: service_date is empty`);
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]), rowIndex, s);
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/.exec(s);
  if (m) {
    let year = Number(m[3]);
    if (m[3]!.length === 2) year += year < 70 ? 2000 : 1900;
    return iso(year, Number(m[1]), Number(m[2]), rowIndex, s);
  }
  throw new Error(
    `Row ${rowIndex}: cannot parse service_date "${raw}" (expected yyyy-mm-dd or mm/dd/yyyy)`,
  );
}

function iso(y: number, mo: number, d: number, rowIndex: number, raw: string): string {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) {
    throw new Error(`Row ${rowIndex}: service_date "${raw}" is not a real date`);
  }
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const SECONDARY_TOKENS = new Set(["2", "SECONDARY", "SEC", "S", "SECOND"]);
const TERTIARY_TOKENS = new Set(["3", "TERTIARY", "TER", "T", "THIRD"]);
const PRIMARY_TOKENS = new Set(["1", "PRIMARY", "PRI", "P", "FIRST"]);

export function parseOrdinal(raw: string | undefined, extraSecondary: string[] = []): number | undefined {
  if (raw === undefined) return undefined;
  const t = raw.trim().toUpperCase();
  if (t === "") return undefined;
  if (PRIMARY_TOKENS.has(t)) return 1;
  if (SECONDARY_TOKENS.has(t) || extraSecondary.some((x) => x.toUpperCase() === t)) return 2;
  if (TERTIARY_TOKENS.has(t)) return 3;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : undefined;
}

export function parseAdjustmentCodes(raw: string | undefined, delimiter?: string): string[] {
  if (!raw || raw.trim() === "") return [];
  const parts = delimiter ? raw.split(delimiter) : raw.split(/[|;,/]+/);
  return parts.map((p) => p.trim().toUpperCase()).filter((p) => p !== "");
}

export interface MapResult {
  lines: ClaimLine[];
  /** Rows we could not map, with the reason. Surfaced, never silently dropped. */
  rejected: Array<{ rowIndex: number; reason: string }>;
  resolvedColumns: Partial<Record<CanonicalField, string>>;
  optionalPresent: OptionalField[];
}

export function mapTable(table: CsvTable, mapping: Mapping): MapResult {
  if (table.headers.length === 0) {
    throw new Error("Claims CSV is empty (no header row found)");
  }
  const { resolved, missingRequired } = resolveColumns(mapping, table.headers);
  if (missingRequired.length > 0) {
    const detail = missingRequired
      .map((m) => `  - ${m.field}: looked for [${m.tried.join(", ")}]`)
      .join("\n");
    throw new Error(
      `Claims CSV is missing ${missingRequired.length} required column(s) under mapping "${mapping.name}":\n` +
        `${detail}\n` +
        `CSV headers present: [${table.headers.join(", ")}]\n` +
        `Fix by editing your --map JSON so each canonical field points at the right header.`,
    );
  }

  const opts = mapping.options ?? {};
  const lines: ClaimLine[] = [];
  const rejected: Array<{ rowIndex: number; reason: string }> = [];

  const get = (row: CsvRow, field: CanonicalField): string | undefined => {
    const col = resolved[field];
    if (col === undefined) return undefined;
    const v = row[col];
    return v === undefined || v === "" ? undefined : v;
  };

  for (let i = 0; i < table.rows.length; i++) {
    const row = table.rows[i]!;
    const rowIndex = i + 1;
    try {
      const cdt = normalizeCdt(get(row, "cdt_code") ?? "");
      if (cdt === "") throw new Error(`Row ${rowIndex}: cdt_code is empty`);
      const payerName = (get(row, "payer_name") ?? "").trim();
      if (payerName === "") throw new Error(`Row ${rowIndex}: payer_name is empty`);
      const subscriber = get(row, "subscriber_id");
      const coverageRaw = get(row, "coverage_pct");
      let coveragePct: number | undefined;
      if (coverageRaw !== undefined) {
        const n = Number(coverageRaw.replace("%", "").trim());
        if (Number.isFinite(n)) coveragePct = n <= 1 && n > 0 ? n * 100 : n;
      }
      lines.push({
        rowIndex,
        claimId: (get(row, "claim_id") ?? "").trim(),
        serviceDate: parseDate(get(row, "service_date") ?? "", rowIndex),
        payerName,
        payerKey: normalizePayer(payerName),
        cdtCode: cdt,
        billed: parseMoneyRequired(get(row, "billed_fee"), "billed_fee", rowIndex),
        allowed: parseMoneyRequired(get(row, "allowed_amount"), "allowed_amount", rowIndex),
        paid: parseMoneyRequired(get(row, "paid_amount"), "paid_amount", rowIndex),
        planOrGroup: get(row, "plan_or_group"),
        patientHash: subscriber ? hashSubscriber(subscriber, opts.hashSalt) : undefined,
        tooth: get(row, "tooth")?.trim(),
        patientPortion: parseMoney(get(row, "patient_portion"), "patient_portion") ?? undefined,
        writeoff: parseMoney(get(row, "writeoff_amount"), "writeoff_amount") ?? undefined,
        deductibleApplied:
          parseMoney(get(row, "deductible_applied"), "deductible_applied") ?? undefined,
        adjustmentCodes: parseAdjustmentCodes(
          get(row, "adjustment_codes"),
          opts.adjustmentCodeDelimiter,
        ),
        claimOrdinal: parseOrdinal(get(row, "claim_ordinal"), opts.secondaryOrdinalValues),
        networkName: get(row, "network_name"),
        coveragePct,
      });
    } catch (e) {
      rejected.push({ rowIndex, reason: (e as Error).message });
    }
  }

  const optionalPresent = OPTIONAL_FIELDS.filter((f) => resolved[f] !== undefined);
  return { lines, rejected, resolvedColumns: resolved, optionalPresent };
}

export function loadClaims(path: string, mapping: Mapping): MapResult {
  return mapTable(parseCsv(readFileSync(path, "utf8")), mapping);
}
