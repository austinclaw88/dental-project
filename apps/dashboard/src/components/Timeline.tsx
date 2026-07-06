import type { VerificationStep } from "../types";
import { fmtDuration } from "../lib/format";
import { ArtifactLink } from "./ArtifactLink";

export function Timeline({ steps }: { steps: VerificationStep[] }) {
  if (!steps.length) return <p className="muted">No steps recorded yet.</p>;
  return (
    <div className="timeline">
      {steps.map((s) => (
        <div className="tl-item" key={s.id}>
          <span className={`tl-dot ${s.status}`} aria-hidden />
          <div className="k">
            {s.kind} <span className="muted" style={{ fontWeight: 500 }}>· {s.status}</span>
          </div>
          <div className="meta">
            {s.detail ?? ""}
            {s.durationMs != null ? ` · ${fmtDuration(s.durationMs)}` : ""}
            {s.artifactId ? (
              <>
                {" · "}
                <ArtifactLink artifactId={s.artifactId} label="artifact" />
              </>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
