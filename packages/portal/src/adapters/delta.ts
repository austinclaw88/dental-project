import { MockPortalAdapter, type PayerAdapter } from "../adapter.js";

/**
 * mock-delta — the rich Delta Dental MockState portal. Exposes essentially the
 * full canonical breakdown: status, dates, maximums, deductibles, category
 * coverage, frequency utilization (with used-counts + last-service dates via
 * the history page), waiting periods, downgrades, missing-tooth clause, COB.
 */
export const deltaAdapter: PayerAdapter = new MockPortalAdapter({
  payerKey: "mock-delta",
  pages: ["benefits", "history"],
  capabilities: {
    "planStatus.active": true,
    "planStatus.effectiveDate": true,
    "planStatus.terminationDate": true,
    "planStatus.planYearStart": true,
    "annualMaximum.total": true,
    "annualMaximum.used": true,
    "annualMaximum.remaining": true,
    "deductible.individual": true,
    "deductible.individualMet": true,
    "deductible.family": true,
    "deductible.appliesTo": true,
    "categoryCoverage.preventive": true,
    "categoryCoverage.basic": true,
    "categoryCoverage.major": true,
    "categoryCoverage.ortho": true,
    frequencies: true,
    waitingPeriods: true,
    downgrades: true,
    missingToothClause: true,
    cobRule: true,
  },
});
