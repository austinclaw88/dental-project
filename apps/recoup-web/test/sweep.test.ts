/**
 * The TTL is a promise made in the footer of every page, so it is asserted through
 * the server as well as the store: a run that ages out stops being reachable.
 */

import { existsSync, utimesSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import { RUN_TTL_MS } from "../src/store.js";

let root: string;
let app: FastifyInstance;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "recoup-sweep-"));
  app = buildServer({ runRoot: join(root, "runs"), disableSweep: true });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe("expiry through the server", () => {
  it("serves a run, then 404s it once it has aged past the TTL", async () => {
    const demo = await app.inject({ method: "GET", url: "/demo" });
    expect(demo.statusCode).toBe(200);
    const id = /src="\/runs\/([0-9a-z]+)\/report\.html"/.exec(demo.body)![1]!;

    expect((await app.inject({ method: "GET", url: `/runs/${id}` })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/runs/${id}/report.html` })).statusCode).toBe(200);

    const old = (Date.now() - RUN_TTL_MS - 60_000) / 1000;
    utimesSync(join(root, "runs", id), old, old);

    expect(app.sweepNow()).toEqual([id]);
    expect(existsSync(join(root, "runs", id))).toBe(false);

    const gone = await app.inject({ method: "GET", url: `/runs/${id}` });
    expect(gone.statusCode).toBe(404);
    expect(gone.body).toContain("That run is gone");
    expect((await app.inject({ method: "GET", url: `/runs/${id}/findings.csv` })).statusCode).toBe(404);
  });

  it("sweeps on boot, so a restart does not resurrect expired runs", async () => {
    const demo = await app.inject({ method: "GET", url: "/demo" });
    const id = /src="\/runs\/([0-9a-z]+)\/report\.html"/.exec(demo.body)![1]!;
    const old = (Date.now() - RUN_TTL_MS - 60_000) / 1000;
    utimesSync(join(root, "runs", id), old, old);

    const rebooted = buildServer({ runRoot: join(root, "runs"), disableSweep: true });
    await rebooted.ready();
    expect(existsSync(join(root, "runs", id))).toBe(false);
    expect((await rebooted.inject({ method: "GET", url: `/runs/${id}` })).statusCode).toBe(404);
    await rebooted.close();
  });
});
