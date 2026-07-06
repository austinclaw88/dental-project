import { describe, expect, it } from "vitest";
import { BenefitBreakdown, emptyBreakdown, validateBreakdown } from "./benefits.js";

describe("BenefitBreakdown", () => {
  it("emptyBreakdown parses and is clean", () => {
    const b = emptyBreakdown();
    expect(BenefitBreakdown.parse(b)).toBeTruthy();
    expect(validateBreakdown(b)).toEqual([]);
  });

  it("validators catch cross-field violations", () => {
    const b = emptyBreakdown();
    b.annualMaximum.total.value = 1500;
    b.annualMaximum.used.value = 2000; // used > total
    b.categoryCoverage.major.value = 150; // out of range
    b.deductible.individual.value = 50;
    b.deductible.individualMet.value = 75; // met > deductible
    b.cdtRules.push({
      cdtFrom: "X123",
      cdtTo: "D2999",
      category: "basic",
      percent: { value: 80, provenance: null, confidence: "high", unavailableReason: null },
      notes: null,
    });
    const issues = validateBreakdown(b);
    expect(issues.some((i) => i.includes("exceeds total"))).toBe(true);
    expect(issues.some((i) => i.includes("out of range"))).toBe(true);
    expect(issues.some((i) => i.includes("met exceeds"))).toBe(true);
    expect(issues.some((i) => i.includes("not CDT-shaped"))).toBe(true);
  });

  it("survives a serialize/deserialize round trip", () => {
    const b = emptyBreakdown();
    b.planStatus.active = {
      value: true,
      provenance: { source: "portal", artifactId: "a1", locator: ".status", retrievedAt: new Date().toISOString() },
      confidence: "high",
      unavailableReason: null,
    };
    const again = BenefitBreakdown.parse(JSON.parse(JSON.stringify(b)));
    expect(again.planStatus.active.value).toBe(true);
    expect(again.planStatus.active.provenance?.source).toBe("portal");
  });
});
