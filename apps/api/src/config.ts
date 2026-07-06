/** Environment-derived configuration. All defaults mirror /.env.example. */

/** Fixed dev practice UUID (API-CONTRACT.md — connector sends this on first sync). */
export const PRACTICE_ID = "11111111-1111-1111-1111-111111111111";

export interface Config {
  port: number;
  connectorToken: string;
  artifactsDir: string;
  jobConcurrency: number;
  jobLockTimeoutSec: number;
  jobPollIntervalMs: number;
  extractor: "heuristic" | "anthropic";
  anthropicApiKey: string | null;
  anthropicModel: string;
  batchHour: number;
  disableCron: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.API_PORT ?? 4000),
    connectorToken: env.CONNECTOR_TOKEN ?? "dev-connector-token",
    artifactsDir: env.ARTIFACTS_DIR ?? "./var/artifacts",
    jobConcurrency: Number(env.JOB_CONCURRENCY ?? 4),
    jobLockTimeoutSec: Number(env.JOB_LOCK_TIMEOUT_SEC ?? 60),
    jobPollIntervalMs: Number(env.JOB_POLL_INTERVAL_MS ?? 500),
    extractor: (env.EXTRACTOR as "heuristic" | "anthropic") ?? "heuristic",
    anthropicApiKey: env.ANTHROPIC_API_KEY ?? null,
    anthropicModel: env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
    batchHour: Number(env.BATCH_HOUR ?? 2),
    disableCron: env.DISABLE_CRON === "1" || env.DISABLE_CRON === "true",
  };
}
