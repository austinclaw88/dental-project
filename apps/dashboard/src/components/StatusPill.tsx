import type { DisplayStatus } from "../types";
import { STATUS_LABEL } from "../lib/format";

const ICON: Record<DisplayStatus, string> = {
  verified: "✅",
  attention: "⚠️",
  in_progress: "⏳",
  failed: "❌",
  planned: "•",
};

export function StatusPill({ status }: { status: DisplayStatus }) {
  return (
    <span className={`pill pill-${status}`} role="status" aria-label={STATUS_LABEL[status]}>
      {status === "in_progress" ? <span className="dot" aria-hidden /> : <span aria-hidden>{ICON[status]}</span>}
      {STATUS_LABEL[status]}
    </span>
  );
}
