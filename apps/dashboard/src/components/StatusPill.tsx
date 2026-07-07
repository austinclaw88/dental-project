import type { DisplayStatus } from "../types";
import { STATUS_LABEL } from "../lib/format";

/** Inline SVG status glyphs — crisper than emoji, and the stroke carries the
 * status color while the label reads in the pill's ink tone. */
function Glyph({ status }: { status: DisplayStatus }) {
  const common = { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true } as const;
  switch (status) {
    case "verified":
      return (
        <svg {...common}>
          <path d="M3.5 8.4l3 3 6-6.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "attention":
      return (
        <svg {...common}>
          <path d="M8 2.2l6 11H2l6-11z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M8 6.4v3.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="8" cy="11.4" r="0.9" fill="currentColor" />
        </svg>
      );
    case "failed":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.6" />
          <path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    default:
      return null;
  }
}

export function StatusPill({ status }: { status: DisplayStatus }) {
  return (
    <span className={`pill pill-${status}`} role="status" aria-label={STATUS_LABEL[status]}>
      {status === "in_progress" || status === "planned" ? (
        <span className="dot" aria-hidden />
      ) : (
        <span className="ico" aria-hidden>
          <Glyph status={status} />
        </span>
      )}
      {STATUS_LABEL[status]}
    </span>
  );
}
