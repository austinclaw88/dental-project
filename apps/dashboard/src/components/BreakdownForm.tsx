import type { BenefitBreakdown, FieldValue } from "../types";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { SourceIcon } from "./SourceIcon";
import { ArtifactLink } from "./ArtifactLink";
import { fmtDate, fmtMoney, fmtPercent } from "../lib/format";

/**
 * The canonical BenefitBreakdown rendered like the paper "insurance breakdown"
 * form the front desk fills by hand — grouped sections, and every field shows
 * value + loud H/M/L confidence badge + source icon (🌐/📠/📞/👤) + a
 * one-click provenance link where an artifact exists (PRD R6–R8, §6).
 */
export function BreakdownForm({ b }: { b: BenefitBreakdown }) {
  return (
    <div data-testid="breakdown-form">
      <Section title="Plan status">
        <Field label="Active" fv={b.planStatus.active} fmt={(v) => (v ? "Active" : "TERMINATED")} />
        <Field label="Effective date" fv={b.planStatus.effectiveDate} fmt={fmtDate} />
        <Field label="Termination date" fv={b.planStatus.terminationDate} fmt={fmtDate} />
        <Field label="Plan year start" fv={b.planStatus.planYearStart} fmt={(v) => String(v)} />
      </Section>

      <Section title="Maximums & deductibles">
        <Field label="Annual maximum" fv={b.annualMaximum.total} fmt={fmtMoney} />
        <Field label="Maximum used" fv={b.annualMaximum.used} fmt={fmtMoney} />
        <Field label="Maximum remaining" fv={b.annualMaximum.remaining} fmt={fmtMoney} />
        <Field label="Deductible (indiv.)" fv={b.deductible.individual} fmt={fmtMoney} />
        <Field label="Deductible met (indiv.)" fv={b.deductible.individualMet} fmt={fmtMoney} />
        <Field label="Deductible (family)" fv={b.deductible.family} fmt={fmtMoney} />
        <Field label="Deductible met (family)" fv={b.deductible.familyMet} fmt={fmtMoney} />
        <Field
          label="Deductible applies to"
          fv={b.deductible.appliesTo}
          fmt={(v) => (Array.isArray(v) && v.length ? v.join(", ") : "—")}
        />
      </Section>

      <Section title="Coverage by category">
        <Field label="Preventive" fv={b.categoryCoverage.preventive} fmt={fmtPercent} />
        <Field label="Basic" fv={b.categoryCoverage.basic} fmt={fmtPercent} />
        <Field label="Major" fv={b.categoryCoverage.major} fmt={fmtPercent} />
        <Field label="Ortho" fv={b.categoryCoverage.ortho} fmt={fmtPercent} />
        {b.cdtRules.map((r, i) => (
          <Field
            key={`${r.cdtFrom}-${i}`}
            label={`${r.cdtFrom}–${r.cdtTo}${r.notes ? ` (${r.notes})` : ""}`}
            fv={r.percent}
            fmt={fmtPercent}
          />
        ))}
      </Section>

      <Section title="Frequencies & history">
        {b.frequencies.length === 0 && <EmptyLine text="No frequency/history data published by payer" />}
        {b.frequencies.map((f, i) => (
          <div className="bd-field" key={`${f.key}-${i}`}>
            <span className="lbl" style={{ textTransform: "capitalize" }}>
              {f.key.replace(/_/g, " ")}
            </span>
            <span className="val">
              {valueText(f.usedCount, (v) => `${v}`)} used of {valueText(f.limit, (v) => String(v))}
              {f.lastServiceDate.value ? ` · last ${fmtDate(f.lastServiceDate.value)}` : ""}
              {f.nextEligibleDate.value ? ` · next ${fmtDate(f.nextEligibleDate.value)}` : ""}
            </span>
            <Badges fv={f.usedCount} />
          </div>
        ))}
      </Section>

      <Section title="Clauses & waiting periods">
        <Field label="Missing-tooth clause" fv={b.missingToothClause} fmt={(v) => (v ? "Yes — applies" : "No")} />
        <Field label="Assignment of benefits" fv={b.assignmentOfBenefits} fmt={(v) => (v ? "Yes" : "No")} />
        <Field label="COB rule" fv={b.cobRule} fmt={(v) => String(v).replace(/_/g, " ")} />
        <Field label="Fee schedule" fv={b.feeScheduleName} fmt={(v) => String(v)} />
        <Field label="Ortho lifetime max" fv={b.orthoLifetimeMax} fmt={fmtMoney} />
        {b.waitingPeriods.length === 0 && <EmptyLine text="No waiting periods reported" />}
        {b.waitingPeriods.map((w, i) => (
          <div className="bd-field" key={`${w.category}-${i}`}>
            <span className="lbl" style={{ textTransform: "capitalize" }}>
              Waiting period — {w.category}
            </span>
            <span className="val">
              {valueText(w.months, (v) => `${v} months`)}
              {w.endsOn.value ? ` · ends ${fmtDate(w.endsOn.value)}` : ""}
            </span>
            <Badges fv={w.months} />
          </div>
        ))}
        {b.downgrades.map((d, i) => (
          <Field
            key={`${d.key}-${i}`}
            label={`Downgrade — ${d.key.replace(/_/g, " ")}`}
            fv={d.description}
            fmt={(v) => String(v)}
          />
        ))}
      </Section>

      {b.notes.length > 0 && (
        <Section title="Notes">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {b.notes.map((n, i) => (
              <li key={i} className="muted" style={{ marginBottom: 4 }}>
                {n}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bd-section">
      <h3>{title}</h3>
      <div className="bd-grid">{children}</div>
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div className="bd-field">
      <span className="val na">{text}</span>
    </div>
  );
}

/** Render a single canonical field row from a FieldValue. */
function Field<T>({
  label,
  fv,
  fmt,
}: {
  label: string;
  fv: FieldValue<T>;
  fmt: (v: T) => string;
}) {
  const isNull = fv.value === null || fv.value === undefined;
  return (
    <div className="bd-field" data-testid="bd-field">
      <span className="lbl">{label}</span>
      {isNull ? (
        <span className="val na" data-testid="unavailable">
          {fv.unavailableReason ?? "Not published by payer"}
        </span>
      ) : (
        <span className="val">{fmt(fv.value as T)}</span>
      )}
      <Badges fv={fv} />
    </div>
  );
}

function valueText<T>(fv: FieldValue<T>, fmt: (v: T) => string): string {
  if (fv.value === null || fv.value === undefined) return fv.unavailableReason ?? "—";
  return fmt(fv.value);
}

/** Confidence badge + source icon + provenance link for a field. */
function Badges<T>({ fv }: { fv: FieldValue<T> }) {
  const p = fv.provenance;
  return (
    <span className="bd-badges">
      <ConfidenceBadge confidence={fv.confidence} />
      {p && <SourceIcon source={p.source} />}
      {p?.artifactId && <ArtifactLink artifactId={p.artifactId} locator={p.locator} />}
    </span>
  );
}
