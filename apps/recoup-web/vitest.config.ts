import { defineConfig } from "vitest/config";

// Server tests run entirely through fastify.inject() — no listening socket, no
// network, no DB. Runs are written to a per-test temp dir, never to var/runs.
export default defineConfig({
  test: {
    testTimeout: 30_000,
  },
});
