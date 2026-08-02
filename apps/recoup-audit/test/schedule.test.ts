import { beforeEach, describe, expect, it } from "vitest";
import { runAudit } from "../src/engine.js";
import { buildRateBook, MIN_MODE_SHARE, MIN_SUPPORT, parseFeeSchedule } from "../src/schedule.js";
import { baseline, line, resetRows } from "./helpers.js";

beforeEach(resetRows);

describe("rate reconstruction — the modal allowed amount", () => {
  it("takes the mode when support and share clear the thresholds", () => {
    const lines = [
      ...baseline("D2740", 900, 6),
      line({ cdt: "D2740", billed: 1450, allowed: 800 }),
      line({ cdt: "D2740", billed: 1450, allowed: 780 }),
    ];
    const rate = buildRateBook(lines).lookup("TEST DENTAL PLAN", "D2740");
    expect(rate).toBeDefined();
    expect(rate!.rate).toBe(90000);
    expect(rate!.basis).toBe("reconstructed");
    expect(rate!.support).toBe(6);
    expect(rate!.modeShare).toBeCloseTo(6 / 8);
  });

  it(`refuses a mode with fewer than ${MIN_SUPPORT} occurrences`, () => {
    const book = buildRateBook(baseline("D3330", 700, MIN_SUPPORT - 1));
    expect(book.lookup("TEST DENTAL PLAN", "D3330")).toBeUndefined();
    expect(book.unschedulable).toHaveLength(1);
    expect(book.unschedulable[0]).toMatchObject({
      cdtCode: "D3330",
      reason: "insufficient_support",
      support: MIN_SUPPORT - 1,
    });
  });

  it(`refuses a mode holding less than ${MIN_MODE_SHARE * 100}% of the pair's lines`, () => {
    // 4 at 500, 3 at 480, 3 at 460 → top support 4 but share 0.4.
    const lines = [
      ...baseline("D4341", 500, 4),
      ...baseline("D4341", 480, 3),
      ...baseline("D4341", 460, 3),
    ];
    const book = buildRateBook(lines);
    expect(book.lookup("TEST DENTAL PLAN", "D4341")).toBeUndefined();
    expect(book.unschedulable[0]!.reason).toBe("no_dominant_mode");
    expect(book.unschedulable[0]!.modeShare).toBeCloseTo(0.4);
  });

  it("breaks a tie toward the lower amount — under-claiming is survivable, over-claiming is not", () => {
    const lines = [...baseline("D2950", 300, 4), ...baseline("D2950", 250, 4)];
    const rate = buildRateBook(lines).lookup("TEST DENTAL PLAN", "D2950");
    expect(rate!.rate).toBe(25000);
    expect(rate!.modeShare).toBe(0.5);
  });

  it("does not let zeroed or secondary lines vote on the rate", () => {
    const lines = [
      ...baseline("D2950", 300, 4),
      line({ cdt: "D2950", billed: 385, allowed: 0, paid: 0 }),
      line({ cdt: "D2950", billed: 385, allowed: 0, paid: 0 }),
      line({ cdt: "D2950", billed: 385, allowed: 0, paid: 0 }),
      line({ cdt: "D2950", billed: 385, allowed: 150, paid: 0, ordinal: 2 }),
      line({ cdt: "D2950", billed: 385, allowed: 150, paid: 0, ordinal: 2 }),
      line({ cdt: "D2950", billed: 385, allowed: 150, paid: 0, ordinal: 2 }),
      line({ cdt: "D2950", billed: 385, allowed: 150, paid: 0, ordinal: 2 }),
    ];
    const rate = buildRateBook(lines).lookup("TEST DENTAL PLAN", "D2950");
    expect(rate!.rate).toBe(30000);
    expect(rate!.support).toBe(4);
    expect(rate!.modeShare).toBe(1);
  });

  it("reports a pair with no priced lines at all rather than inventing one", () => {
    const book = buildRateBook([
      line({ cdt: "D0220", billed: 38, allowed: 0, paid: 0 }),
      line({ cdt: "D0220", billed: 38, allowed: 0, paid: 0 }),
    ]);
    expect(book.unschedulable[0]!.reason).toBe("no_priced_lines");
  });

  it("keeps rates separate per payer", () => {
    const book = buildRateBook([
      ...baseline("D1110", 92, 5, "Delta Dental"),
      ...baseline("D1110", 78, 5, "MetLife PDP"),
    ]);
    expect(book.lookup("DELTA DENTAL", "D1110")!.rate).toBe(9200);
    expect(book.lookup("METLIFE PDP", "D1110")!.rate).toBe(7800);
  });
});

describe("unschedulable pairs are excluded from findings", () => {
  it("never flags a below-schedule shortfall on a pair it could not price", () => {
    // Three lines only: too thin to establish a rate, so the $200 gap is invisible
    // by design rather than guessed at.
    const result = runAudit([
      line({ cdt: "D3330", billed: 1350, allowed: 900, paid: 450 }),
      line({ cdt: "D3330", billed: 1350, allowed: 900, paid: 450 }),
      line({ cdt: "D3330", billed: 1350, allowed: 700, paid: 350 }),
    ]);
    expect(result.findings).toHaveLength(0);
    expect(result.coverage.pairsSchedulable).toBe(0);
    expect(result.coverage.unschedulableLines).toBe(3);
    expect(result.unschedulable).toHaveLength(1);
  });

  it("counts coverage over lines and pairs", () => {
    const result = runAudit([...baseline("D1110", 92, 6), ...baseline("D3330", 700, 2)]);
    expect(result.coverage.totalLines).toBe(8);
    expect(result.coverage.schedulableLines).toBe(6);
    expect(result.coverage.pairsTotal).toBe(2);
    expect(result.coverage.pairsSchedulable).toBe(1);
    expect(result.coverage.pairsReconstructed).toBe(1);
  });
});

describe("contracted fee schedules", () => {
  const FEES = `payer_name,cdt_code,contracted_rate,effective_from,effective_to
Test Dental Plan,D2740,1000.00,2025-01-01,2025-12-31
Test Dental Plan,D2740,1100.00,2026-01-01,
`;

  it("parses a fee schedule and tolerates header aliases", () => {
    const rows = parseFeeSchedule(`carrier,code,rate\nDelta,D0120,45.00\n`);
    expect(rows).toEqual([
      { payerKey: "DELTA", payerName: "Delta", cdtCode: "D0120", rate: 4500, effectiveFrom: undefined, effectiveTo: undefined },
    ]);
  });

  it("errors clearly when the fee schedule lacks a required column", () => {
    expect(() => parseFeeSchedule(`payer_name,cdt_code\nDelta,D0120\n`)).toThrowError(
      /missing required column\(s\): contracted_rate/,
    );
  });

  it("prefers the contracted rate over the reconstructed one", () => {
    const contract = parseFeeSchedule(FEES);
    const lines = baseline("D2740", 900, 8);
    const rate = buildRateBook(lines, contract).lookup("TEST DENTAL PLAN", "D2740", "2025-06-01");
    expect(rate!.basis).toBe("contract");
    expect(rate!.rate).toBe(100000);
  });

  it("respects effective-date windows", () => {
    const contract = parseFeeSchedule(FEES);
    const book = buildRateBook(baseline("D2740", 900, 8), contract);
    expect(book.lookup("TEST DENTAL PLAN", "D2740", "2025-06-01")!.rate).toBe(100000);
    expect(book.lookup("TEST DENTAL PLAN", "D2740", "2026-06-01")!.rate).toBe(110000);
  });

  it("raises confidence to high when the comparison is to a contract", () => {
    const contract = parseFeeSchedule(FEES);
    const lines = [...baseline("D2740", 1000, 6, "Test Dental Plan", 1450)];
    lines.push(line({ cdt: "D2740", billed: 1450, allowed: 850, paid: 425 }));
    const withContract = runAudit(lines, { contractRates: contract });
    expect(withContract.findings[0]!.confidence).toBe("high");
    expect(withContract.findings[0]!.evidence.rateBasis).toBe("contract");

    const withoutContract = runAudit(lines);
    expect(withoutContract.findings[0]!.confidence).toBe("medium");
    expect(withoutContract.findings[0]!.evidence.rateBasis).toBe("reconstructed");
  });
});
