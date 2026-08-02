/**
 * Library entrypoint — the surface other workspaces (currently @nightshift/recoup-web)
 * import. Pure re-exports: no logic lives here, so importing the engine from a server
 * is exactly the same code path the CLI takes.
 *
 * Import as:  import { runAudit, renderReport } from "@nightshift/recoup-audit/lib";
 */

export * from "./types.js";
export { parseCsv, toCsv, type CsvRow, type CsvTable } from "./csv.js";
export {
  fmtMoney,
  fmtMoneyRounded,
  fmtPct,
  parseMoney,
  parseMoneyRequired,
} from "./money.js";
export {
  GENERIC_MAPPING,
  OPTIONAL_FIELDS,
  PRESET_DIR,
  REQUIRED_FIELDS,
  hashSubscriber,
  loadClaims,
  loadMappingFile,
  loadPreset,
  mapTable,
  normalizeCdt,
  normalizePayer,
  resolveMapping,
  validateMapping,
  type CanonicalField,
  type MapResult,
  type Mapping,
  type MappingOptions,
  type OptionalField,
  type RequiredField,
} from "./mapping.js";
export {
  MIN_MODE_SHARE,
  MIN_SUPPORT,
  RateBook,
  buildRateBook,
  loadFeeSchedule,
  parseFeeSchedule,
  type ContractRateRow,
} from "./schedule.js";
export { runAudit, summarize, type AuditOptions } from "./engine.js";
export { renderReport, type ReportOptions } from "./report.js";
export {
  FINDINGS_CSV_HEADERS,
  consoleSummary,
  findingsToCsv,
  findingsToJson,
} from "./output.js";
export { DEFAULT_SEED, generateDataset, type SyntheticDataset } from "./synthetic.js";
export {
  reconcile,
  reconciliationText,
  runDemoPipeline,
  type DemoRun,
  type Reconciliation,
} from "./demo.js";
