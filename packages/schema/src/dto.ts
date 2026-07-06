import { z } from "zod";

/**
 * DTOs shared between connector ⇄ API and dashboard ⇄ API.
 * The connector maps OpenDental tables to these shapes (TDD §3.1);
 * the cloud never sees raw od_* rows.
 */

export const SyncPatient = z.object({
  odPatNum: z.number(),
  firstName: z.string(),
  lastName: z.string(),
  birthdate: z.string(), // ISO date
});
export type SyncPatient = z.infer<typeof SyncPatient>;

export const SyncCoverage = z.object({
  odPatNum: z.number(),
  odInsSubNum: z.number(),
  odPlanNum: z.number(),
  carrierName: z.string(),
  /** stable key used to match a payer record cloud-side (lowercased carrier name for MVP) */
  payerKey: z.string(),
  groupNumber: z.string().nullable(),
  groupName: z.string().nullable(),
  subscriberId: z.string(),
  subscriberName: z.string(),
  relationship: z.enum(["self", "spouse", "child", "other"]),
  ordinal: z.number().default(1), // primary=1, secondary=2
  /** last time this plan's benefits were fully verified, from insverify (ISO datetime or null) */
  lastVerifiedAt: z.string().nullable(),
});
export type SyncCoverage = z.infer<typeof SyncCoverage>;

export const SyncAppointment = z.object({
  odAptNum: z.number(),
  odPatNum: z.number(),
  startsAt: z.string(), // ISO datetime, practice-local converted to UTC
  minutes: z.number(),
  provider: z.string(),
  /** CDT codes scheduled for the visit, e.g. ["D1110","D0274"] */
  cdtCodes: z.array(z.string()),
  status: z.enum(["scheduled", "complete", "broken"]).default("scheduled"),
});
export type SyncAppointment = z.infer<typeof SyncAppointment>;

export const ConnectorSyncRequest = z.object({
  practiceId: z.string(),
  connectorVersion: z.string(),
  patients: z.array(SyncPatient),
  coverages: z.array(SyncCoverage),
  appointments: z.array(SyncAppointment),
});
export type ConnectorSyncRequest = z.infer<typeof ConnectorSyncRequest>;

export const WritebackAck = z.object({
  status: z.enum(["applied", "failed"]),
  /** before-image of any modified od rows, for the revert journal (PRD R14) */
  beforeImage: z.record(z.unknown()).nullable(),
  error: z.string().nullable().default(null),
});
export type WritebackAck = z.infer<typeof WritebackAck>;

/** Dashboard list item (GET /api/practices/:id/day/:date/verifications). */
export const VerificationListItem = z.object({
  id: z.string(),
  patientName: z.string(),
  appointmentAt: z.string(),
  provider: z.string().nullable(),
  cdtCodes: z.array(z.string()),
  carrierName: z.string().nullable(),
  scope: z.string(),
  status: z.string(),
  displayStatus: z.enum(["verified", "attention", "in_progress", "failed", "planned"]),
  exceptions: z.array(
    z.object({ id: z.string(), type: z.string(), severity: z.string(), message: z.string(), resolvedAt: z.string().nullable() }),
  ),
  completedAt: z.string().nullable(),
});
export type VerificationListItem = z.infer<typeof VerificationListItem>;
