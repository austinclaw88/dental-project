import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { BreakdownForm } from "../components/BreakdownForm";
import { buildDetail } from "../lib/fixtures";

function breakdownFor(id: string) {
  const d = buildDetail(id);
  if (!d?.snapshot) throw new Error(`no snapshot for ${id}`);
  return d.snapshot.breakdown;
}

describe("BreakdownForm", () => {
  it("renders the paper-form sections", () => {
    render(<BreakdownForm b={breakdownFor("v-1001")} />);
    for (const section of [
      "Plan status",
      "Maximums & deductibles",
      "Coverage by category",
      "Frequencies & history",
      "Clauses & waiting periods",
    ]) {
      expect(screen.getByRole("heading", { name: section })).toBeInTheDocument();
    }
  });

  it("shows loud confidence badges (H/M/L) on fields", () => {
    render(<BreakdownForm b={breakdownFor("v-1001")} />);
    const badges = screen.getAllByTestId("confidence-badge");
    expect(badges.length).toBeGreaterThan(5);
    // clean Delta portal capture -> high-confidence badges present
    expect(badges.some((b) => b.textContent === "H")).toBe(true);
    expect(badges.some((b) => b.className.includes("conf-high"))).toBe(true);
  });

  it("renders a medium-confidence badge for a voice-sourced field", () => {
    render(<BreakdownForm b={breakdownFor("v-1008")} />);
    const badges = screen.getAllByTestId("confidence-badge");
    expect(badges.some((b) => b.textContent === "M")).toBe(true);
  });

  it('renders unavailable fields as "Not published by payer", never blank', () => {
    // MetLife is the sparse payer: COB / missing-tooth / fee schedule not published
    render(<BreakdownForm b={breakdownFor("v-1006")} />);
    const unavailable = screen.getAllByTestId("unavailable");
    expect(unavailable.length).toBeGreaterThan(0);
    expect(unavailable.some((n) => /not published by payer/i.test(n.textContent || ""))).toBe(true);
  });

  it("shows the termination date value for a terminated plan", () => {
    render(<BreakdownForm b={breakdownFor("v-1004")} />);
    const field = screen.getByText("Termination date").closest(".bd-field")!;
    expect(within(field as HTMLElement).getByText(/05\/31\/2026/)).toBeInTheDocument();
    expect(screen.getByText("TERMINATED")).toBeInTheDocument();
  });
});
