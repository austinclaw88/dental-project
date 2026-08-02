import { buildServer } from "./server.js";

const port = Number(process.env.RECOUP_WEB_PORT ?? 4500);
const host = process.env.RECOUP_WEB_HOST ?? "0.0.0.0";

async function main(): Promise<void> {
  const app = buildServer({ logger: process.env.RECOUP_WEB_LOG === "1" });
  await app.listen({ port, host });
  process.stdout.write(
    `\nRecoup Audit web — http://localhost:${port}\n` +
      `  landing      http://localhost:${port}/\n` +
      `  sample audit http://localhost:${port}/demo\n` +
      `  runs are written to apps/recoup-web/var/runs and deleted after 60 minutes\n\n`,
  );

  const shutdown = async (): Promise<void> => {
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
