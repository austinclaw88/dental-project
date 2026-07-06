import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";

/**
 * HTTP-level smoke tests via Fastify inject (no browser needed). Verifies
 * auth gating, both payer styles, and the required scenario members.
 */

let app: FastifyInstance;
const CREDS = "username=office%40cedarpark.example&password=verify123!";

async function login(payerKey: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: `/${payerKey}/login`,
    payload: CREDS,
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  const cookie = res.cookies.find((c) => c.name === "portal_sid")!;
  return `portal_sid=${cookie.value}`;
}

beforeAll(async () => {
  app = buildServer();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe("auth", () => {
  it("redirects unauthenticated member search to login", async () => {
    const res = await app.inject({ method: "GET", url: "/mock-delta/members?subscriberId=SUB-1001" });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/mock-delta/login");
  });

  it("rejects wrong credentials with 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/mock-delta/login",
      payload: "username=x&password=y",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.body).toContain("Invalid username or password");
  });

  it("404s an unknown payer", async () => {
    const res = await app.inject({ method: "GET", url: "/mock-cigna/login" });
    expect(res.statusCode).toBe(404);
  });
});

describe("mock-delta (rich)", () => {
  it("renders benefits with delta labels", async () => {
    const cookie = await login("mock-delta");
    const res = await app.inject({
      method: "GET",
      url: "/mock-delta/member/SUB-1001/benefits",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Cal Yr Max");
    expect(res.body).toContain("Ind. Ded. Rem.");
    expect(res.body).toContain("Prophy");
  });

  it("shows TERMINATED banner for SUB-1004", async () => {
    const cookie = await login("mock-delta");
    const res = await app.inject({
      method: "GET",
      url: "/mock-delta/member/SUB-1004/benefits",
      headers: { cookie },
    });
    expect(res.body).toContain("TERMINATED eff 05/31/2026");
  });

  it("shows waiting-period text for SUB-1003", async () => {
    const cookie = await login("mock-delta");
    const res = await app.inject({
      method: "GET",
      url: "/mock-delta/member/SUB-1003/benefits",
      headers: { cookie },
    });
    expect(res.body).toContain("12 mo waiting period, member effective 03/01/2026");
  });

  it("shows frequency-exhausted (Used 2) for SUB-1002", async () => {
    const cookie = await login("mock-delta");
    const res = await app.inject({
      method: "GET",
      url: "/mock-delta/member/SUB-1002/benefits",
      headers: { cookie },
    });
    expect(res.body).toMatch(/Used 2 \(last 05\/02\/2026\)/);
  });

  it("serves history with prophy last-service date", async () => {
    const cookie = await login("mock-delta");
    const res = await app.inject({
      method: "GET",
      url: "/mock-delta/member/SUB-1001/history",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("01/15/2026");
  });

  it("returns No member found for unknown subscriber", async () => {
    const cookie = await login("mock-delta");
    const res = await app.inject({
      method: "GET",
      url: "/mock-delta/members?subscriberId=SUB-9999",
      headers: { cookie },
    });
    expect(res.body).toContain("No member found");
  });
});

describe("mock-metlife (sparse)", () => {
  it("renders sparse benefits with Type I/II/III classes", async () => {
    const cookie = await login("mock-metlife");
    const res = await app.inject({
      method: "GET",
      url: "/mock-metlife/member/SUB-1006/benefits",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Annual Benefit Maximum");
    expect(res.body).toContain("Type I");
    // sparse: no downgrade/COB/missing-tooth data (only the "not available" note)
    expect(res.body).not.toContain("amalgam");
  });

  it("404s the history page (not available on sparse payer)", async () => {
    const cookie = await login("mock-metlife");
    const res = await app.inject({
      method: "GET",
      url: "/mock-metlife/member/SUB-1006/history",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
