/**
 * Recoup Audit web front end.
 *
 * Three screens, server-rendered, no framework and no build step:
 *
 *   GET  /            landing — upload zones, advanced settings, sample-audit path
 *   POST /upload      parse headers, auto-detect columns, render the mapping screen
 *   POST /run         run the engine synchronously, 302 to the results page
 *   GET  /runs/:id    results — thin bar + the engine's own report in a frame
 *   GET  /demo        the deterministic synthetic dataset, audited, same page
 *
 * The engine is imported, not shelled out to: `@nightshift/recoup-audit/lib` is the
 * same code the CLI runs, so a web audit and a terminal audit of the same file
 * produce the same findings.
 */

import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import {
  DEFAULT_TOLERANCE,
  findingsToCsv,
  findingsToJson,
  mapTable,
  parseCsv,
  parseFeeSchedule,
  renderReport,
  runAudit,
  runDemoPipeline,
  type ContractRateRow,
  type CsvTable,
  type Tolerance,
} from "@nightshift/recoup-audit/lib";
import {
  ALL_FIELDS,
  autoDetect,
  autoDetectFees,
  detectionToSelection,
  toMapping,
  type FeeDetection,
} from "./detect.js";
import { RunStore, RUN_TTL_MS, SWEEP_INTERVAL_MS, type RunMeta } from "./store.js";
import { errorPage, notFoundPage } from "./views/error.js";
import { landingPage } from "./views/landing.js";
import { mappingPage, type MappingViewModel } from "./views/mapping.js";
import { resultsPage } from "./views/results.js";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const PREVIEW_ROWS = 5;

export interface ServerOptions {
  /** Where run directories live. Tests point this at a temp dir. */
  runRoot?: string;
  /** Disable the background sweep timer (tests drive `sweepNow()` directly). */
  disableSweep?: boolean;
  ttlMs?: number;
  sweepIntervalMs?: number;
  logger?: boolean;
}

declare module "fastify" {
  interface FastifyInstance {
    runs: RunStore;
    sweepNow: () => string[];
  }
}

interface UploadSettings {
  practice?: string;
  since?: string;
  until?: string;
  tolerance: string;
  tolerancePct: string;
}

/* ------------------------------------------------------------------ helpers */

function html(reply: FastifyReply, status: number, body: string): FastifyReply {
  return reply.status(status).type("text/html; charset=utf-8").send(body);
}

/**
 * Content sniff. A dental export is text; anything with NUL bytes or a binary
 * signature is a mis-drag (a PDF EOB, an .xlsx) and is rejected before it reaches
 * the CSV parser, where it would produce a baffling error instead of a clear one.
 */
export function sniffText(buf: Buffer): { ok: true } | { ok: false; reason: string } {
  if (buf.length === 0) return { ok: false, reason: "The file is empty — there are no bytes in it at all." };

  const head = buf.subarray(0, Math.min(buf.length, 8192));
  const signatures: Array<[string, string]> = [
    ["%PDF", "a PDF"],
    ["PK", "a zip archive (an .xlsx or .docx is a zip)"],
    ["ÐÏà", "a legacy Microsoft Office file (.xls / .doc)"],
    ["PNG", "a PNG image"],
    ["ÿØÿ", "a JPEG image"],
    ["SQLite format", "a SQLite database"],
  ];
  const latin1 = head.toString("latin1");
  for (const [sig, what] of signatures) {
    if (latin1.startsWith(sig)) return { ok: false, reason: `This looks like ${what}, not a CSV.` };
  }

  if (head.includes(0x00)) {
    return {
      ok: false,
      reason: "This file contains binary data, so it is not a CSV (a UTF-16 export can also look like this).",
    };
  }

  // Control characters other than tab/CR/LF/form-feed: a text file has almost none.
  let control = 0;
  for (const b of head) {
    if (b < 0x09 || (b > 0x0d && b < 0x20)) control++;
  }
  if (control / head.length > 0.01) {
    return { ok: false, reason: "This file is not readable as text, so it cannot be a CSV." };
  }
  return { ok: true };
}

function parseTolerance(settings: UploadSettings): Tolerance {
  const tol: Tolerance = { ...DEFAULT_TOLERANCE };
  const abs = Number(settings.tolerance);
  if (Number.isFinite(abs) && abs >= 0) tol.absCents = Math.round(abs * 100);
  const pct = Number(settings.tolerancePct);
  if (Number.isFinite(pct) && pct >= 0) tol.pct = pct / 100;
  return tol;
}

function cleanDate(v: string | undefined): string | undefined {
  return v !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : undefined;
}

function settingsFromFields(fields: Record<string, string>): UploadSettings {
  return {
    practice: (fields.practice ?? "").trim() || undefined,
    since: cleanDate(fields.since),
    until: cleanDate(fields.until),
    tolerance: (fields.tolerance ?? "1.00").trim() || "1.00",
    tolerancePct: (fields.tolerancePct ?? "1").trim() || "1",
  };
}

function previewOf(table: CsvTable): Array<Record<string, string>> {
  return table.rows.slice(0, PREVIEW_ROWS).map((r) => {
    const out: Record<string, string> = {};
    for (const h of table.headers) out[h] = (r[h] ?? "").slice(0, 60);
    return out;
  });
}

/* ------------------------------------------------------------------- server */

export function buildServer(opts: ServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: MAX_UPLOAD_BYTES });
  const runs = new RunStore(opts.runRoot);
  const ttlMs = opts.ttlMs ?? RUN_TTL_MS;

  app.decorate("runs", runs);
  app.decorate("sweepNow", () => runs.sweep(ttlMs));

  // The TTL is a promise made on the landing page, so it is enforced on boot and
  // on a timer — never left to an operator remembering to prune a directory.
  runs.sweep(ttlMs);
  if (opts.disableSweep !== true) {
    const timer = setInterval(() => {
      try {
        runs.sweep(ttlMs);
      } catch {
        /* a transient fs error must never take the server down */
      }
    }, opts.sweepIntervalMs ?? SWEEP_INTERVAL_MS);
    timer.unref();
    app.addHook("onClose", async () => clearInterval(timer));
  }

  app.register(multipart, {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 2, fields: 20, fieldSize: 4096 },
  });

  // The mapping form is a plain urlencoded POST. Ten lines of URLSearchParams
  // beats a dependency for a form with seventeen selects.
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_req, body, done) => {
      try {
        const out: Record<string, string> = {};
        for (const [k, v] of new URLSearchParams(body as string)) out[k] = v;
        done(null, out);
      } catch (e) {
        done(e as Error);
      }
    },
  );

  /* ---------------------------------------------------------- 1. landing */

  app.get("/", async (_req, reply) => html(reply, 200, landingPage()));

  app.get("/healthz", async () => ({ ok: true }));

  /* ----------------------------------------------------- 2. upload → map */

  app.post("/upload", async (req: FastifyRequest, reply) => {
    const fields: Record<string, string> = {};
    const files: Record<string, { filename: string; buf: Buffer }> = {};

    try {
      for await (const part of req.parts()) {
        if (part.type === "file") {
          const buf = await part.toBuffer();
          if (part.file.truncated) {
            return html(
              reply,
              413,
              errorPage({
                title: "That file is too large",
                summary: `${part.filename} is over the 25 MB limit for this tool.`,
                fixes: [
                  "Twelve months of claim lines for a single practice is normally 1–5 MB. A file this size usually means the export included every claim ever filed, or it is not a CSV.",
                  "Re-export with a service-date filter of the last twelve months.",
                  "A production deployment would stream large files to object storage and audit them on a queue; this build audits synchronously in memory, so it caps the input.",
                ],
              }),
            );
          }
          if (buf.length > 0) files[part.fieldname] = { filename: part.filename, buf };
        } else {
          fields[part.fieldname] = String(part.value ?? "");
        }
      }
    } catch (e) {
      const msg = (e as Error).message;
      return html(
        reply,
        413,
        errorPage({
          title: "That upload could not be read",
          summary: "The browser stopped sending the file before it arrived in full.",
          detail: msg,
          fixes: ["The limit is 25 MB per file and two files per upload.", "Try again, or re-export a smaller date range."],
        }),
      );
    }

    const claims = files.claims;
    if (claims === undefined) {
      return html(reply, 400, landingPage("Choose a claims CSV before continuing — that file is the audit."));
    }

    const sniff = sniffText(claims.buf);
    if (!sniff.ok) {
      return html(
        reply,
        415,
        errorPage({
          title: "That is not a CSV",
          summary: `${claims.filename} could not be read as text. ${sniff.reason}`,
          fixes: [
            "Export as <strong>CSV (comma delimited)</strong> from your practice management system, not as PDF, Excel or a report printout.",
            "In Excel: <em>File → Save As → CSV UTF-8 (Comma delimited) (*.csv)</em>.",
            "If the export is a PDF of EOBs rather than a data export, this tool cannot read it — it reads the PMS's own claim table.",
          ],
        }),
      );
    }

    const text = claims.buf.toString("utf8");
    let table: CsvTable;
    try {
      table = parseCsv(text);
    } catch (e) {
      return html(
        reply,
        400,
        errorPage({
          title: "That CSV could not be parsed",
          summary: `Something in ${claims.filename} broke the CSV reader.`,
          detail: (e as Error).message,
          fixes: [
            "Check the file opens cleanly in a spreadsheet program.",
            "Semicolon- or tab-separated exports are not supported yet — re-export with commas.",
          ],
        }),
      );
    }

    if (table.headers.length === 0) {
      return html(
        reply,
        400,
        errorPage({
          title: "That CSV has no header row",
          summary: `${claims.filename} contains no readable header row, so there are no columns to map.`,
          fixes: [
            "The first line of the file must be the column names.",
            "If your export puts a report title or a date range above the headers, delete those rows and re-upload.",
          ],
        }),
      );
    }
    if (table.rows.length === 0) {
      return html(
        reply,
        400,
        errorPage({
          title: "That CSV has headers but no data",
          summary: `${claims.filename} has a header row and nothing under it — there is nothing to audit.`,
          fixes: [
            "Check the export's date filter: a window with no paid claims produces an empty file.",
            "Confirm you exported claim <em>lines</em> (one row per procedure), not a summary report.",
          ],
        }),
      );
    }

    const settings = settingsFromFields(fields);
    const id = runs.create();
    runs.write(id, "claims.csv", claims.buf);

    let feeDetection: FeeDetection[] | undefined;
    let feeError: string | undefined;
    const fees = files.fees;
    if (fees !== undefined) {
      const feeSniff = sniffText(fees.buf);
      if (!feeSniff.ok) {
        feeError = feeSniff.reason;
      } else {
        try {
          const feeTable = parseCsv(fees.buf.toString("utf8"));
          feeDetection = autoDetectFees(feeTable.headers);
          const missing = feeDetection.filter((f) => f.required && f.header === undefined);
          if (missing.length > 0) {
            feeError = `It is missing required column(s): ${missing.map((f) => f.field).join(", ")}. Headers present: [${feeTable.headers.join(", ")}].`;
          } else {
            runs.write(id, "fees.csv", fees.buf);
          }
        } catch (e) {
          feeError = (e as Error).message;
        }
      }
    }

    runs.write(
      id,
      "upload.json",
      JSON.stringify(
        {
          claimsFilename: claims.filename,
          feesFilename: fees?.filename,
          settings,
          headers: table.headers,
          rowCount: table.rows.length,
        },
        null,
        2,
      ),
    );

    const vm: MappingViewModel = {
      runId: id,
      claimsFilename: claims.filename,
      feesFilename: fees?.filename,
      headers: table.headers,
      previewRows: previewOf(table),
      totalRows: table.rows.length,
      detection: autoDetect(table.headers),
      feeDetection,
      feeError,
      settings,
    };
    return html(reply, 200, mappingPage(vm));
  });

  /* --------------------------------------------------------- 3. run audit */

  app.post("/run", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, string>;
    const id = String(body.runId ?? "");

    if (!runs.exists(id)) {
      return html(
        reply,
        404,
        notFoundPage("The upload behind this mapping screen has expired or was never stored."),
      );
    }

    const csvText = runs.read(id, "claims.csv");
    if (csvText === undefined) {
      return html(reply, 404, notFoundPage("The uploaded claims file for this run is no longer on disk."));
    }

    const upload = JSON.parse(runs.read(id, "upload.json") ?? "{}") as {
      claimsFilename?: string;
      feesFilename?: string;
    };
    const settings = settingsFromFields(body);

    const selection: Record<string, string> = {};
    for (const field of ALL_FIELDS) {
      const v = (body[`col_${field}`] ?? "").trim();
      if (v !== "") selection[field] = v;
    }

    const table = parseCsv(csvText);
    const missing = (["claim_id", "service_date", "payer_name", "cdt_code", "billed_fee", "allowed_amount", "paid_amount"] as const)
      .filter((f) => selection[f] === undefined);
    if (missing.length > 0) {
      return html(
        reply,
        400,
        errorPage({
          title: "Some required columns are still unmapped",
          summary:
            "The audit needs all seven required fields before it can compare a payment to a rate. " +
            `Unmapped: ${missing.join(", ")}.`,
          fixes: [
            "Go back and pick a column for each highlighted row.",
            "<strong>allowed_amount</strong> is the field most exports omit and the one nothing substitutes for. If your export has billed, paid and write-off but no allowed amount, add a computed column <code>allowed = billed − write-off</code> and re-export.",
          ],
          backHref: "/",
          backLabel: "← Start over",
        }),
      );
    }

    let mapped;
    try {
      mapped = mapTable(table, toMapping(selection));
    } catch (e) {
      return html(
        reply,
        400,
        errorPage({
          title: "The file could not be read with that mapping",
          summary: "The audit engine refused the column mapping you confirmed.",
          detail: (e as Error).message,
          fixes: ["Start over and check each dropdown against the preview rows."],
        }),
      );
    }

    if (mapped.lines.length === 0) {
      const sample = mapped.rejected.slice(0, 5).map((r) => `  row ${r.rowIndex}: ${r.reason}`).join("\n");
      return html(
        reply,
        400,
        errorPage({
          title: "No usable rows in that file",
          summary: `All ${table.rows.length.toLocaleString("en-US")} data rows were rejected, so there is nothing to audit.`,
          detail: sample || undefined,
          fixes: [
            "The usual cause is a mapping that points at the wrong column — a date field mapped to a money column, for example.",
            "Blank required cells also reject a row: every line needs a service date, a payer, a CDT code, and billed / allowed / paid amounts.",
            "Rows where the allowed amount is <code>-1</code> (Open Dental's \"not set\") are rejected by design rather than silently audited.",
          ],
        }),
      );
    }

    let contractRates: ContractRateRow[] = [];
    const feesText = runs.read(id, "fees.csv");
    if (feesText !== undefined) {
      try {
        contractRates = parseFeeSchedule(feesText, upload.feesFilename ?? "fee schedule");
      } catch {
        contractRates = [];
      }
    }

    const tolerance = parseTolerance(settings);
    let result;
    try {
      result = runAudit(mapped.lines, {
        contractRates,
        tolerance,
        since: settings.since,
        until: settings.until,
      });
    } catch (e) {
      return html(
        reply,
        500,
        errorPage({
          title: "The audit failed to run",
          summary: "The engine reached the mapped data but could not complete the audit.",
          detail: (e as Error).message,
          fixes: [
            "This is a bug worth reporting — the message above is the whole of what the engine knows.",
            "Re-running the same file will reproduce it: the engine is deterministic.",
          ],
        }),
      );
    }

    if (result.totals.linesAudited === 0) {
      return html(
        reply,
        400,
        errorPage({
          title: "No claim lines fell inside that date window",
          summary: `Every row was excluded by the service-date window (${settings.since ?? "…"} to ${settings.until ?? "…"}).`,
          fixes: [
            "Widen or clear the date range under <em>Advanced settings</em> and upload again.",
            "Check the service dates in the preview — an export in <code>dd/mm/yyyy</code> order will parse as a different month.",
          ],
        }),
      );
    }

    const reportHtml = renderReport(result, {
      practiceName: settings.practice ?? "Your practice",
      hasContractSchedule: contractRates.length > 0,
      sourceFile: upload.claimsFilename,
    });

    const meta: RunMeta = {
      id,
      createdAt: new Date().toISOString(),
      practiceName: settings.practice,
      claimsFilename: upload.claimsFilename ?? "claims.csv",
      feesFilename: feesText !== undefined ? upload.feesFilename : undefined,
      mapping: selection,
      tolerance: { absoluteDollars: tolerance.absCents / 100, percent: tolerance.pct * 100 },
      since: settings.since,
      until: settings.until,
      linesAudited: result.totals.linesAudited,
      rowsRejected: mapped.rejected.length,
      candidateDollars: result.totals.candidateTotal / 100,
      findings: result.findings.length,
      hasContractSchedule: contractRates.length > 0,
      isDemo: false,
    };

    runs.write(id, "report.html", reportHtml);
    runs.write(id, "findings.csv", findingsToCsv(result.findings));
    runs.write(id, "findings.json", findingsToJson(result));
    runs.write(id, "meta.json", JSON.stringify(meta, null, 2));

    return reply.redirect(`/runs/${id}`, 302);
  });

  /* --------------------------------------------------------- 4. the demo */

  app.get("/demo", async (_req, reply) => {
    const demo = runDemoPipeline();
    const id = runs.create();

    const meta: RunMeta = {
      id,
      createdAt: new Date().toISOString(),
      practiceName: "Demo Family Dental (synthetic data)",
      claimsFilename: "demo-claims.csv",
      mapping: detectionToSelection(autoDetect(parseCsv(demo.dataset.csv).headers)) as Record<string, string>,
      tolerance: { absoluteDollars: 1, percent: 1 },
      linesAudited: demo.result.totals.linesAudited,
      rowsRejected: 0,
      candidateDollars: demo.result.totals.candidateTotal / 100,
      findings: demo.result.findings.length,
      hasContractSchedule: false,
      isDemo: true,
    };

    runs.write(id, "claims.csv", demo.dataset.csv);
    runs.write(id, "fees-available.csv", demo.dataset.feesCsv);
    runs.write(id, "report.html", demo.html);
    runs.write(id, "findings.csv", findingsToCsv(demo.result.findings));
    runs.write(id, "findings.json", findingsToJson(demo.result));
    runs.write(id, "meta.json", JSON.stringify(meta, null, 2));

    return html(reply, 200, resultsPage(meta));
  });

  /** The demo's own synthetic claims CSV, so a prospect can try the upload flow. */
  app.get("/demo/claims.csv", async (_req, reply) => {
    const demo = runDemoPipeline();
    return reply
      .type("text/csv; charset=utf-8")
      .header("content-disposition", 'attachment; filename="demo-claims.csv"')
      .send(demo.dataset.csv);
  });

  /* ------------------------------------------------------- 5. results/dl */

  app.get<{ Params: { id: string } }>("/runs/:id", async (req, reply) => {
    const meta = runs.isComplete(req.params.id) ? runs.meta(req.params.id) : undefined;
    if (meta === undefined) {
      return html(reply, 404, notFoundPage("No audit exists at this address."));
    }
    return html(reply, 200, resultsPage(meta));
  });

  const DOWNLOADS: Record<string, { type: string; disposition?: string }> = {
    "report.html": { type: "text/html; charset=utf-8" },
    "findings.csv": { type: "text/csv; charset=utf-8", disposition: "attachment" },
    "findings.json": { type: "application/json; charset=utf-8", disposition: "attachment" },
  };

  app.get<{ Params: { id: string; file: string } }>("/runs/:id/:file", async (req, reply) => {
    const spec = DOWNLOADS[req.params.file];
    if (spec === undefined) {
      return html(reply, 404, notFoundPage("There is no such file in this run."));
    }
    const body = runs.read(req.params.id, req.params.file);
    if (body === undefined) {
      return html(reply, 404, notFoundPage("No audit exists at this address."));
    }
    reply.type(spec.type).header("cache-control", "no-store");
    if (spec.disposition !== undefined) {
      reply.header("content-disposition", `${spec.disposition}; filename="${req.params.file}"`);
    }
    return reply.send(body);
  });

  /* ------------------------------------------------------------ fallback */

  app.setNotFoundHandler(async (_req, reply) =>
    html(reply, 404, notFoundPage("There is no page at this address.")),
  );

  app.setErrorHandler(async (error: unknown, _req, reply) => {
    const err = error as Error & { statusCode?: number };
    const status = err.statusCode !== undefined && err.statusCode >= 400 ? err.statusCode : 500;
    return html(
      reply,
      status,
      errorPage({
        title: status === 413 ? "That upload is too large" : "Something went wrong",
        summary:
          status === 413
            ? "The file exceeded the 25 MB upload limit."
            : "The server could not complete that request.",
        detail: err.message,
        fixes: ["Start over and try again. Nothing was retained from the failed attempt."],
      }),
    );
  });

  return app;
}
