import type { FieldSource } from "../types";
import { SOURCE_ICON, SOURCE_LABEL } from "../lib/format";

export function SourceIcon({ source }: { source: FieldSource }) {
  return (
    <span className="src" title={SOURCE_LABEL[source]} aria-label={SOURCE_LABEL[source]}>
      {SOURCE_ICON[source]}
    </span>
  );
}
