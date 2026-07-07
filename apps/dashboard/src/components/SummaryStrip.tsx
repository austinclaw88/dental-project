import type { DisplayStatus, MetricsSummary, VerificationListItem } from "../types";

/** The four status tiles are filters; clicking one filters the queue to that
 * status (click again to clear). Full-auto % is the product KPI — not a
 * filter, visually distinct. */
type FilterKey = "verified" | "attention" | "in_progress" | "failed";

const TILES: { key: FilterKey; label: string; statuses: DisplayStatus[] }[] = [
  { key: "verified", label: "Verified", statuses: ["verified"] },
  { key: "attention", label: "Attention", statuses: ["attention"] },
  { key: "in_progress", label: "In progress", statuses: ["in_progress", "planned"] },
  { key: "failed", label: "Failed", statuses: ["failed"] },
];

export function SummaryStrip({
  items,
  metrics,
  active,
  onFilter,
}: {
  items: VerificationListItem[];
  metrics: MetricsSummary | null;
  active: FilterKey | null;
  onFilter: (key: FilterKey | null) => void;
}) {
  const count = (statuses: DisplayStatus[]) =>
    items.filter((i) => statuses.includes(i.displayStatus)).length;
  const rate =
    metrics?.fullAutoRate ??
    (items.length ? count(["verified"]) / items.length : 0);

  return (
    <div className="summary" data-testid="summary-strip">
      {TILES.map((t) => {
        const n = count(t.statuses);
        const isActive = active === t.key;
        return (
          <button
            key={t.key}
            type="button"
            className={`metric s-${t.key}${isActive ? " active" : ""}`}
            aria-pressed={isActive}
            onClick={() => onFilter(isActive ? null : t.key)}
          >
            <div className="n">
              <span className="tick" aria-hidden />
              {n}
            </div>
            <div className="k">{t.label}</div>
          </button>
        );
      })}
      <div className="metric kpi" title="Share of appointments verified with no human touch">
        <div className="n">{Math.round(rate * 100)}%</div>
        <div className="k">Full-auto</div>
        <div className="kpihint">no human touch</div>
      </div>
    </div>
  );
}
