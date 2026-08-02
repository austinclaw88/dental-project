import { describe, expect, it } from "vitest";
import { REQUIRED_FIELDS } from "@nightshift/recoup-audit/lib";
import { autoDetect, autoDetectFees, missingRequired, toMapping } from "../src/detect.js";

const OPENDENTAL_HEADERS = [
  "ClaimNum",
  "ProcDate",
  "CarrierName",
  "ProcCode",
  "FeeBilled",
  "AllowedAmt",
  "InsPayAmt",
  "GroupNum",
  "SubscriberID",
  "ToothNum",
  "DedApplied",
  "WriteOff",
  "Remarks",
  "ClaimType",
  "Percentage",
];

const DENTRIX_HEADERS = [
  "Claim #",
  "Procedure Date",
  "Insurance Carrier",
  "Procedure Code",
  "Charge",
  "Allowed Amount",
  "Insurance Paid",
  "Group Plan",
  "Subscriber ID",
  "Tooth",
  "Deductible",
  "Write-Off",
  "Remarks",
  "Claim Type",
];

describe("autoDetect — presets", () => {
  it("maps every required field from Open Dental headers", () => {
    const d = autoDetect(OPENDENTAL_HEADERS);
    expect(missingRequired(d)).toEqual([]);
    expect(d.claim_id.header).toBe("ClaimNum");
    expect(d.service_date.header).toBe("ProcDate");
    expect(d.payer_name.header).toBe("CarrierName");
    expect(d.cdt_code.header).toBe("ProcCode");
    expect(d.billed_fee.header).toBe("FeeBilled");
    expect(d.allowed_amount.header).toBe("AllowedAmt");
    expect(d.paid_amount.header).toBe("InsPayAmt");
    expect(d.paid_amount.basis).toBe("preset");
    expect(d.paid_amount.presetName).toBe("opendental");
  });

  it("picks up the Open Dental optional guard columns too", () => {
    const d = autoDetect(OPENDENTAL_HEADERS);
    expect(d.deductible_applied.header).toBe("DedApplied");
    expect(d.adjustment_codes.header).toBe("Remarks");
    expect(d.claim_ordinal.header).toBe("ClaimType");
    expect(d.subscriber_id.header).toBe("SubscriberID");
    expect(d.coverage_pct.header).toBe("Percentage");
  });

  it("maps every required field from Dentrix headers", () => {
    const d = autoDetect(DENTRIX_HEADERS);
    expect(missingRequired(d)).toEqual([]);
    expect(d.claim_id.header).toBe("Claim #");
    expect(d.payer_name.header).toBe("Insurance Carrier");
    expect(d.billed_fee.header).toBe("Charge");
    expect(d.paid_amount.header).toBe("Insurance Paid");
  });

  it("recognises canonical headers exactly, and says so", () => {
    const d = autoDetect([...REQUIRED_FIELDS]);
    expect(missingRequired(d)).toEqual([]);
    for (const f of REQUIRED_FIELDS) expect(d[f].basis).toBe("canonical");
  });

  it("ignores case, spaces, underscores and dashes in canonical headers", () => {
    const d = autoDetect([
      "Claim ID",
      "Service-Date",
      "PAYER NAME",
      "cdt_code",
      "Billed Fee",
      "allowed amount",
      "Paid_Amount",
    ]);
    expect(missingRequired(d)).toEqual([]);
    expect(d.payer_name.header).toBe("PAYER NAME");
  });
});

describe("autoDetect — fuzzy synonyms", () => {
  it("maps office vernacular onto canonical fields", () => {
    const d = autoDetect([
      "Ticket No",
      "DOS",
      "Carrier",
      "Proc Code",
      "Gross",
      "Allowed",
      "Ins Paid",
    ]);
    expect(missingRequired(d)).toEqual([]);
    expect(d.claim_id.header).toBe("Ticket No");
    expect(d.service_date.header).toBe("DOS");
    expect(d.payer_name.header).toBe("Carrier");
    expect(d.cdt_code.header).toBe("Proc Code");
    expect(d.billed_fee.header).toBe("Gross");
    expect(d.allowed_amount.header).toBe("Allowed");
    expect(d.paid_amount.header).toBe("Ins Paid");
  });

  it("maps 'ADA Code' to cdt_code and 'Insurance Payment' to paid_amount", () => {
    const d = autoDetect([
      "Claim Number",
      "Date of Service",
      "Insurance Company",
      "ADA Code",
      "Submitted Amount",
      "Negotiated Amount",
      "Insurance Payment",
    ]);
    expect(missingRequired(d)).toEqual([]);
    expect(d.cdt_code.header).toBe("ADA Code");
    expect(d.allowed_amount.header).toBe("Negotiated Amount");
    expect(d.paid_amount.header).toBe("Insurance Payment");
  });

  it("finds a distinctive token inside a longer header", () => {
    const d = autoDetect([
      "Internal Claim Number Ref",
      "Posted Date Of Service",
      "Primary Carrier Description",
      "Billing Procedure Code Value",
      "Total Billed Amount",
      "Plan Allowed Amount Net",
      "Total Insurance Paid To Date",
    ]);
    expect(missingRequired(d)).toEqual([]);
    expect(d.allowed_amount.header).toBe("Plan Allowed Amount Net");
    expect(d.paid_amount.header).toBe("Total Insurance Paid To Date");
    expect(d.allowed_amount.basis).toBe("contains");
  });
});

describe("autoDetect — refusing to guess", () => {
  it("leaves unrecognisable headers unmapped rather than guessing", () => {
    const d = autoDetect(["col_a", "col_b", "col_c", "widget", "sprocket"]);
    expect(missingRequired(d).sort()).toEqual([...REQUIRED_FIELDS].sort());
    for (const f of REQUIRED_FIELDS) expect(d[f].basis).toBe("none");
  });

  it("reports exactly which required fields are missing from a partial file", () => {
    const d = autoDetect(["claim_id", "service_date", "payer_name", "cdt_code", "billed_fee"]);
    expect(missingRequired(d)).toEqual(["allowed_amount", "paid_amount"]);
    expect(d.allowed_amount.header).toBeUndefined();
  });

  it("never assigns one column to two canonical fields", () => {
    // "Amount" is vague enough to tempt several fields; only one may claim it.
    const d = autoDetect(["claim_id", "service_date", "Carrier", "Code", "Amount"]);
    const used = Object.values(d)
      .map((x) => x.header)
      .filter((h): h is string => h !== undefined);
    expect(new Set(used).size).toBe(used.length);
  });

  it("does not mistake the write-off column for the allowed amount", () => {
    const d = autoDetect([
      "claim_id",
      "service_date",
      "payer_name",
      "cdt_code",
      "billed_fee",
      "Write-Off",
      "Ins Paid",
    ]);
    expect(d.allowed_amount.header).toBeUndefined();
    expect(d.writeoff_amount.header).toBe("Write-Off");
    expect(missingRequired(d)).toEqual(["allowed_amount"]);
  });
});

describe("toMapping", () => {
  it("drops blank selections so the engine sees only real columns", () => {
    const m = toMapping({ claim_id: "A", service_date: "", payer_name: "C" });
    expect(m.columns.claim_id).toBe("A");
    expect(m.columns.service_date).toBeUndefined();
    expect(m.columns.payer_name).toBe("C");
  });
});

describe("autoDetectFees", () => {
  it("matches the canonical fee-schedule shape", () => {
    const f = autoDetectFees(["payer_name", "cdt_code", "contracted_rate", "effective_from", "effective_to"]);
    expect(f.filter((x) => x.header === undefined)).toEqual([]);
  });

  it("accepts the engine's alternate spellings", () => {
    const f = autoDetectFees(["Carrier", "Proc Code", "Rate"]);
    const byField = Object.fromEntries(f.map((x) => [x.field, x.header]));
    expect(byField.payer_name).toBe("Carrier");
    expect(byField.cdt_code).toBe("Proc Code");
    expect(byField.contracted_rate).toBe("Rate");
  });

  it("flags a fee file missing a required column", () => {
    const f = autoDetectFees(["Carrier", "Proc Code"]);
    const missing = f.filter((x) => x.required && x.header === undefined).map((x) => x.field);
    expect(missing).toEqual(["contracted_rate"]);
  });
});
