import { describe, expect, it } from "vitest";
import { parseCsv } from "../src/csv.js";
import {
  hashSubscriber,
  loadPreset,
  mapTable,
  parseAdjustmentCodes,
  parseDate,
  parseOrdinal,
  resolveMapping,
  validateMapping,
  type Mapping,
} from "../src/mapping.js";
import { parseMoney } from "../src/money.js";

const CANONICAL_CSV = `claim_id,service_date,payer_name,cdt_code,billed_fee,allowed_amount,paid_amount,subscriber_id,tooth,patient_portion,deductible_applied,adjustment_codes,claim_ordinal,coverage_pct
CLM-1,2025-03-04,Delta Dental,D2740,"$1,450.00","1,044.00",522.00,SUB-9001,19,522.00,0.00,,primary,50
CLM-2,03/17/2025,MetLife PDP,D1110,125.00,92.00,92.00,SUB-9002,,0.00,0.00,,primary,100
`;

describe("mapping — presets", () => {
  it("parses a canonical CSV through the generic preset", () => {
    const result = mapTable(parseCsv(CANONICAL_CSV), loadPreset("generic"));
    expect(result.rejected).toEqual([]);
    expect(result.lines).toHaveLength(2);
    const [a, b] = result.lines;
    expect(a!.cdtCode).toBe("D2740");
    expect(a!.billed).toBe(145000);
    expect(a!.allowed).toBe(104400);
    expect(a!.paid).toBe(52200);
    expect(a!.tooth).toBe("19");
    expect(a!.claimOrdinal).toBe(1);
    expect(a!.coveragePct).toBe(50);
    // Dates normalise regardless of the export's format.
    expect(b!.serviceDate).toBe("2025-03-17");
  });

  it("matches headers case-insensitively and ignores spaces/underscores", () => {
    const csv = `Claim ID,Service-Date,PAYER NAME,CDT Code,Billed Fee,Allowed Amount,Paid Amount
C1,2025-01-02,Aetna,D0120,65.00,45.00,45.00
`;
    const result = mapTable(parseCsv(csv), loadPreset("generic"));
    expect(result.rejected).toEqual([]);
    expect(result.lines[0]!.payerName).toBe("Aetna");
  });

  it("resolves Open Dental style headers via the opendental preset", () => {
    const csv = `ClaimNum,ProcDate,CarrierName,ProcCode,FeeBilled,AllowedAmt,InsPayAmt,SubscriberID,ToothNum,DedApplied,WriteOff,ClaimType
551,2025-06-01,Delta Dental Premier,D2391,245.00,159.00,127.20,SUB-1,30,0.00,86.00,P
`;
    const result = mapTable(parseCsv(csv), loadPreset("opendental"));
    expect(result.rejected).toEqual([]);
    expect(result.lines[0]!.claimId).toBe("551");
    expect(result.lines[0]!.allowed).toBe(15900);
    expect(result.lines[0]!.claimOrdinal).toBe(1);
    expect(result.optionalPresent).toContain("tooth");
    expect(result.optionalPresent).toContain("writeoff_amount");
  });

  it("resolves Dentrix style headers via the dentrix preset", () => {
    const csv = `Claim #,Procedure Date,Insurance Carrier,Procedure Code,Charge,Allowed Amount,Insurance Paid,Subscriber ID,Claim Type
88213,04/22/2025,Cigna DPPO,D0274,85.00,58.00,58.00,MEM-77,Secondary
`;
    const result = mapTable(parseCsv(csv), loadPreset("dentrix"));
    expect(result.rejected).toEqual([]);
    expect(result.lines[0]!.payerName).toBe("Cigna DPPO");
    expect(result.lines[0]!.claimOrdinal).toBe(2);
  });

  it("accepts a preset name or a file path for --map", () => {
    expect(resolveMapping().name).toBe("generic");
    expect(resolveMapping("dentrix").name).toBe("dentrix");
  });
});

describe("mapping — custom mappings and errors", () => {
  it("honours a custom mapping with candidate header lists", () => {
    const mapping: Mapping = validateMapping({
      name: "custom",
      columns: {
        claim_id: ["Nope", "TicketNo"],
        service_date: "DOS",
        payer_name: "Ins",
        cdt_code: "Code",
        billed_fee: "Gross",
        allowed_amount: "Net",
        paid_amount: "Rcvd",
      },
    });
    const csv = `TicketNo,DOS,Ins,Code,Gross,Net,Rcvd
T-9,12/31/24,Guardian,D1110,125.00,88.00,88.00
`;
    const result = mapTable(parseCsv(csv), mapping);
    expect(result.rejected).toEqual([]);
    expect(result.lines[0]!.claimId).toBe("T-9");
    expect(result.lines[0]!.serviceDate).toBe("2024-12-31");
  });

  it("errors clearly when a required column is missing, naming field, candidates and headers", () => {
    const csv = `claim_id,service_date,payer_name,cdt_code,billed_fee,paid_amount
C1,2025-01-01,Delta,D0120,65.00,45.00
`;
    expect(() => mapTable(parseCsv(csv), loadPreset("generic"))).toThrowError(
      /missing 1 required column/i,
    );
    try {
      mapTable(parseCsv(csv), loadPreset("generic"));
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("allowed_amount");
      expect(msg).toContain("CSV headers present");
      expect(msg).toContain("--map");
    }
  });

  it("rejects a mapping that omits a required canonical field", () => {
    expect(() => validateMapping({ columns: { claim_id: "a" } })).toThrowError(
      /required canonical field\(s\) not mapped/,
    );
  });

  it("rejects a mapping that names a field the engine does not know", () => {
    expect(() =>
      validateMapping({
        columns: {
          claim_id: "a",
          service_date: "b",
          payer_name: "c",
          cdt_code: "d",
          billed_fee: "e",
          allowed_amount: "f",
          paid_amount: "g",
          favourite_colour: "h",
        },
      }),
    ).toThrowError(/unknown canonical field/);
  });

  it("rejects bad rows individually instead of failing the whole file", () => {
    const csv = `claim_id,service_date,payer_name,cdt_code,billed_fee,allowed_amount,paid_amount
C1,2025-01-01,Delta,D0120,65.00,45.00,45.00
C2,not-a-date,Delta,D0120,65.00,45.00,45.00
C3,2025-01-03,Delta,,65.00,45.00,45.00
C4,2025-01-04,Delta,D0120,65.00,,45.00
`;
    const result = mapTable(parseCsv(csv), loadPreset("generic"));
    expect(result.lines).toHaveLength(1);
    expect(result.rejected).toHaveLength(3);
    expect(result.rejected[0]!.reason).toMatch(/service_date/);
    expect(result.rejected[1]!.reason).toMatch(/cdt_code/);
    expect(result.rejected[2]!.reason).toMatch(/allowed_amount/);
  });

  it("errors on an empty file", () => {
    expect(() => mapTable(parseCsv(""), loadPreset("generic"))).toThrowError(/empty/i);
  });
});

describe("mapping — field parsers", () => {
  it("parses money in the shapes exports actually emit", () => {
    expect(parseMoney("$1,234.56", "x")).toBe(123456);
    expect(parseMoney("(45.00)", "x")).toBe(-4500);
    expect(parseMoney("-12.50", "x")).toBe(-1250);
    expect(parseMoney("", "x")).toBeNull();
    expect(parseMoney("N/A", "x")).toBeNull();
    expect(() => parseMoney("twelve", "x")).toThrowError(/Cannot parse/);
  });

  it("parses the date formats PMS exports emit", () => {
    expect(parseDate("2025-07-04", 1)).toBe("2025-07-04");
    expect(parseDate("7/4/2025", 1)).toBe("2025-07-04");
    expect(parseDate("07/04/25", 1)).toBe("2025-07-04");
    expect(parseDate("2025-07-04T09:00:00Z", 1)).toBe("2025-07-04");
    expect(() => parseDate("July 4 2025", 1)).toThrowError(/cannot parse service_date/i);
  });

  it("reads primary/secondary in the many ways it is written", () => {
    expect(parseOrdinal("primary")).toBe(1);
    expect(parseOrdinal("P")).toBe(1);
    expect(parseOrdinal("2")).toBe(2);
    expect(parseOrdinal("Secondary")).toBe(2);
    expect(parseOrdinal("")).toBeUndefined();
    expect(parseOrdinal("SecondaryClaim", ["SecondaryClaim"])).toBe(2);
  });

  it("splits adjustment codes on the usual separators", () => {
    expect(parseAdjustmentCodes("CARC 1 | CARC 2")).toEqual(["CARC 1", "CARC 2"]);
    expect(parseAdjustmentCodes("co-45;pr-96")).toEqual(["CO-45", "PR-96"]);
    expect(parseAdjustmentCodes("")).toEqual([]);
  });

  it("hashes subscriber ids one-way and deterministically", () => {
    const h = hashSubscriber("SUB-9001");
    expect(h).toHaveLength(10);
    expect(h).toBe(hashSubscriber("sub-9001 "));
    expect(h).not.toContain("9001");
  });

  it("never retains the raw subscriber id on a mapped line", () => {
    const result = mapTable(parseCsv(CANONICAL_CSV), loadPreset("generic"));
    expect(JSON.stringify(result.lines)).not.toContain("SUB-9001");
    expect(result.lines[0]!.patientHash).toBe(hashSubscriber("SUB-9001"));
  });
});

describe("csv parsing", () => {
  it("handles quotes, embedded commas and newlines, CRLF and a BOM", () => {
    const csv = '﻿a,b\r\n"x,1","line\nbreak"\r\n"say ""hi""",2\r\n';
    const table = parseCsv(csv);
    expect(table.headers).toEqual(["a", "b"]);
    expect(table.rows[0]).toEqual({ a: "x,1", b: "line\nbreak" });
    expect(table.rows[1]).toEqual({ a: 'say "hi"', b: "2" });
  });

  it("pads short rows rather than shifting fields", () => {
    const table = parseCsv("a,b,c\n1,2\n");
    expect(table.rows[0]).toEqual({ a: "1", b: "2", c: "" });
  });
});
