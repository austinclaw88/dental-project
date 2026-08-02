/**
 * The whole flow, through fastify.inject(): landing → upload → mapping → run →
 * results → downloads. The claims and fee CSVs come from the engine's own
 * deterministic synthetic generator, so this test audits the same bytes the CLI
 * demo does — no fixture files, no drift between the two.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SEED, generateDataset, type SyntheticDataset } from "@nightshift/recoup-audit/lib";
import { ALL_FIELDS, autoDetect } from "../src/detect.js";
import { formBody, harness, multipartBody, selectedOption, type Harness } from "./helpers.js";

let h: Harness;
let dataset: SyntheticDataset;

beforeAll(async () => {
  h = await harness();
  dataset = generateDataset(DEFAULT_SEED);
});
afterAll(async () => h.close());

function runIdFrom(html: string): string {
  const m = /name="runId" value="([0-9a-z]+)"/.exec(html);
  expect(m, "mapping screen carries a run id").not.toBeNull();
  return m![1]!;
}

/** Turn the mapping screen's preselected dropdowns into the POST /run body. */
function mappingFieldsFromScreen(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of ALL_FIELDS) {
    const v = selectedOption(html, field);
    if (v !== undefined && v !== "") out[`col_${field}`] = v;
  }
  return out;
}

describe("landing", () => {
  it("serves a calm upload page with both zones and the sample path", async () => {
    const res = await h.app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    const body = res.body;
    expect(body).toContain("Find out what insurance actually owes you");
    expect(body).toContain('name="claims"');
    expect(body).toContain('name="fees"');
    expect(body).toContain("See a sample audit");
    expect(body).toContain("Advanced settings");
    // The privacy promise and the caveat are both load-bearing claims.
    expect(body).toContain("deleted after 60 minutes");
    expect(body).toContain("one-way hashed");
    expect(body).toContain("Candidate is not collectable");
    expect(body).toContain("BAA");
  });
});

describe("happy path: upload → mapping → run → results", () => {
  it("walks the whole flow and lands on a report", async () => {
    /* --- 1. upload the synthetic claims + fee schedule -------------------- */
    const upload = multipartBody(
      [
        { field: "claims", filename: "demo-claims.csv", content: dataset.csv },
        { field: "fees", filename: "demo-fees.csv", content: dataset.feesCsv },
      ],
      { practice: "Bridge Street Dental", tolerance: "1.00", tolerancePct: "1" },
    );
    const mapRes = await h.app.inject({
      method: "POST",
      url: "/upload",
      payload: upload.payload,
      headers: upload.headers,
    });
    expect(mapRes.statusCode).toBe(200);
    const mapHtml = mapRes.body;

    expect(mapHtml).toContain("Confirm which column is which");
    expect(mapHtml).toContain("demo-claims.csv");
    // Preview of the first rows, and the file's real headers as options.
    expect(mapHtml).toContain("First 5 rows of your file");
    expect(mapHtml).toContain("<table class=\"preview\">");
    // The fee schedule was recognised and matched automatically.
    expect(mapHtml).toContain("Contracted fee schedule");
    expect(mapHtml).toContain("demo-fees.csv");

    /* --- 2. every required dropdown is preselected ------------------------ */
    for (const field of [
      "claim_id",
      "service_date",
      "payer_name",
      "cdt_code",
      "billed_fee",
      "allowed_amount",
      "paid_amount",
    ]) {
      expect(selectedOption(mapHtml, field), `${field} preselected`).toBe(field);
    }
    // Nothing is blocked, so the Run button is live.
    expect(mapHtml).toContain('id="run" type="submit">');
    expect(mapHtml).not.toContain('id="run" type="submit" disabled');
    expect(mapHtml).toContain("All seven required fields are mapped");

    /* --- 3. run ----------------------------------------------------------- */
    const runId = runIdFrom(mapHtml);
    const body = formBody({
      runId,
      practice: "Bridge Street Dental",
      tolerance: "1.00",
      tolerancePct: "1",
      since: "",
      until: "",
      ...mappingFieldsFromScreen(mapHtml),
    });
    const runRes = await h.app.inject({
      method: "POST",
      url: "/run",
      payload: body.payload,
      headers: body.headers,
    });
    expect(runRes.statusCode).toBe(302);
    expect(runRes.headers.location).toBe(`/runs/${runId}`);

    /* --- 4. results ------------------------------------------------------- */
    const results = await h.app.inject({ method: "GET", url: `/runs/${runId}` });
    expect(results.statusCode).toBe(200);
    expect(results.body).toContain("Recoup Audit");
    expect(results.body).toContain("candidate");
    expect(results.body).toContain("lines audited");
    expect(results.body).toContain(`/runs/${runId}/report.html`);
    expect(results.body).not.toContain("Sample data");

    /* --- 5. the embedded report itself ------------------------------------ */
    const report = await h.app.inject({ method: "GET", url: `/runs/${runId}/report.html` });
    expect(report.statusCode).toBe(200);
    expect(report.headers["content-type"]).toContain("text/html");
    expect(report.body).toContain("Candidate underpayment report — Bridge Street Dental");
    expect(report.body).toContain("Candidate underpayments identified");
    // A supplied fee schedule must produce high-confidence findings.
    expect(report.body).toContain("You supplied a contracted fee schedule");

    /* --- 6. downloads ------------------------------------------------------ */
    const csv = await h.app.inject({ method: "GET", url: `/runs/${runId}/findings.csv` });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.headers["content-disposition"]).toContain('attachment; filename="findings.csv"');
    expect(csv.body.split("\n")[0]).toContain("finding_id,type,payer_name");

    const json = await h.app.inject({ method: "GET", url: `/runs/${runId}/findings.json` });
    expect(json.statusCode).toBe(200);
    expect(json.headers["content-type"]).toContain("application/json");
    const parsed = JSON.parse(json.body) as {
      tool: string;
      totals: { candidateUnderpayment: number; linesAudited: number };
      findings: unknown[];
    };
    expect(parsed.tool).toBe("@nightshift/recoup-audit");
    expect(parsed.totals.linesAudited).toBe(dataset.lineCount);
    expect(parsed.totals.candidateUnderpayment).toBeGreaterThan(0);
    expect(parsed.findings.length).toBeGreaterThan(0);
  });

  it("audits without a fee schedule and says so in the report", async () => {
    const upload = multipartBody([
      { field: "claims", filename: "claims.csv", content: dataset.csv },
    ]);
    const mapRes = await h.app.inject({
      method: "POST",
      url: "/upload",
      payload: upload.payload,
      headers: upload.headers,
    });
    const runId = runIdFrom(mapRes.body);
    const body = formBody({
      runId,
      tolerance: "1.00",
      tolerancePct: "1",
      ...mappingFieldsFromScreen(mapRes.body),
    });
    const runRes = await h.app.inject({
      method: "POST",
      url: "/run",
      payload: body.payload,
      headers: body.headers,
    });
    expect(runRes.statusCode).toBe(302);
    const report = await h.app.inject({ method: "GET", url: `/runs/${runId}/report.html` });
    expect(report.body).toContain("No contracted fee schedule was supplied");
  });

  it("preselects Open Dental headers on a renamed export", async () => {
    // Rewrite the synthetic file's header row into Open Dental spellings.
    const rename: Record<string, string> = {
      claim_id: "ClaimNum",
      service_date: "ProcDate",
      payer_name: "CarrierName",
      cdt_code: "ProcCode",
      billed_fee: "FeeBilled",
      allowed_amount: "AllowedAmt",
      paid_amount: "InsPayAmt",
      deductible_applied: "DedApplied",
      patient_portion: "PatientPortion",
      adjustment_codes: "Remarks",
      claim_ordinal: "ClaimType",
    };
    const [header, ...rest] = dataset.csv.split("\n");
    const renamed =
      header!
        .split(",")
        .map((h) => rename[h] ?? h)
        .join(",") +
      "\n" +
      rest.join("\n");

    const upload = multipartBody([
      { field: "claims", filename: "opendental-export.csv", content: renamed },
    ]);
    const res = await h.app.inject({
      method: "POST",
      url: "/upload",
      payload: upload.payload,
      headers: upload.headers,
    });
    expect(res.statusCode).toBe(200);
    expect(selectedOption(res.body, "claim_id")).toBe("ClaimNum");
    expect(selectedOption(res.body, "allowed_amount")).toBe("AllowedAmt");
    expect(selectedOption(res.body, "paid_amount")).toBe("InsPayAmt");
    expect(res.body).toContain("opendental preset");
    expect(res.body).toContain("All seven required fields are mapped");
  });
});

describe("/demo", () => {
  it("runs the deterministic synthetic dataset and banners it as sample data", async () => {
    const res = await h.app.inject({ method: "GET", url: "/demo" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Sample data — this is what your report would look like");
    expect(res.body).toContain("known answer key");
    expect(res.body).toContain("Audit your own export");

    const m = /src="\/runs\/([0-9a-z]+)\/report\.html"/.exec(res.body);
    expect(m).not.toBeNull();
    const report = await h.app.inject({ method: "GET", url: `/runs/${m![1]}/report.html` });
    expect(report.statusCode).toBe(200);
    expect(report.body).toContain("Demo Family Dental (synthetic data)");
    expect(report.body).toContain("Answer key — this dataset is synthetic");

    const csv = await h.app.inject({ method: "GET", url: `/runs/${m![1]}/findings.csv` });
    expect(csv.statusCode).toBe(200);
    expect(csv.body.split("\n").length).toBeGreaterThan(2);
  });

  it("serves the synthetic claims CSV so the upload flow can be tried", async () => {
    const res = await h.app.inject({ method: "GET", url: "/demo/claims.csv" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.body.split("\n")[0]).toContain("claim_id");
  });
});
