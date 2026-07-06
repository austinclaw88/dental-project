import { buildServer } from "./server.js";

/** Tiny production entry — boots the mock portal on PORTAL_PORT (default 4300). */
const port = Number(process.env.PORTAL_PORT ?? 4300);
const host = process.env.PORTAL_HOST ?? "127.0.0.1";

const app = buildServer();
app
  .listen({ port, host })
  .then((addr) => {
    // eslint-disable-next-line no-console
    console.log(`[mock-portal] serving mock-delta + mock-metlife at ${addr}`);
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[mock-portal] failed to start", err);
    process.exit(1);
  });
