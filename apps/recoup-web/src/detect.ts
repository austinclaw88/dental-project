/**
 * Column auto-detection.
 *
 * The office manager on the other end of this screen has never heard the phrase
 * "canonical field". Every dropdown we can pre-fill correctly is one fewer chance
 * to map `paid_amount` onto the write-off column and get a nonsense audit.
 *
 * Four passes, most trustworthy first. A header, once claimed, is not offered to a
 * later field — two canonical fields pointing at one column is nearly always a
 * detection mistake, and a visibly empty dropdown is far cheaper than a silent
 * wrong one.
 *
 *   1. `canonical`  — the header IS the canonical name (case/space/underscore-insensitive)
 *   2. `preset`     — a header listed by the generic / opendental / dentrix presets
 *   3. `synonym`    — the office-vernacular dictionary below ("Ins Paid", "Carrier", "DOS")
 *   4. `contains`   — a distinctive token appears inside a longer header ("Total Allowed Amt")
 *
 * Nothing here mutates the engine's own resolution: the mapping the user confirms is
 * handed back to `mapTable()` as an ordinary explicit `Mapping`, so the engine still has
 * the last word on whether the file is usable.
 */

import {
  OPTIONAL_FIELDS,
  REQUIRED_FIELDS,
  loadPreset,
  type CanonicalField,
  type Mapping,
} from "@nightshift/recoup-audit/lib";

export const ALL_FIELDS: CanonicalField[] = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];

export const FIELD_LABELS: Record<CanonicalField, string> = {
  claim_id: "Claim ID",
  service_date: "Service date",
  payer_name: "Payer / carrier",
  cdt_code: "CDT (ADA) code",
  billed_fee: "Billed fee",
  allowed_amount: "Allowed amount",
  paid_amount: "Insurance paid",
  plan_or_group: "Plan or group",
  subscriber_id: "Subscriber ID",
  tooth: "Tooth",
  patient_portion: "Patient portion",
  writeoff_amount: "Write-off",
  deductible_applied: "Deductible applied",
  adjustment_codes: "Adjustment / remark codes",
  claim_ordinal: "Primary / secondary",
  network_name: "Network",
  coverage_pct: "Coverage %",
};

/** One line of why-this-column-matters, shown under each field name. */
export const FIELD_HINTS: Record<CanonicalField, string> = {
  claim_id: "Groups the procedures that were adjudicated together.",
  service_date: "Date of service — yyyy-mm-dd or mm/dd/yyyy.",
  payer_name: "The carrier exactly as your system names it.",
  cdt_code: "One row per procedure, not per claim.",
  billed_fee: "What you billed the payer.",
  allowed_amount: "What the payer allowed. Nothing can be audited without it.",
  paid_amount: "What insurance actually paid.",
  plan_or_group: "Separates employer groups on different schedules.",
  subscriber_id: "Hashed on read — the raw value is never retained.",
  tooth: "Lets bundling findings match companion procedures.",
  patient_portion: "Recognises ordinary coinsurance and prevents false positives.",
  writeoff_amount: "Cross-checks the allowed amount.",
  deductible_applied: "Explains a gap between allowed and paid.",
  adjustment_codes: "CARC codes or remark text — the strongest false-positive guard.",
  claim_ordinal: "Marks secondary claims so they are not judged as primaries.",
  network_name: "Helps confirm leased-network repricing.",
  coverage_pct: "Recognises 0%-coverage plans.",
};

/** The four optional fields that do most of the false-positive suppression. */
export const HIGH_VALUE_OPTIONAL: CanonicalField[] = [
  "deductible_applied",
  "patient_portion",
  "adjustment_codes",
  "claim_ordinal",
];

/**
 * Office vernacular. Values are matched normalized (lowercase, punctuation and
 * whitespace stripped), so "Ins. Paid", "ins_paid" and "INS PAID" are one entry.
 */
const SYNONYMS: Record<CanonicalField, string[]> = {
  claim_id: [
    "claim", "claimno", "claim no", "claim number", "claim #", "claimnbr", "claimref",
    "claim ref", "ticket", "ticketno", "ticket no", "claimidentifier", "claim key",
    "insclaimnum", "claimguid",
  ],
  service_date: [
    "dos", "date", "date of service", "service dt", "svc date", "svcdt", "proc date",
    "procedure date", "treatment date", "date treated", "datetreated", "dateofservice",
    "procdate", "servicedt", "tx date",
  ],
  payer_name: [
    "carrier", "carrier name", "insurance", "insurance carrier", "insurance company",
    "insurance name", "payor", "payor name", "payer", "insurer", "ins carrier",
    "ins co", "insco", "ins company", "plan carrier", "primary carrier",
  ],
  cdt_code: [
    "code", "cdt", "ada", "ada code", "adacode", "proc code", "proccode",
    "procedure code", "procedurecode", "service code", "code sent", "codesent",
    "cdt code", "proc", "procedure",
  ],
  billed_fee: [
    "billed", "billed amount", "billed amt", "amount billed", "charge", "charges",
    "charge amount", "fee", "gross", "gross fee", "submitted", "submitted amount",
    "submitted charge", "proc fee", "procfee", "ucr", "ucr fee", "fee billed",
    "total charge",
  ],
  allowed_amount: [
    "allowed", "allowed amt", "allowed amount", "allowable", "allowable amount",
    "contract amount", "contracted amount", "contract rate", "contracted rate",
    "approved", "approved amount", "negotiated amount", "negotiated rate",
    "eligible amount", "eligible", "plan allowed", "insurance allowed", "max allowable",
  ],
  paid_amount: [
    "paid", "paid amount", "paid amt", "amount paid", "ins paid", "insurance paid",
    "ins payment", "insurance payment", "ins pay amt", "inspayamt", "payment",
    "payment amount", "carrier paid", "received", "benefit paid", "benefit amount",
    "check amount", "insurance portion",
  ],
  plan_or_group: [
    "group", "group num", "group number", "group name", "group plan", "plan",
    "plan name", "plan num", "employer", "employer group", "subscriber group",
  ],
  subscriber_id: [
    "subscriber", "subscriber id", "subscriber no", "member", "member id",
    "member no", "insured id", "policy id", "policy number", "policy no",
    "sub id", "subid", "cert number", "certificate number",
  ],
  tooth: ["tooth", "tooth num", "tooth number", "tooth no", "th", "tth", "tooth range", "tooth code"],
  patient_portion: [
    "patient portion", "pat portion", "patient balance", "pat bal", "patient bal",
    "patient responsibility", "patient resp", "pat resp", "patient owes",
    "patient amount", "pt portion", "pt resp",
  ],
  writeoff_amount: [
    "writeoff", "write off", "write-off", "wo", "w/o", "writeoff amount",
    "write off amount", "adjustment", "adjustment amount", "adj amount", "adj amt",
    "contractual adjustment", "contractual", "ppo adjustment", "disallowed",
    "disallowed amount",
  ],
  deductible_applied: [
    "deductible", "deductible applied", "deductible amount", "ded", "ded applied",
    "ded amt", "ded est", "dedapplied", "annual deductible",
  ],
  adjustment_codes: [
    "remarks", "remark", "remark codes", "remark code", "carc", "carc codes",
    "carc code", "adjustment reason", "adjustment reasons", "adjustment code",
    "adjustment codes", "denial reason", "denial code", "denial codes",
    "reason code", "reason codes", "reason", "eob notes", "eob remarks", "notes",
    "claim adj reason codes", "adj codes", "adj code", "rarc",
  ],
  claim_ordinal: [
    "claim type", "claimtype", "ordinal", "coverage order", "primary secondary",
    "primary/secondary", "pri sec", "ins order", "insurance order", "claim order",
    "coverage level", "insurance type", "ins type", "cob order",
  ],
  network_name: [
    "network", "network name", "ppo", "ppo network", "plan network", "leased network",
    "network id", "product network",
  ],
  coverage_pct: [
    "coverage", "coverage pct", "coverage percent", "coverage %", "cov percent",
    "cov pct", "percentage", "percent", "benefit percent", "benefit pct",
    "insurance percent", "pct covered",
  ],
};

/**
 * Distinctive tokens that may appear *inside* a longer header. Deliberately short
 * lists: a token here is a claim that no other dental export column plausibly
 * contains this substring. Run last, and only for still-unmapped fields.
 */
const CONTAINS_TOKENS: Partial<Record<CanonicalField, string[]>> = {
  claim_id: ["claimid", "claimnum", "claimnumber", "claimno"],
  service_date: ["servicedate", "dateofservice", "procdate", "proceduredate", "treatmentdate"],
  payer_name: ["carrier", "insurancecompany", "payername", "payorname"],
  cdt_code: ["cdtcode", "adacode", "proccode", "procedurecode"],
  billed_fee: ["billedamount", "amountbilled", "billedfee", "chargeamount", "submittedamount"],
  allowed_amount: ["allowedamount", "allowedamt", "allowableamount", "negotiatedamount", "contractedamount"],
  paid_amount: ["inspaid", "insurancepaid", "paidamount", "amountpaid", "inspayamt", "insurancepayment"],
  subscriber_id: ["subscriberid", "memberid", "insuredid"],
  patient_portion: ["patientportion", "patientresponsibility", "patientbalance"],
  writeoff_amount: ["writeoff", "contractualadjustment"],
  deductible_applied: ["deductibleapplied", "deductibleamount"],
  adjustment_codes: ["adjustmentreason", "remarkcode", "denialreason", "reasoncode"],
  claim_ordinal: ["claimtype", "coverageorder"],
  network_name: ["networkname", "pponetwork"],
  coverage_pct: ["coveragepercent", "coveragepct", "benefitpercent"],
};

export type DetectionBasis = "canonical" | "preset" | "synonym" | "contains" | "none";

export interface FieldDetection {
  field: CanonicalField;
  required: boolean;
  header?: string;
  basis: DetectionBasis;
  /** Which preset supplied the match, when basis === "preset". */
  presetName?: string;
}

export type Detection = Record<CanonicalField, FieldDetection>;

export function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_\-.#/()]+/g, "");
}

const PRESET_NAMES = ["generic", "opendental", "dentrix"] as const;

let presetCache: Array<{ name: string; mapping: Mapping }> | undefined;
function presets(): Array<{ name: string; mapping: Mapping }> {
  if (presetCache === undefined) {
    presetCache = PRESET_NAMES.map((name) => ({ name, mapping: loadPreset(name) }));
  }
  return presetCache;
}

function candidatesFor(mapping: Mapping, field: CanonicalField): string[] {
  const spec = mapping.columns[field];
  if (spec === undefined) return [];
  return Array.isArray(spec) ? spec : [spec];
}

/**
 * Best-effort mapping of a CSV's headers onto canonical fields.
 * Never throws; an undetectable field simply comes back with `basis: "none"`.
 */
export function autoDetect(headers: string[]): Detection {
  const byNorm = new Map<string, string>();
  for (const h of headers) {
    const n = normalizeHeader(h);
    if (n !== "" && !byNorm.has(n)) byNorm.set(n, h);
  }

  const out = Object.fromEntries(
    ALL_FIELDS.map((f) => [
      f,
      {
        field: f,
        required: (REQUIRED_FIELDS as readonly string[]).includes(f),
        basis: "none" as DetectionBasis,
      },
    ]),
  ) as Detection;

  const claimed = new Set<string>();
  const assign = (
    field: CanonicalField,
    header: string,
    basis: DetectionBasis,
    presetName?: string,
  ): void => {
    out[field].header = header;
    out[field].basis = basis;
    if (presetName !== undefined) out[field].presetName = presetName;
    claimed.add(header);
  };
  const free = (norm: string): string | undefined => {
    const h = byNorm.get(norm);
    return h !== undefined && !claimed.has(h) ? h : undefined;
  };

  // Pass 1 — the header is literally the canonical name.
  for (const field of ALL_FIELDS) {
    const hit = free(normalizeHeader(field));
    if (hit !== undefined) assign(field, hit, "canonical");
  }

  // Pass 2 — the shipped presets, in confidence order. `generic` is a no-op after
  // pass 1 but is kept in the loop so adding a preset entry is enough to change
  // behaviour here too.
  for (const { name, mapping } of presets()) {
    for (const field of ALL_FIELDS) {
      if (out[field].header !== undefined) continue;
      for (const c of candidatesFor(mapping, field)) {
        const hit = free(normalizeHeader(c));
        if (hit !== undefined) {
          assign(field, hit, "preset", name);
          break;
        }
      }
    }
  }

  // Pass 3 — office vernacular.
  for (const field of ALL_FIELDS) {
    if (out[field].header !== undefined) continue;
    for (const syn of SYNONYMS[field]) {
      const hit = free(normalizeHeader(syn));
      if (hit !== undefined) {
        assign(field, hit, "synonym");
        break;
      }
    }
  }

  // Pass 4 — distinctive token inside a longer header.
  for (const field of ALL_FIELDS) {
    if (out[field].header !== undefined) continue;
    const tokens = CONTAINS_TOKENS[field];
    if (tokens === undefined) continue;
    let done = false;
    for (const token of tokens) {
      for (const [norm, header] of byNorm) {
        if (claimed.has(header)) continue;
        if (norm.includes(token)) {
          assign(field, header, "contains");
          done = true;
          break;
        }
      }
      if (done) break;
    }
  }

  return out;
}

export function missingRequired(detection: Detection): CanonicalField[] {
  return REQUIRED_FIELDS.filter((f) => detection[f].header === undefined);
}

/** Turn a confirmed field→header selection into a Mapping the engine accepts. */
export function toMapping(
  selection: Partial<Record<CanonicalField, string>>,
  name = "web-upload",
): Mapping {
  const columns: Mapping["columns"] = {};
  for (const field of ALL_FIELDS) {
    const header = selection[field];
    if (header !== undefined && header !== "") columns[field] = header;
  }
  return { name, columns };
}

export function detectionToSelection(
  detection: Detection,
): Partial<Record<CanonicalField, string>> {
  const sel: Partial<Record<CanonicalField, string>> = {};
  for (const field of ALL_FIELDS) {
    const h = detection[field].header;
    if (h !== undefined) sel[field] = h;
  }
  return sel;
}

export const BASIS_LABEL: Record<DetectionBasis, string> = {
  canonical: "exact name",
  preset: "preset",
  synonym: "matched",
  contains: "guessed",
  none: "not found",
};

/**
 * Fee-schedule CSVs are auto-only: the engine's own parser already accepts a
 * generous set of header spellings, so all we do here is report what it will find
 * (or that it will refuse the file) before the audit runs.
 */
export const FEE_FIELD_CANDIDATES: Record<string, string[]> = {
  payer_name: ["payer_name", "payer", "carrier", "carrier_name", "insurance"],
  cdt_code: ["cdt_code", "code", "proc_code", "procedure_code", "ada_code"],
  contracted_rate: ["contracted_rate", "rate", "allowed", "allowed_amount", "fee", "contract_rate"],
  effective_from: ["effective_from", "effective_start", "start_date", "from"],
  effective_to: ["effective_to", "effective_end", "end_date", "to"],
};

export interface FeeDetection {
  field: string;
  required: boolean;
  header?: string;
}

export function autoDetectFees(headers: string[]): FeeDetection[] {
  const byNorm = new Map<string, string>();
  for (const h of headers) byNorm.set(normalizeHeader(h), h);
  return Object.entries(FEE_FIELD_CANDIDATES).map(([field, candidates]) => {
    let header: string | undefined;
    for (const c of candidates) {
      const hit = byNorm.get(normalizeHeader(c));
      if (hit !== undefined) {
        header = hit;
        break;
      }
    }
    return {
      field,
      required: ["payer_name", "cdt_code", "contracted_rate"].includes(field),
      header,
    };
  });
}
