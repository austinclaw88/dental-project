import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import { randomUUID } from "node:crypto";
import { PortalData, type PayerKey } from "./data.js";
import {
  renderBenefits,
  renderError,
  renderHistory,
  renderLogin,
  renderSearch,
} from "./render.js";

/**
 * apps/mock-portal — a fake payer-portal web app serving two payers
 * (mock-delta, mock-metlife) from one server. Server-rendered HTML only.
 *
 * Exported as a factory so tests (and packages/portal) can boot it on an
 * ephemeral port. See main.ts for the tiny production entry.
 */

const SID_COOKIE = "portal_sid";

export interface BuildServerOpts {
  data?: PortalData;
}

export function buildServer(opts: BuildServerOpts = {}): FastifyInstance {
  const data = opts.data ?? new PortalData();
  const app = Fastify({ logger: false });
  app.register(cookie);
  app.register(formbody);

  // sid -> { payerKey, username }
  const sessions = new Map<string, { payerKey: string; username: string }>();

  function html(reply: FastifyReply, body: string, status = 200) {
    reply.status(status).header("content-type", "text/html; charset=utf-8").send(body);
  }

  function requirePayer(req: FastifyRequest, reply: FastifyReply): PayerKey | null {
    const { payerKey } = req.params as { payerKey: string };
    if (!data.hasPayer(payerKey)) {
      html(reply, renderError("mock-delta", 404, `Unknown payer portal: ${payerKey}`), 404);
      return null;
    }
    return payerKey;
  }

  /** Returns true if a valid session for this payer exists; else redirects to login. */
  function requireSession(req: FastifyRequest, reply: FastifyReply, payerKey: PayerKey): boolean {
    const sid = req.cookies[SID_COOKIE];
    const sess = sid ? sessions.get(sid) : undefined;
    if (!sess || sess.payerKey !== payerKey) {
      reply.redirect(`/${payerKey}/login`);
      return false;
    }
    return true;
  }

  // Root: list the two portals.
  app.get("/", async (_req, reply) => {
    html(
      reply,
      `<!doctype html><meta charset="utf-8"><title>Mock Payer Portals</title>
       <h1>NightShift Mock Payer Portals</h1>
       <ul>
         <li><a href="/mock-delta/login">Delta Dental MockState</a></li>
         <li><a href="/mock-metlife/login">MetLife Mock</a></li>
       </ul>`,
    );
  });

  app.get("/healthz", async (_req, reply) => reply.send({ ok: true }));

  // --- login ---------------------------------------------------------------
  app.get("/:payerKey/login", async (req, reply) => {
    const payerKey = requirePayer(req, reply);
    if (!payerKey) return;
    html(reply, renderLogin(payerKey));
  });

  app.post("/:payerKey/login", async (req, reply) => {
    const payerKey = requirePayer(req, reply);
    if (!payerKey) return;
    const body = (req.body ?? {}) as { username?: string; password?: string };
    const creds = data.credentials;
    if (body.username === creds.username && body.password === creds.password) {
      const sid = randomUUID();
      sessions.set(sid, { payerKey, username: body.username });
      reply.setCookie(SID_COOKIE, sid, { path: "/", httpOnly: true, sameSite: "lax" });
      reply.redirect(`/${payerKey}/members`);
      return;
    }
    html(reply, renderLogin(payerKey, { error: "Invalid username or password." }), 401);
  });

  // --- member search -------------------------------------------------------
  app.get("/:payerKey/members", async (req, reply) => {
    const payerKey = requirePayer(req, reply);
    if (!payerKey) return;
    if (!requireSession(req, reply, payerKey)) return;
    const { subscriberId } = req.query as { subscriberId?: string };
    if (subscriberId == null || subscriberId === "") {
      html(reply, renderSearch(payerKey, {}));
      return;
    }
    const member = data.getMember(payerKey, subscriberId);
    html(reply, renderSearch(payerKey, { subscriberId, member }));
  });

  // --- benefits ------------------------------------------------------------
  app.get("/:payerKey/member/:subscriberId/benefits", async (req, reply) => {
    const payerKey = requirePayer(req, reply);
    if (!payerKey) return;
    if (!requireSession(req, reply, payerKey)) return;
    const { subscriberId } = req.params as { subscriberId: string };
    const member = data.getMember(payerKey, subscriberId);
    if (!member) {
      html(reply, renderError(payerKey, 404, `No member found for ${subscriberId}`), 404);
      return;
    }
    html(reply, renderBenefits(member));
  });

  // --- history (delta only) ------------------------------------------------
  app.get("/:payerKey/member/:subscriberId/history", async (req, reply) => {
    const payerKey = requirePayer(req, reply);
    if (!payerKey) return;
    if (!requireSession(req, reply, payerKey)) return;
    const { subscriberId } = req.params as { subscriberId: string };
    if (payerKey === "mock-metlife") {
      html(
        reply,
        renderError(payerKey, 404, "Service history is not available through this portal."),
        404,
      );
      return;
    }
    const member = data.getMember(payerKey, subscriberId);
    if (!member) {
      html(reply, renderError(payerKey, 404, `No member found for ${subscriberId}`), 404);
      return;
    }
    html(reply, renderHistory(member));
  });

  return app;
}
