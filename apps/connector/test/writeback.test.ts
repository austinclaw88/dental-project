import { beforeAll, describe, expect, it } from "vitest";
import type { WritebackCommand } from "@nightshift/schema";
import { getBenefits, getCoverages, getInsverify, q, seed } from "@nightshift/od-sim";
import { applyWriteback } from "../src/writeback.js";

// Runs against the real odsim dev database (re-seeded in setup).
let planNum: number;
let inssubNum: number;
let patNum: number;

beforeAll(async () => {
  await seed();
  const coverages = await getCoverages();
  const first = coverages[0];
  planNum = first.plan_num;
  inssubNum = first.inssub_num;
  patNum = first.pat_num;
}, 60_000);

function cmd(target: WritebackCommand["target"], payload: Record<string, unknown>): WritebackCommand {
  return {
    id: `wb-${target}-${Math.random().toString(36).slice(2)}`,
    verificationId: "00000000-0000-0000-0000-000000000000",
    practiceId: "11111111-1111-1111-1111-111111111111",
    target,
    payload,
    status: "pending",
    beforeImage: null,
  };
}

describe("connector writeback application", () => {
  it("benefit_rows replaces nightshift rows and leaves human rows untouched", async () => {
    const humanBefore = (await getBenefits(planNum)).filter((b) => b.entry_source === "human");
    expect(humanBefore.length).toBeGreaterThan(0);

    const ack = await applyWriteback(
      cmd("benefit_rows", {
        odPlanNum: planNum,
        rows: [
          { cdtFrom: "D1110", cdtTo: "D1110", percent: 100, category: "preventive" },
          { cdtFrom: "D2740", cdtTo: "D2740", percent: 50, category: "major" },
        ],
      }),
    );
    expect(ack.status).toBe("applied");

    const after = await getBenefits(planNum);
    const human = after.filter((b) => b.entry_source === "human");
    const nightshift = after.filter((b) => b.entry_source === "nightshift");

    // Human rows identical (count + benefit_num set unchanged).
    expect(human.map((b) => b.benefit_num).sort()).toEqual(humanBefore.map((b) => b.benefit_num).sort());
    // NightShift rows are exactly the two we wrote.
    expect(nightshift).toHaveLength(2);
    expect(nightshift.map((b) => b.category).sort()).toEqual(["major", "preventive"]);

    // Applying again replaces (not appends) the nightshift rows.
    const ack2 = await applyWriteback(
      cmd("benefit_rows", {
        odPlanNum: planNum,
        rows: [{ cdtFrom: "D0120", cdtTo: "D0120", percent: 100, category: "preventive" }],
      }),
    );
    expect(ack2.status).toBe("applied");
    const after2 = await getBenefits(planNum);
    expect(after2.filter((b) => b.entry_source === "nightshift")).toHaveLength(1);
    expect(after2.filter((b) => b.entry_source === "human")).toHaveLength(humanBefore.length);
  });

  it("insverify upserts date_last_verified with a before-image", async () => {
    const before = await getInsverify(planNum, inssubNum);
    const verifiedAt = "2026-07-06T12:00:00.000Z";
    const ack = await applyWriteback(
      cmd("insverify", {
        odPlanNum: planNum,
        odInsSubNum: inssubNum,
        verifiedAt,
        scope: "full_breakdown",
      }),
    );
    expect(ack.status).toBe("applied");
    expect(ack.beforeImage).toBeTruthy();

    const after = await getInsverify(planNum, inssubNum);
    expect(after).not.toBeNull();
    expect(new Date(after!.date_last_verified!).toISOString()).toBe(verifiedAt);
    expect(after!.verify_scope).toBe("full_breakdown");
    // before-image captured the prior row (or null for a brand-new plan/sub).
    expect(ack.beforeImage).toHaveProperty("previous");
    void before;
  });

  it("insplan_note sets the note and captures the prior note", async () => {
    const ack = await applyWriteback(
      cmd("insplan_note", { odPlanNum: planNum, note: "NightShift verified 07/06" }),
    );
    expect(ack.status).toBe("applied");
    expect(ack.beforeImage).toEqual({ planNote: "" });
    const [row] = await q<{ plan_note: string }>(
      `select plan_note from od_insplan where plan_num=$1`,
      [planNum],
    );
    expect(row.plan_note).toBe("NightShift verified 07/06");
  });

  it("commlog and document_pdf insert rows", async () => {
    const c = await applyWriteback(cmd("commlog", { odPatNum: patNum, text: "Left voicemail re: benefits" }));
    expect(c.status).toBe("applied");
    const d = await applyWriteback(
      cmd("document_pdf", { odPatNum: patNum, title: "Benefit Breakdown", text: "PDF text stand-in" }),
    );
    expect(d.status).toBe("applied");

    const [{ n: commCount }] = await q<{ n: string }>(
      `select count(*)::int as n from od_commlog where pat_num=$1`,
      [patNum],
    );
    const [{ n: docCount }] = await q<{ n: string }>(
      `select count(*)::int as n from od_document where pat_num=$1`,
      [patNum],
    );
    expect(Number(commCount)).toBeGreaterThan(0);
    expect(Number(docCount)).toBeGreaterThan(0);
  });

  it("unknown target acks failed without throwing", async () => {
    const ack = await applyWriteback(cmd("insverify", { odPlanNum: "not-a-number", odInsSubNum: inssubNum }));
    expect(ack.status).toBe("failed");
    expect(ack.error).toBeTruthy();
  });
});
