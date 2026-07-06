import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Real Playwright navigations — allow generous per-test time.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Single fork: one browser instance is shared across the suite.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
