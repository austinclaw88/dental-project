import { defineConfig } from "vitest/config";

// Pure-compute engine: no DB, no network, no fixtures on disk beyond presets/.
export default defineConfig({
  test: {
    testTimeout: 20_000,
  },
});
