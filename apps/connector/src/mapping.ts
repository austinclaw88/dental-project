import type pg from "pg";
import {
  ConnectorSyncRequest,
  SyncAppointment,
  SyncCoverage,
  SyncPatient,
} from "@nightshift/schema";
import {
  carrierToPayerKeyMap,
  getAppointments,
  getCoverages,
  getPatients,
  getProcedures,
  type OdAppointmentRow,
  type OdCoverageRow,
  type OdPatientRow,
  type OdProcedureRow,
} from "@nightshift/od-sim";

export const PRACTICE_ID = "11111111-1111-1111-1111-111111111111";
export const CONNECTOR_VERSION = "0.1.0-ts";

/** Fixed connector DTOs use ISO-8601 UTC; normalize pg Date | string | null. */
function toIso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  // pg may return timestamptz as string when parser overridden; trust it if ISO-ish
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}

function relationship(r: string): "self" | "spouse" | "child" | "other" {
  return r === "self" || r === "spouse" || r === "child" ? r : "other";
}

function apptStatus(s: string): "scheduled" | "complete" | "broken" {
  return s === "complete" || s === "broken" ? s : "scheduled";
}

export function mapPatient(row: OdPatientRow): SyncPatient {
  return SyncPatient.parse({
    odPatNum: row.pat_num,
    firstName: row.f_name,
    lastName: row.l_name,
    birthdate: row.birthdate,
  });
}

export function mapCoverage(
  row: OdCoverageRow,
  payerKeyByCarrier: Record<string, string>,
): SyncCoverage {
  const payerKey = payerKeyByCarrier[row.carrier_name] ?? row.carrier_name.toLowerCase();
  return SyncCoverage.parse({
    odPatNum: row.pat_num,
    odInsSubNum: row.inssub_num,
    odPlanNum: row.plan_num,
    carrierName: row.carrier_name,
    payerKey,
    groupNumber: row.group_num,
    groupName: row.group_name,
    subscriberId: row.subscriber_external_id,
    subscriberName: row.subscriber_name,
    relationship: relationship(row.relationship),
    ordinal: row.ordinal,
    lastVerifiedAt: toIso(row.date_last_verified),
  });
}

export function mapAppointment(
  row: OdAppointmentRow,
  cdtByApt: Map<number, string[]>,
): SyncAppointment {
  return SyncAppointment.parse({
    odAptNum: row.apt_num,
    odPatNum: row.pat_num,
    startsAt: toIso(row.apt_datetime) ?? new Date(row.apt_datetime).toISOString(),
    minutes: row.minutes,
    provider: row.provider ?? "",
    cdtCodes: cdtByApt.get(row.apt_num) ?? [],
    status: apptStatus(row.status),
  });
}

export function groupCdtByApt(procs: OdProcedureRow[]): Map<number, string[]> {
  const m = new Map<number, string[]>();
  for (const p of procs) {
    const arr = m.get(p.apt_num) ?? [];
    arr.push(p.cdt_code);
    m.set(p.apt_num, arr);
  }
  return m;
}

/** Pure mapping from raw od rows -> validated ConnectorSyncRequest. */
export function buildSyncRequestFromRows(
  patients: OdPatientRow[],
  coverages: OdCoverageRow[],
  appointments: OdAppointmentRow[],
  procedures: OdProcedureRow[],
  payerKeyByCarrier: Record<string, string>,
): ConnectorSyncRequest {
  const cdtByApt = groupCdtByApt(procedures);
  return ConnectorSyncRequest.parse({
    practiceId: PRACTICE_ID,
    connectorVersion: CONNECTOR_VERSION,
    patients: patients.map(mapPatient),
    coverages: coverages.map((c) => mapCoverage(c, payerKeyByCarrier)),
    appointments: appointments.map((a) => mapAppointment(a, cdtByApt)),
  });
}

/** Read od-sim and produce a validated ConnectorSyncRequest. */
export async function buildSyncRequest(pool?: pg.Pool): Promise<ConnectorSyncRequest> {
  const [patients, coverages, appointments, procedures] = await Promise.all([
    getPatients(pool),
    getCoverages(pool),
    getAppointments(pool),
    getProcedures(pool),
  ]);
  return buildSyncRequestFromRows(
    patients,
    coverages,
    appointments,
    procedures,
    carrierToPayerKeyMap(),
  );
}
