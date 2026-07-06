import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueueRow } from "../components/QueueRow";
import { buildDayItems, defaultDate } from "../lib/fixtures";
import type { VerificationListItem } from "../types";

const items = buildDayItems(defaultDate());
const byName = (n: string): VerificationListItem =>
  items.find((i) => i.patientName === n)!;

const noop = vi.fn();

describe("QueueRow", () => {
  it("renders a clean verified row with patient, provider, carrier and CDT chips", () => {
    render(<QueueRow item={byName("Alice Nguyen")} onReverify={noop} onResolve={noop} />);
    expect(screen.getByText("Alice Nguyen")).toBeInTheDocument();
    expect(screen.getByText("Dr. Chen")).toBeInTheDocument();
    expect(screen.getByText("Delta Dental MockState")).toBeInTheDocument();
    expect(screen.getByText("D1110")).toBeInTheDocument();
    expect(screen.getByText("D0274")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Verified");
  });

  it("renders each display status pill", () => {
    const cases: Array<[string, string]> = [
      ["Alice Nguyen", "Verified"],
      ["Marcus Webb", "Attention"],
      ["Luis Romero", "In progress"],
      ["Dev Patel", "Failed"],
    ];
    for (const [name, label] of cases) {
      const { unmount } = render(
        <QueueRow item={byName(name)} onReverify={noop} onResolve={noop} />,
      );
      expect(screen.getByRole("status")).toHaveTextContent(label);
      unmount();
    }
  });

  it("shows the frequency-conflict exception message inline (why it matters today)", () => {
    render(<QueueRow item={byName("Marcus Webb")} onReverify={noop} onResolve={noop} />);
    const exc = screen.getByTestId("exception-row");
    expect(exc).toHaveTextContent(/2\/2 prophylaxis benefits used/);
    expect(exc.className).toContain("exc-warning");
    expect(screen.getByRole("button", { name: /resolve/i })).toBeInTheDocument();
  });

  it("marks a terminated coverage as a critical exception", () => {
    render(<QueueRow item={byName("James Porter")} onReverify={noop} onResolve={noop} />);
    const exc = screen.getByTestId("exception-row");
    expect(exc).toHaveTextContent(/TERMINATED 05\/31\/2026/);
    expect(exc.className).toContain("exc-critical");
  });

  it("disables Re-verify while the row is in progress", () => {
    render(<QueueRow item={byName("Luis Romero")} onReverify={noop} onResolve={noop} />);
    expect(screen.getByRole("button", { name: /re-verifying/i })).toBeDisabled();
  });

  it("links to the detail page", () => {
    render(<QueueRow item={byName("Alice Nguyen")} onReverify={noop} onResolve={noop} />);
    expect(screen.getByRole("link", { name: /details/i })).toHaveAttribute(
      "href",
      "/verifications/v-1001",
    );
  });
});
