import type { WritebackCommand } from "../types";

const TARGET_LABEL: Record<WritebackCommand["target"], string> = {
  benefit_rows: "Benefit rows",
  insplan_note: "Insurance plan note",
  insverify: "Verification status (insverify)",
  commlog: "Commlog entry",
  document_pdf: "Patient document (PDF)",
};

export function Writebacks({ writebacks }: { writebacks: WritebackCommand[] }) {
  if (!writebacks.length) return <p className="muted">No writebacks — nothing written to OpenDental yet.</p>;
  return (
    <div>
      {writebacks.map((w) => (
        <div className="wb" key={w.id}>
          <span className="t">{TARGET_LABEL[w.target]}</span>
          <span className={`wb-status wb-${w.status}`}>{w.status}</span>
          <span className="muted" style={{ fontSize: 13 }}>
            {summarize(w)}
          </span>
        </div>
      ))}
    </div>
  );
}

function summarize(w: WritebackCommand): string {
  const p = w.payload as Record<string, unknown>;
  if (w.target === "benefit_rows") return `${Array.isArray(p.rows) ? p.rows.length : "?"} benefit rows`;
  if (w.target === "insverify") return `verified ${p.scope ?? ""}`;
  if (w.target === "insplan_note") return "plan note updated";
  if (w.target === "commlog") return "front-desk summary";
  return "";
}
