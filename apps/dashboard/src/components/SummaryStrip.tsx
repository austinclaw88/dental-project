import type { DisplayStatus, MetricsSummary, VerificationListItem } from "../types";

export function SummaryStrip({
  items,
  metrics,
}: {
  items: VerificationListItem[];
  metrics: MetricsSummary | null;
}) {
  const count = (s: DisplayStatus) => items.filter((i) => i.displayStatus === s).length;
  const inProgress = count("in_progress") + count("planned");
  // full-auto rate from the metrics endpoint (best effort); fall back to local calc
  const rate =
    metrics?.fullAutoRate ??
    (items.length ? count("verified") / items.length : 0);

  return (
    <div className="summary" data-testid="summary-strip">
      <div className="metric">
        <div className="n">{count("verified")}</div>
        <div className="k">Verified</div>
      </div>
      <div className="metric">
        <div className="n">{count("attention")}</div>
        <div className="k">Attention</div>
      </div>
      <div className="metric">
        <div className="n">{inProgress}</div>
        <div className="k">In progress</div>
      </div>
      <div className="metric">
        <div className="n">{count("failed")}</div>
        <div className="k">Failed</div>
      </div>
      <div className="metric accent">
        <div className="n">{Math.round(rate * 100)}%</div>
        <div className="k">Full-auto</div>
      </div>
    </div>
  );
}
