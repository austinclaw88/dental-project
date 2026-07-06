import type { Confidence } from "../types";
import { CONFIDENCE_LABEL, CONFIDENCE_WORD } from "../lib/format";

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return (
    <span
      className={`conf conf-${confidence}`}
      title={CONFIDENCE_WORD[confidence]}
      aria-label={CONFIDENCE_WORD[confidence]}
      data-testid="confidence-badge"
    >
      {CONFIDENCE_LABEL[confidence]}
    </span>
  );
}
