import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReviewCard, buildFieldsPayload } from "../components/ReviewCard";
import { buildReviewTasks } from "../lib/fixtures";

const task = buildReviewTasks()[0];

describe("buildFieldsPayload", () => {
  it("returns only the dot-paths the reviewer changed or filled", () => {
    const initial: Record<string, string> = {
      "planStatus.active": "", // draft was null
      "annualMaximum.total": "1800",
      "categoryCoverage.major": "50",
    };
    // reviewer fills active=true and changes major to 60, leaves total as-is
    const current = { ...initial, "planStatus.active": "true", "categoryCoverage.major": "60" };
    const payload = buildFieldsPayload(task.draft, {
      ...draftAsInputs(),
      "planStatus.active": "true",
      "categoryCoverage.major": "60",
    });
    expect(payload).toEqual({ "planStatus.active": true, "categoryCoverage.major": 60 });
    // unchanged numeric field must not be present
    expect(payload).not.toHaveProperty("annualMaximum.total");
    void current;
  });

  it("coerces number and boolean field types", () => {
    const payload = buildFieldsPayload(task.draft, {
      ...draftAsInputs(),
      "deductible.individual": "125",
      "missingToothClause": "false",
    });
    expect(payload["deductible.individual"]).toBe(125);
    expect(payload["missingToothClause"]).toBe(false);
    expect(typeof payload["deductible.individual"]).toBe("number");
  });
});

describe("ReviewCard", () => {
  it("sends ONLY changed fields with reviewer 'verification-team' on complete", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn().mockResolvedValue(undefined);
    render(<ReviewCard task={task} onComplete={onComplete} />);

    // expand the card
    await user.click(screen.getByRole("button", { name: /complete review/i }));

    // change one numeric core field: annual maximum
    const totalInput = screen.getByLabelText(/Annual maximum/i);
    await user.clear(totalInput);
    await user.type(totalInput, "1750");

    // confirm plan active = Yes (draft had it nulled for the reviewer to set)
    const activeSelect = screen.getByLabelText(/Plan active/i);
    await user.selectOptions(activeSelect, "true");

    await user.click(screen.getByRole("button", { name: /^Complete review$/i }));

    expect(onComplete).toHaveBeenCalledTimes(1);
    const [id, fields, reviewer] = onComplete.mock.calls[0];
    expect(id).toBe(task.id);
    expect(reviewer).toBe("verification-team");
    expect(fields).toEqual({ "annualMaximum.total": 1750, "planStatus.active": true });
  });
});

// helper: the draft rendered as its default input strings (nothing changed)
function draftAsInputs(): Record<string, string> {
  const b = task.draft;
  const s = (v: unknown) =>
    v === null || v === undefined ? "" : typeof v === "boolean" ? String(v) : String(v);
  return {
    "planStatus.active": s(b.planStatus.active.value),
    "annualMaximum.total": s(b.annualMaximum.total.value),
    "annualMaximum.used": s(b.annualMaximum.used.value),
    "annualMaximum.remaining": s(b.annualMaximum.remaining.value),
    "deductible.individual": s(b.deductible.individual.value),
    "deductible.individualMet": s(b.deductible.individualMet.value),
    "categoryCoverage.preventive": s(b.categoryCoverage.preventive.value),
    "categoryCoverage.basic": s(b.categoryCoverage.basic.value),
    "categoryCoverage.major": s(b.categoryCoverage.major.value),
    "categoryCoverage.ortho": s(b.categoryCoverage.ortho.value),
    "missingToothClause": s(b.missingToothClause.value),
  };
}
