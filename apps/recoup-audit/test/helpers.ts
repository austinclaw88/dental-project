import { normalizePayer } from "../src/mapping.js";
import type { ClaimLine } from "../src/types.js";

let nextRow = 1;

export function resetRows(): void {
  nextRow = 1;
}

/** Build a claim line with sensible defaults; amounts are given in DOLLARS for readability. */
export function line(spec: {
  cdt: string;
  payer?: string;
  claim?: string;
  date?: string;
  billed: number;
  allowed: number;
  paid?: number;
  tooth?: string;
  patientPortion?: number;
  deductible?: number;
  writeoff?: number;
  adjustments?: string[];
  ordinal?: number;
  network?: string;
  coveragePct?: number;
  row?: number;
  patientHash?: string;
}): ClaimLine {
  const payerName = spec.payer ?? "Test Dental Plan";
  const c = (n: number | undefined) => (n === undefined ? undefined : Math.round(n * 100));
  return {
    rowIndex: spec.row ?? nextRow++,
    claimId: spec.claim ?? "CLM-1",
    serviceDate: spec.date ?? "2025-09-15",
    payerName,
    payerKey: normalizePayer(payerName),
    cdtCode: spec.cdt,
    billed: Math.round(spec.billed * 100),
    allowed: Math.round(spec.allowed * 100),
    paid: Math.round((spec.paid ?? spec.allowed) * 100),
    tooth: spec.tooth,
    patientHash: spec.patientHash ?? "hash0001",
    patientPortion: c(spec.patientPortion),
    writeoff: c(spec.writeoff),
    deductibleApplied: c(spec.deductible),
    adjustmentCodes: spec.adjustments ?? [],
    claimOrdinal: spec.ordinal,
    networkName: spec.network,
    coveragePct: spec.coveragePct,
  };
}

/** N identical lines at the schedule rate, to give reconstruction something to chew on. */
export function baseline(
  cdt: string,
  rate: number,
  count: number,
  payer = "Test Dental Plan",
  billed = rate * 1.4,
): ClaimLine[] {
  return Array.from({ length: count }, () =>
    line({ cdt, payer, billed, allowed: rate, paid: rate }),
  );
}

export function dollars(cents: number): number {
  return Math.round(cents) / 100;
}
