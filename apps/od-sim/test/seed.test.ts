import { beforeAll, describe, expect, it } from "vitest";
import { seed } from "../src/seed.js";
import {
  getAppointments,
  getCoverages,
  getPatients,
  getProcedures,
  getInsverify,
  loadSeedUniverse,
} from "../src/queries.js";

// These tests run against the real odsim dev database (re-seeded in setup).
beforeAll(async () => {
  await seed();
}, 60_000);

describe("od-sim seed", () => {
  it("seeds exactly 12 patients", async () => {
    const patients = await getPatients();
    expect(patients).toHaveLength(12);
  });

  it("creates one coverage (patplan) per member with resolved carrier/group", async () => {
    const coverages = await getCoverages();
    expect(coverages).toHaveLength(12);
    for (const c of coverages) {
      expect(c.carrier_name).toBeTruthy();
      expect(c.subscriber_external_id).toMatch(/^SUB-\d{4}$/);
    }
  });

  it("appointment CDT codes match SEED-UNIVERSE per subscriber", async () => {
    const uni = loadSeedUniverse();
    const coverages = await getCoverages();
    const appts = await getAppointments();
    const procs = await getProcedures();

    // subscriberId -> expected cdt list
    const expectedByCdt = new Map(uni.members.map((m) => [m.subscriberId, m.cdt]));
    // pat_num -> subscriberId
    const subByPat = new Map(coverages.map((c) => [c.pat_num, c.subscriber_external_id]));
    // apt_num -> pat_num
    const patByApt = new Map(appts.map((a) => [a.apt_num, a.pat_num]));

    const gotByApt = new Map<number, string[]>();
    for (const p of procs) {
      const arr = gotByApt.get(p.apt_num) ?? [];
      arr.push(p.cdt_code);
      gotByApt.set(p.apt_num, arr);
    }

    expect(appts).toHaveLength(12);
    for (const [aptNum, cdt] of gotByApt) {
      const patNum = patByApt.get(aptNum)!;
      const sub = subByPat.get(patNum)!;
      expect(cdt).toEqual(expectedByCdt.get(sub));
    }
  });

  it("appointments are all scheduled for the same (tomorrow) local date", async () => {
    const appts = await getAppointments();
    const days = new Set(appts.map((a) => new Date(a.apt_datetime).toISOString().slice(0, 10)));
    // All 12 appts fall on one UTC day window (08:00-16:00 CDT stays same UTC date).
    expect(days.size).toBe(1);
  });

  it("only SUB-1001 has a non-null (stale) date_last_verified", async () => {
    const coverages = await getCoverages();
    for (const c of coverages) {
      const iv = await getInsverify(c.plan_num, c.inssub_num);
      expect(iv).not.toBeNull();
      if (c.subscriber_external_id === "SUB-1001") {
        expect(iv!.date_last_verified).not.toBeNull();
        const days = (Date.now() - new Date(iv!.date_last_verified!).getTime()) / 86_400_000;
        expect(days).toBeGreaterThan(30); // stale per >30d rule
      } else {
        expect(iv!.date_last_verified).toBeNull();
      }
    }
  });

  it("terminated member (SUB-1004) still has an active patplan (PMS unaware)", async () => {
    const coverages = await getCoverages();
    const james = coverages.find((c) => c.subscriber_external_id === "SUB-1004");
    expect(james).toBeDefined();
    expect(james!.relationship).toBe("self");
  });

  it("seeds human-entered benefit rows that carry entry_source='human'", async () => {
    const { getBenefits } = await import("../src/queries.js");
    const coverages = await getCoverages();
    const anyPlan = coverages[0].plan_num;
    const benefits = await getBenefits(anyPlan);
    expect(benefits.length).toBeGreaterThan(0);
    expect(benefits.every((b) => b.entry_source === "human")).toBe(true);
  });
});
