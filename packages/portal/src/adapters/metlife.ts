import { MockPortalAdapter, type PayerAdapter } from "../adapter.js";

/**
 * mock-metlife — the sparse MetLife Mock portal. Benefits page only (no history
 * page). Exposes status, maximum, deductible, category coverage (Type I/II/III)
 * and frequency LIMITS — but NOT frequency used-counts, downgrades,
 * missing-tooth or COB (those come back unavailable-from-payer downstream).
 */
export const metlifeAdapter: PayerAdapter = new MockPortalAdapter({
  payerKey: "mock-metlife",
  pages: ["benefits"],
  capabilities: {
    "planStatus.active": true,
    "planStatus.effectiveDate": true,
    "planStatus.terminationDate": true,
    "planStatus.planYearStart": false,
    "annualMaximum.total": true,
    "annualMaximum.used": true,
    "annualMaximum.remaining": true,
    "deductible.individual": true,
    "deductible.individualMet": true,
    "deductible.family": false,
    "deductible.appliesTo": false,
    "categoryCoverage.preventive": true,
    "categoryCoverage.basic": true,
    "categoryCoverage.major": true,
    "categoryCoverage.ortho": true,
    frequencies: true, // limits only, no used-counts
    waitingPeriods: false,
    downgrades: false,
    missingToothClause: false,
    cobRule: false,
  },
});
