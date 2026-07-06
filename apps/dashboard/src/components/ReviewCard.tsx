"use client";
import { useMemo, useState } from "react";
import type { BenefitBreakdown, ReviewTask } from "../types";
import { fmtDate } from "../lib/format";

/** Core fields the reviewer confirms/corrects, as dot-paths into the breakdown. */
type FieldType = "number" | "boolean" | "percent";
interface FieldCfg {
  path: string;
  label: string;
  type: FieldType;
  get: (b: BenefitBreakdown) => unknown;
}

const FIELDS: FieldCfg[] = [
  { path: "planStatus.active", label: "Plan active", type: "boolean", get: (b) => b.planStatus.active.value },
  { path: "annualMaximum.total", label: "Annual maximum", type: "number", get: (b) => b.annualMaximum.total.value },
  { path: "annualMaximum.used", label: "Maximum used", type: "number", get: (b) => b.annualMaximum.used.value },
  { path: "annualMaximum.remaining", label: "Maximum remaining", type: "number", get: (b) => b.annualMaximum.remaining.value },
  { path: "deductible.individual", label: "Deductible (indiv.)", type: "number", get: (b) => b.deductible.individual.value },
  { path: "deductible.individualMet", label: "Deductible met (indiv.)", type: "number", get: (b) => b.deductible.individualMet.value },
  { path: "categoryCoverage.preventive", label: "Preventive %", type: "percent", get: (b) => b.categoryCoverage.preventive.value },
  { path: "categoryCoverage.basic", label: "Basic %", type: "percent", get: (b) => b.categoryCoverage.basic.value },
  { path: "categoryCoverage.major", label: "Major %", type: "percent", get: (b) => b.categoryCoverage.major.value },
  { path: "categoryCoverage.ortho", label: "Ortho %", type: "percent", get: (b) => b.categoryCoverage.ortho.value },
  { path: "missingToothClause", label: "Missing-tooth clause", type: "boolean", get: (b) => b.missingToothClause.value },
];

function toInput(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

/**
 * Compare current inputs against the draft and produce the `fields` payload
 * containing ONLY the dot-paths the reviewer changed or filled, coerced to type.
 * Exported for unit testing.
 */
export function buildFieldsPayload(
  draft: BenefitBreakdown,
  current: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of FIELDS) {
    const initial = toInput(f.get(draft));
    const now = (current[f.path] ?? "").trim();
    if (now === initial) continue; // unchanged
    if (now === "") continue; // reviewer cleared a field -> treat as no-op (don't send null)
    if (f.type === "boolean") {
      out[f.path] = now === "true";
    } else {
      const n = Number(now);
      if (!Number.isNaN(n)) out[f.path] = n;
    }
  }
  return out;
}

export function ReviewCard({
  task,
  onComplete,
}: {
  task: ReviewTask;
  onComplete: (id: string, fields: Record<string, unknown>, reviewer: string) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const initial = useMemo(() => {
    const m: Record<string, string> = {};
    for (const f of FIELDS) m[f.path] = toInput(f.get(task.draft));
    return m;
  }, [task]);
  const [values, setValues] = useState<Record<string, string>>(initial);

  const overdue = new Date(task.slaDueAt).getTime() < Date.now();

  async function complete() {
    setSaving(true);
    try {
      const fields = buildFieldsPayload(task.draft, values);
      await onComplete(task.id, fields, "verification-team");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card review-card" data-testid="review-card">
      <div className="review-head" onClick={() => setOpen((o) => !o)}>
        <div className="who">
          <div className="name">
            {task.patientName} <span className="muted" style={{ fontWeight: 500 }}>· {task.carrierName}</span>
          </div>
          <div className="reason">{task.reason}</div>
        </div>
        <span className={`sla ${overdue ? "overdue" : ""}`}>
          SLA {overdue ? "overdue" : `by ${fmtDate(task.slaDueAt)}`}
        </span>
        <button type="button" className="btn btn-sm" aria-expanded={open}>
          {open ? "Collapse" : "Complete review"}
        </button>
      </div>

      {open && (
        <div className="review-form">
          {FIELDS.map((f) => {
            const changed = (values[f.path] ?? "") !== initial[f.path];
            return (
              <div className="rf-row" key={f.path}>
                <label htmlFor={`rf-${task.id}-${f.path}`}>
                  {f.label} <span className="draft">({f.path})</span>
                </label>
                {f.type === "boolean" ? (
                  <select
                    id={`rf-${task.id}-${f.path}`}
                    className={changed ? "changed" : ""}
                    value={values[f.path] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [f.path]: e.target.value }))}
                  >
                    <option value="">— unknown —</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                ) : (
                  <input
                    id={`rf-${task.id}-${f.path}`}
                    className={changed ? "changed" : ""}
                    type="number"
                    inputMode="decimal"
                    placeholder={f.type === "percent" ? "%" : "$"}
                    value={values[f.path] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [f.path]: e.target.value }))}
                  />
                )}
              </div>
            );
          })}
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button type="button" className="btn btn-primary" onClick={complete} disabled={saving}>
              {saving ? "Submitting…" : "Complete review"}
            </button>
            <button type="button" className="btn" onClick={() => setValues(initial)} disabled={saving}>
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
