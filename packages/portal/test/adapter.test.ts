import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { buildServer } from "@nightshift/mock-portal";
import type { SubscriberQuery } from "@nightshift/schema";
import { getAdapter, closeBrowser, resetSessions } from "../src/index.js";
import { TempArtifactStore } from "../src/memory-artifacts.js";

/**
 * These tests spin the real mock portal on an ephemeral port and drive the
 * REAL Playwright adapters against it end-to-end.
 */

let server: FastifyInstance;

function q(partial: Partial<SubscriberQuery> & { subscriberId: string }): SubscriberQuery {
  return {
    subscriberName: "Test Member",
    patientFirstName: "Test",
    patientLastName: "Member",
    patientBirthdate: "1990-01-01",
    groupNumber: "GRP-ACME",
    payerKey: "mock-delta",
    ...partial,
  };
}

beforeAll(async () => {
  server = buildServer();
  await server.listen({ port: 0, host: "127.0.0.1" });
  const { port } = server.server.address() as AddressInfo;
  process.env.PORTAL_URL = `http://127.0.0.1:${port}`;
  resetSessions();
}, 60_000);

afterAll(async () => {
  await closeBrowser();
  await server?.close();
});

describe("mock-delta adapter", () => {
  it("captures benefits + history with >=4 artifacts and delta landmarks", async () => {
    const artifacts = new TempArtifactStore();
    const adapter = getAdapter("mock-delta")!;
    const captures = await adapter.fetchBreakdown(q({ subscriberId: "SUB-1001" }), { artifacts });

    // benefits + history = 2 captures, each persists screenshot + dom = 4 artifacts.
    expect(captures.length).toBe(2);
    expect(artifacts.saved.length).toBeGreaterThanOrEqual(4);

    // exactly two artifact kinds, both content-types present.
    const kinds = artifacts.saved.map((a) => a.kind).sort();
    expect(kinds).toContain("screenshot");
    expect(kinds).toContain("dom");
    expect(artifacts.saved.some((a) => a.contentType === "image/png")).toBe(true);
    expect(artifacts.saved.some((a) => a.contentType === "text/html")).toBe(true);

    const benefits = captures.find((c) => c.meta.pageName === "benefits")!;
    expect(benefits.kind).toBe("portal_page");
    expect(benefits.payerKey).toBe("mock-delta");
    expect(benefits.artifactIds.length).toBe(2);
    expect(benefits.content).toContain("Cal Yr Max");
    expect(benefits.content).toMatch(/Ind\. Ded\. Rem\./);

    const history = captures.find((c) => c.meta.pageName === "history")!;
    expect(history).toBeTruthy();
    // SUB-1001 prophy last-service date from seed usage.
    expect(history.content).toContain("01/15/2026");
    expect(history.content).toMatch(/Prophy/);
  }, 60_000);

  it("captures TERMINATED banner for terminated member SUB-1004", async () => {
    const artifacts = new TempArtifactStore();
    const adapter = getAdapter("mock-delta")!;
    const captures = await adapter.fetchBreakdown(q({ subscriberId: "SUB-1004" }), { artifacts });
    const benefits = captures.find((c) => c.meta.pageName === "benefits")!;
    expect(benefits.content).toContain("TERMINATED");
    expect(benefits.content).toContain("05/31/2026");
  }, 60_000);

  it("returns [] for an unknown subscriber", async () => {
    const artifacts = new TempArtifactStore();
    const adapter = getAdapter("mock-delta")!;
    const captures = await adapter.fetchBreakdown(q({ subscriberId: "SUB-9999" }), { artifacts });
    expect(captures).toEqual([]);
    expect(artifacts.saved.length).toBe(0);
  }, 60_000);
});

describe("mock-metlife adapter", () => {
  it("returns the benefits page only (no history) with sparse landmarks", async () => {
    const artifacts = new TempArtifactStore();
    const adapter = getAdapter("mock-metlife")!;
    const captures = await adapter.fetchBreakdown(
      q({ subscriberId: "SUB-1006", payerKey: "mock-metlife" }),
      { artifacts },
    );
    expect(captures.length).toBe(1);
    expect(captures[0].meta.pageName).toBe("benefits");
    expect(captures[0].content).toContain("Annual Benefit Maximum");
    expect(captures[0].content).toMatch(/Type I\b/);
    // sparse: no history captured
    expect(captures.some((c) => c.meta.pageName === "history")).toBe(false);
    expect(artifacts.saved.length).toBe(2);
  }, 60_000);
});

describe("registry", () => {
  it("resolves both adapters and only those", async () => {
    expect(getAdapter("mock-delta")?.payerKey).toBe("mock-delta");
    expect(getAdapter("mock-metlife")?.payerKey).toBe("mock-metlife");
    expect(getAdapter("mock-cigna")).toBeNull();
  });
});
