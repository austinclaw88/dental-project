import { runMigrations } from "@nightshift/db";
import { loadConfig } from "./config.js";
import { buildDefaultDeps } from "./deps.js";
import { buildServer } from "./server.js";

async function main() {
  const config = loadConfig();
  // Ensure schema is present (idempotent) so `dev` boots against a fresh DB.
  try {
    await runMigrations();
  } catch (err) {
    console.warn(`[api] migrations skipped/failed: ${(err as Error).message}`);
  }

  const deps = await buildDefaultDeps(config);
  const app = buildServer(deps);

  await app.listen({ port: config.port, host: "0.0.0.0" });
  app.startBackground();
  console.log(`[api] NightShift API listening on :${config.port} (extractor=${config.extractor}, cron=${config.disableCron ? "off" : "on"})`);

  const shutdown = async () => {
    app.stopBackground();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
