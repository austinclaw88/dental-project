#!/usr/bin/env -S npx tsx
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { runAudit } from "./engine.js";
import { loadClaims, resolveMapping } from "./mapping.js";
import { consoleSummary, findingsToCsv, findingsToJson } from "./output.js";
import { renderReport } from "./report.js";
import { loadFeeSchedule } from "./schedule.js";
import { DEFAULT_TOLERANCE, type Tolerance } from "./types.js";

const USAGE = `
Recoup Audit — find and quantify dental insurance underpayments from any PMS export.

Usage:
  npm run -w @nightshift/recoup-audit audit -- --claims claims.csv [options]

Required:
  --claims <file>       CSV of paid insurance claim LINES (one row per procedure).

Options:
  --map <preset|file>   Column mapping: generic | opendental | dentrix, or a path
                        to your own mapping JSON. Default: generic.
  --fees <file>         Contracted fee schedule CSV
                        (payer_name, cdt_code, contracted_rate[, effective_from, effective_to]).
                        Without it, rates are reconstructed from your own payment history.
  --since <yyyy-mm-dd>  Ignore service dates before this.
  --until <yyyy-mm-dd>  Ignore service dates after this.
  --tolerance <dollars> Absolute tolerance floor per line. Default 1.00.
  --tolerance-pct <n>   Percentage tolerance, e.g. 1 for 1%. Default 1.
                        A line is only flagged when it misses by MORE than the
                        greater of the two.
  --out <file.html>     Write the practice-facing HTML report.
  --csv <file.csv>      Write findings as CSV.
  --json <file.json>    Write findings + coverage stats as JSON.
  --practice <name>     Practice name for the report header.
  --quiet               Suppress the console summary.
  --help                Show this message.

Examples:
  npm run -w @nightshift/recoup-audit audit -- --claims claims.csv --out report.html
  npm run -w @nightshift/recoup-audit audit -- --claims claims.csv --map opendental \\
      --fees fees.csv --since 2025-01-01 --out report.html --csv findings.csv
`;

function fail(msg: string): never {
  process.stderr.write(`\nrecoup-audit: ${msg}\n\nRun with --help for usage.\n\n`);
  process.exit(1);
}

function writeOut(path: string, contents: string): string {
  const abs = resolve(path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, contents, "utf8");
  return abs;
}

export function main(argv: string[]): void {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        claims: { type: "string" },
        map: { type: "string" },
        fees: { type: "string" },
        since: { type: "string" },
        until: { type: "string" },
        tolerance: { type: "string" },
        "tolerance-pct": { type: "string" },
        out: { type: "string" },
        csv: { type: "string" },
        json: { type: "string" },
        practice: { type: "string" },
        quiet: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
      allowPositionals: false,
    });
  } catch (e) {
    fail((e as Error).message);
  }
  const a = parsed.values;

  if (a.help || argv.length === 0) {
    process.stdout.write(USAGE);
    return;
  }
  if (!a.claims) fail("--claims <file> is required (a CSV of paid claim lines).");

  const tol: Tolerance = { ...DEFAULT_TOLERANCE };
  if (a.tolerance !== undefined) {
    const n = Number(a.tolerance);
    if (!Number.isFinite(n) || n < 0) fail(`--tolerance must be a non-negative number of dollars, got "${a.tolerance}"`);
    tol.absCents = Math.round(n * 100);
  }
  if (a["tolerance-pct"] !== undefined) {
    const n = Number(a["tolerance-pct"]);
    if (!Number.isFinite(n) || n < 0) fail(`--tolerance-pct must be a non-negative number, got "${a["tolerance-pct"]}"`);
    tol.pct = n / 100;
  }
  for (const [flag, value] of [["--since", a.since], ["--until", a.until]] as const) {
    if (value !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      fail(`${flag} must be yyyy-mm-dd, got "${value}"`);
    }
  }

  let mapping;
  try {
    mapping = resolveMapping(a.map);
  } catch (e) {
    fail((e as Error).message);
  }

  let loaded;
  try {
    loaded = loadClaims(a.claims, mapping);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") fail(`claims file not found: ${resolve(a.claims)}`);
    fail(err.message);
  }
  if (loaded.lines.length === 0) {
    fail(`no usable claim lines found in ${a.claims}. First problems:\n` +
      loaded.rejected.slice(0, 5).map((r) => `  ${r.reason}`).join("\n"));
  }

  let contractRates;
  if (a.fees) {
    try {
      contractRates = loadFeeSchedule(a.fees);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") fail(`fee schedule file not found: ${resolve(a.fees)}`);
      fail(err.message);
    }
  }

  const result = runAudit(loaded.lines, {
    contractRates,
    tolerance: tol,
    since: a.since,
    until: a.until,
  });

  if (!a.quiet) {
    process.stdout.write(consoleSummary(result));
    if (loaded.rejected.length > 0) {
      process.stdout.write(
        `Note: ${loaded.rejected.length} row(s) could not be read and were excluded. First few:\n` +
          loaded.rejected.slice(0, 3).map((r) => `  - ${r.reason}`).join("\n") +
          "\n\n",
      );
    }
    // The guards that prevent false positives run on optional columns. If they
    // are absent the audit still works, but it is flying with less instrumentation
    // — say so rather than letting the practice assume otherwise.
    const guardColumns = [
      "deductible_applied",
      "patient_portion",
      "adjustment_codes",
      "claim_ordinal",
    ] as const;
    const absent = guardColumns.filter((c) => !loaded.optionalPresent.includes(c));
    if (absent.length > 0) {
      process.stdout.write(
        `Heads up: ${absent.join(", ")} ${absent.length === 1 ? "was" : "were"} not found in your export.\n` +
          `Those columns are what rule OUT legitimate adjudication, so expect more findings to need manual review.\n\n`,
      );
    }
    if (!a.fees) {
      process.stdout.write(
        "No fee schedule supplied — rates were reconstructed from this practice's own payment history.\n" +
          "Supplying contracted schedules upgrades findings from medium to high confidence.\n\n",
      );
    }
  }

  const written: string[] = [];
  if (a.out) {
    written.push(
      writeOut(
        a.out,
        renderReport(result, {
          practiceName: a.practice,
          hasContractSchedule: Boolean(a.fees),
          sourceFile: a.claims,
        }),
      ),
    );
  }
  if (a.csv) written.push(writeOut(a.csv, findingsToCsv(result.findings)));
  if (a.json) written.push(writeOut(a.json, findingsToJson(result)));

  if (!a.quiet) {
    if (written.length > 0) {
      process.stdout.write("Written:\n" + written.map((w) => `  ${w}`).join("\n") + "\n\n");
    } else {
      process.stdout.write(
        `Nothing was written to disk. Add --out report.html for the practice-facing report, plus\n` +
          `--csv findings.csv / --json findings.json for the ${result.findings.length} finding(s) in detail.\n\n`,
      );
    }
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && /cli\.(ts|js)$/.test(process.argv[1]);
if (invokedDirectly) main(process.argv.slice(2));
