import { describe, expect, it } from "vitest";
import { ConnectorSyncRequest } from "@nightshift/schema";
import { carrierToPayerKeyMap } from "@nightshift/od-sim";
import {
  buildSyncRequestFromRows,
  mapCoverage,
  PRACTICE_ID,
} from "../src/mapping.js";
import type {
  OdAppointmentRow,
  OdCoverageRow,
  OdPatientRow,
  OdProcedureRow,
} from "@nightshift/od-sim";

const payerMap = carrierToPayerKeyMap();

describe("connector mapping", () => {
  it("carrier -> payerKey map is derived from SEED-UNIVERSE", () => {
    expect(payerMap["Delta Dental MockState"]).toBe("mock-delta");
    expect(payerMap["MetLife Mock"]).toBe("mock-metlife");
    expect(payerMap["Guardian Mock"]).toBe("mock-guardian");
    expect(payerMap["SunCoast Dental Trust"]).toBe("mock-suncoast");
  });

  it("mapCoverage produces a valid SyncCoverage with mapped payerKey", () => {
    const row: OdCoverageRow = {
      pat_num: 1,
      inssub_num: 1,
      plan_num: 1,
      carrier_name: "Delta Dental MockState",
      group_num: "GRP-ACME",
      group_name: "Acme Fabrication Inc",
      subscriber_external_id: "SUB-1001",
      subscriber_name: "Alice Nguyen",
      relationship: "self",
      ordinal: 1,
      date_last_verified: new Date("2026-05-22T12:00:00Z") as unknown as string,
    };
    const cov = mapCoverage(row, payerMap);
    expect(cov.payerKey).toBe("mock-delta");
    expect(cov.lastVerifiedAt).toBe("2026-05-22T12:00:00.000Z");
    expect(cov.relationship).toBe("self");
  });

  it("child relationship and null last-verified are handled", () => {
    const row: OdCoverageRow = {
      pat_num: 10,
      inssub_num: 10,
      plan_num: 3,
      carrier_name: "Delta Dental MockState",
      group_num: "GRP-SCHOOL",
      group_name: "Cedar Park ISD",
      subscriber_external_id: "SUB-1010",
      subscriber_name: "Dana Brooks",
      relationship: "child",
      ordinal: 1,
      date_last_verified: null,
    };
    const cov = mapCoverage(row, payerMap);
    expect(cov.relationship).toBe("child");
    expect(cov.lastVerifiedAt).toBeNull();
  });

  it("buildSyncRequestFromRows yields a ConnectorSyncRequest that zod parses", () => {
    const patients: OdPatientRow[] = [
      { pat_num: 1, l_name: "Nguyen", f_name: "Alice", birthdate: "1988-04-12" },
    ];
    const coverages: OdCoverageRow[] = [
      {
        pat_num: 1,
        inssub_num: 1,
        plan_num: 1,
        carrier_name: "Guardian Mock",
        group_num: "GRP-ACME",
        group_name: "Acme Fabrication Inc",
        subscriber_external_id: "SUB-1008",
        subscriber_name: "Luis Romero",
        relationship: "self",
        ordinal: 1,
        date_last_verified: null,
      },
    ];
    const appointments: OdAppointmentRow[] = [
      {
        apt_num: 5,
        pat_num: 1,
        apt_datetime: new Date("2026-07-07T18:00:00Z") as unknown as string,
        minutes: 60,
        provider: "RDH Lopez",
        status: "scheduled",
      },
    ];
    const procedures: OdProcedureRow[] = [
      { proc_num: 1, apt_num: 5, pat_num: 1, cdt_code: "D1110" },
      { proc_num: 2, apt_num: 5, pat_num: 1, cdt_code: "D0120" },
    ];

    const req = buildSyncRequestFromRows(patients, coverages, appointments, procedures, payerMap);
    // Round-trip through zod to prove validity.
    const parsed = ConnectorSyncRequest.parse(req);
    expect(parsed.practiceId).toBe(PRACTICE_ID);
    expect(parsed.coverages[0].payerKey).toBe("mock-guardian");
    expect(parsed.appointments[0].cdtCodes).toEqual(["D1110", "D0120"]);
    expect(parsed.appointments[0].startsAt).toBe("2026-07-07T18:00:00.000Z");
  });
});
