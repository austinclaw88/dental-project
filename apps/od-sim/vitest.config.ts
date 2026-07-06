import { defineConfig } from "vitest/config";

// Tests hit the real odsim dev DB; run files serially to avoid TRUNCATE races.
export default defineConfig({
  test: {
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
