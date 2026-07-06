import { defineConfig } from "vitest/config";

// writeback.test hits the real odsim dev DB; run files serially to avoid races.
export default defineConfig({
  test: {
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
