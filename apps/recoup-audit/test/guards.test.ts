/**
 * Guard tests: legitimate adjudication that must NEVER appear in a report.
 *
 * A missed underpayment costs the practice money it never knew about. A false
 * positive costs it a wasted appeal and costs us the dentist's belief in every
 * other number in the report. These tests are the ones to break first if the
 * detectors are ever loosened.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { runAudit } from "../src/engine.js";
import {
  coinsuranceAccountsForGap,
  deductibleCoversGap,
  guardBundled,
  guardZeroPay,
  inDateWindow,
  isSecondaryClaim,
  nonCoveredBilledToPatient,
} from "../src/detectors/guards.js";
import { explanatoryMarkers } from "../src/partners.js";
import { DEFAULT_TOLERANCE } from "../src/types.js";
import { baseline, line, resetRows } from "./helpers.js";

beforeEach(resetRows);

const TOL = DEFAULT_TOLERANCE;
const flaggedTypes = (lines: Parameters<typeof runAudit>[0]) =>
  runAudit(lines).findings.map((f) => f.type);

describe("guard: a deductible that covers the gap", () => {
  it("is not a zero-paid finding", () => {
    const l = line({ cdt: "D1110", billed: 125, allowed: 92, paid: 0, deductible: 92, patientPortion: 0 });
    expect(deductibleCoversGap(l, TOL)).toBe(true);
    expect(guardZeroPay(l, TOL).reason).toBe("deductible_covers_gap");
    expect(flaggedTypes([...baseline("D1110", 92, 8), l])).toEqual([]);
  });

  it("still flags the remainder when the deductible only partly explains it", () => {
    const l = line({ cdt: "D1110", billed: 125, allowed: 92, paid: 0, deductible: 30 });
    expect(deductibleCoversGap(l, TOL)).toBe(false);
    expect(flaggedTypes([...baseline("D1110", 92, 8), l])).toEqual(["zero_paid_no_reason"]);
  });
});

describe("guard: ordinary coinsurance", () => {
  it("is not a finding when patient portion plus payment reconstructs the allowed amount", () => {
    const l = line({ cdt: "D2740", billed: 1450, allowed: 1000, paid: 500, patientPortion: 500 });
    expect(coinsuranceAccountsForGap(l, TOL)).toBe(true);
    expect(flaggedTypes([...baseline("D2740", 1000, 8, "Test Dental Plan", 1450), l])).toEqual([]);
  });

  it("is not a finding when the payer paid nothing but the patient owes all of it", () => {
    const l = line({ cdt: "D2740", billed: 1450, allowed: 1000, paid: 0, patientPortion: 1000 });
    expect(guardZeroPay(l, TOL).reason).toBe("coinsurance_accounts_for_gap");
    expect(flaggedTypes([...baseline("D2740", 1000, 8, "Test Dental Plan", 1450), l])).toEqual([]);
  });
});

describe("guard: secondary and tertiary claims", () => {
  it("does not raise a zero-paid finding on a secondary claim", () => {
    const l = line({ cdt: "D1110", billed: 125, allowed: 92, paid: 0, ordinal: 2 });
    expect(isSecondaryClaim(l)).toBe(true);
    expect(guardZeroPay(l, TOL).reason).toBe("secondary_claim");
    expect(flaggedTypes([...baseline("D1110", 92, 8), l])).toEqual([]);
  });

  it("DOES flag a secondary claim allowed below schedule — the documented carve-out", () => {
    const l = line({ cdt: "D1110", billed: 125, allowed: 70, paid: 70, ordinal: 2 });
    expect(flaggedTypes([...baseline("D1110", 92, 8), l])).toEqual(["below_schedule"]);
  });

  it("does not raise a bundling finding on a secondary claim", () => {
    const l = line({ cdt: "D2950", claim: "CLM-S", billed: 385, allowed: 0, paid: 0, tooth: "19", ordinal: 2 });
    expect(guardBundled(l, TOL).reason).toBe("secondary_claim");
    expect(
      flaggedTypes([
        ...baseline("D2950", 280, 6, "Test Dental Plan", 385),
        ...baseline("D2740", 950, 6, "Test Dental Plan", 1450),
        line({ cdt: "D2740", claim: "CLM-S", billed: 1450, allowed: 950, paid: 475, tooth: "19", ordinal: 2 }),
        l,
      ]),
    ).toEqual([]);
  });
});

describe("guard: annual maximum and other stated benefit limits", () => {
  it.each([
    ["ANNUAL MAXIMUM MET", "annual_max"],
    ["CARC 119", "annual_max"],
    ["CO-96 NOT A COVERED BENEFIT", "non_covered"],
    ["FREQUENCY LIMITATION", "frequency"],
    ["WAITING PERIOD", "waiting_period"],
    ["CARC 23 COB PRIMARY PAID", "coordination_of_benefits"],
    ["MISSING TOOTH CLAUSE", "missing_tooth_clause"],
    ["CARC 29 TIMELY FILING", "timely_filing"],
  ])("treats %s as a stated reason", (remark, kind) => {
    expect(explanatoryMarkers([remark])).toContain(kind);
  });

  it("does not treat the bundling code itself (CARC 97) as an explanation", () => {
    expect(explanatoryMarkers(["CARC 97 BENEFIT INCLUDED IN ANOTHER SERVICE"])).toEqual([]);
  });

  it("does not treat 'over fee schedule' (CARC 45) as an explanation", () => {
    expect(explanatoryMarkers(["CARC 45"])).toEqual([]);
  });

  it("suppresses a zero-paid finding when the annual maximum is stated", () => {
    const l = line({
      cdt: "D2740",
      billed: 1450,
      allowed: 1000,
      paid: 0,
      adjustments: ["CARC 119 ANNUAL MAXIMUM MET"],
    });
    expect(guardZeroPay(l, TOL).reason).toBe("explanatory_adjustment_code");
    expect(flaggedTypes([...baseline("D2740", 1000, 8, "Test Dental Plan", 1450), l])).toEqual([]);
  });
});

describe("guard: non-covered services billed to the patient", () => {
  it("does not call a non-covered build-up a bundling edit", () => {
    const l = line({
      cdt: "D2950",
      claim: "CLM-N",
      billed: 385,
      allowed: 0,
      paid: 0,
      tooth: "19",
      patientPortion: 385,
      writeoff: 0,
      adjustments: ["CARC 96 NON-COVERED SERVICE"],
    });
    expect(nonCoveredBilledToPatient(l, TOL)).toBe(true);
    expect(guardBundled(l, TOL).guarded).toBe(true);
    expect(
      flaggedTypes([
        ...baseline("D2950", 280, 6, "Test Dental Plan", 385),
        ...baseline("D2740", 950, 6, "Test Dental Plan", 1450),
        line({ cdt: "D2740", claim: "CLM-N", billed: 1450, allowed: 950, paid: 475, tooth: "19" }),
        l,
      ]),
    ).toEqual([]);
  });
});

describe("guard: a plan that covers nothing for this service", () => {
  it("does not raise a zero-paid finding at 0% coverage", () => {
    const l = line({ cdt: "D1110", billed: 125, allowed: 92, paid: 0, coveragePct: 0 });
    expect(guardZeroPay(l, TOL).reason).toBe("zero_coverage_plan");
    expect(flaggedTypes([...baseline("D1110", 92, 8), l])).toEqual([]);
  });
});

describe("guard: the date window", () => {
  it("excludes rows outside --since / --until before any detector sees them", () => {
    const l = line({ cdt: "D1110", billed: 125, allowed: 60, paid: 60, date: "2024-05-01" });
    expect(inDateWindow(l, "2025-01-01", "2025-12-31")).toBe(false);
    expect(inDateWindow(l, undefined, undefined)).toBe(true);
    const result = runAudit([...baseline("D1110", 92, 8), l], {
      since: "2025-01-01",
      until: "2025-12-31",
    });
    expect(result.findings).toEqual([]);
    expect(result.excludedByWindow).toBe(1);
  });
});

describe("guard: rounding noise", () => {
  it("does not flag a one-cent difference", () => {
    const l = line({ cdt: "D1110", billed: 125, allowed: 91.99, paid: 91.99 });
    expect(flaggedTypes([...baseline("D1110", 92, 8), l])).toEqual([]);
  });
});

describe("guard: overpayment is never a finding", () => {
  it("ignores a line the payer allowed MORE than the rate", () => {
    const l = line({ cdt: "D1110", billed: 125, allowed: 110, paid: 110 });
    expect(flaggedTypes([...baseline("D1110", 92, 8), l])).toEqual([]);
  });
});

describe("guard: a whole file of ordinary adjudication produces nothing", () => {
  it("finds no candidates in a clean, fully-explained dataset", () => {
    const clean = [
      ...baseline("D0120", 45, 10, "Delta Dental", 65),
      ...baseline("D1110", 92, 10, "Delta Dental", 125),
      // Major work with textbook coinsurance.
      ...Array.from({ length: 8 }, () =>
        line({
          cdt: "D2740",
          payer: "Delta Dental",
          billed: 1450,
          allowed: 1000,
          paid: 500,
          patientPortion: 500,
        }),
      ),
      // Deductible year-start line.
      line({
        cdt: "D2740",
        payer: "Delta Dental",
        billed: 1450,
        allowed: 1000,
        paid: 475,
        deductible: 50,
        patientPortion: 475,
      }),
      // Secondary claim paying nothing.
      line({
        cdt: "D2740",
        payer: "Delta Dental",
        billed: 1450,
        allowed: 1000,
        paid: 0,
        patientPortion: 1000,
        ordinal: 2,
        adjustments: ["CARC 23 COB PRIMARY PAID"],
      }),
      // Annual maximum reached.
      line({
        cdt: "D2740",
        payer: "Delta Dental",
        billed: 1450,
        allowed: 1000,
        paid: 0,
        patientPortion: 1000,
        adjustments: ["CARC 119 ANNUAL MAXIMUM MET"],
      }),
      // Non-covered, billed to the patient.
      line({
        cdt: "D1110",
        payer: "Delta Dental",
        billed: 125,
        allowed: 0,
        paid: 0,
        patientPortion: 125,
        writeoff: 0,
        adjustments: ["CARC 96 NON-COVERED"],
      }),
    ];
    const result = runAudit(clean);
    expect(result.findings).toEqual([]);
    expect(result.totals.candidateTotal).toBe(0);
  });
});
