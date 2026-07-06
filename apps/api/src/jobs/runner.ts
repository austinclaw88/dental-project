import { randomUUID } from "node:crypto";
import { query } from "@nightshift/db";
import type { Deps } from "../deps.js";

export interface JobHandler {
  handle(payload: Record<string, unknown>): Promise<void>;
  /** Called once when a job's retries are exhausted (final failure). */
  onExhausted?(payload: Record<string, unknown>, err: Error): Promise<void>;
}

interface JobRow {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

/**
 * Durable in-process job runner (Temporal stand-in, TDD §3.2 note).
 * - Claims with `update ... where id in (select ... for update skip locked)`.
 * - Concurrency-limited (JOB_CONCURRENCY).
 * - Retries with exponential backoff up to max_attempts.
 * - Crash-safe: a row left in 'running' becomes claimable again after
 *   JOB_LOCK_TIMEOUT_SEC (a killed process does not strand its jobs).
 */
export class JobRunner {
  private readonly workerId = `worker-${randomUUID().slice(0, 8)}`;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private inflight = 0;

  constructor(
    private readonly deps: Deps,
    private readonly handlers: Record<string, JobHandler>,
  ) {}

  start(): void {
    if (this.timer) return;
    this.running = true;
    const tick = async () => {
      if (!this.running) return;
      try {
        await this.pump();
      } catch (err) {
        console.error(`[jobs] pump error: ${(err as Error).message}`);
      }
      if (this.running) this.timer = setTimeout(tick, this.deps.config.jobPollIntervalMs);
    };
    this.timer = setTimeout(tick, this.deps.config.jobPollIntervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** One claim+process cycle (respects concurrency headroom). */
  private async pump(): Promise<void> {
    const headroom = this.deps.config.jobConcurrency - this.inflight;
    if (headroom <= 0) return;
    const claimed = await this.claim(headroom);
    for (const job of claimed) {
      this.inflight++;
      void this.process(job).finally(() => {
        this.inflight--;
      });
    }
  }

  /** Drain all currently-ready jobs to completion (used by tests). */
  async drain(maxRounds = 500): Promise<void> {
    for (let i = 0; i < maxRounds; i++) {
      const claimed = await this.claim(this.deps.config.jobConcurrency);
      if (claimed.length === 0) return;
      await Promise.all(claimed.map((j) => this.process(j)));
    }
  }

  private async claim(limit: number): Promise<JobRow[]> {
    if (limit <= 0) return [];
    return query<JobRow>(
      `update job
          set status='running', locked_by=$1, locked_at=now(), attempts=attempts+1
        where id in (
          select id from job
           where (status='queued' and run_after <= now())
              or (status='running' and locked_at < now() - ($2 || ' seconds')::interval)
           order by run_after
           for update skip locked
           limit $3
        )
      returning id, kind, payload, attempts, max_attempts`,
      [this.workerId, this.deps.config.jobLockTimeoutSec, limit],
      this.deps.pool,
    );
  }

  private async process(job: JobRow): Promise<void> {
    const handler = this.handlers[job.kind];
    if (!handler) {
      await query(`update job set status='failed', finished_at=now(), last_error=$1 where id=$2`, [
        `no handler for kind ${job.kind}`,
        job.id,
      ], this.deps.pool);
      return;
    }
    try {
      await handler.handle(job.payload);
      await query(`update job set status='done', finished_at=now() where id=$1`, [job.id], this.deps.pool);
    } catch (err) {
      const e = err as Error;
      if (job.attempts >= job.max_attempts) {
        await query(`update job set status='failed', finished_at=now(), last_error=$1 where id=$2`, [e.message, job.id], this.deps.pool);
        try {
          await handler.onExhausted?.(job.payload, e);
        } catch (hookErr) {
          console.error(`[jobs] onExhausted failed for ${job.id}: ${(hookErr as Error).message}`);
        }
      } else {
        const backoffMs = Math.min(60_000, 2000 * 2 ** job.attempts);
        await query(
          `update job set status='queued', run_after = now() + ($1 || ' milliseconds')::interval, last_error=$2 where id=$3`,
          [backoffMs, e.message, job.id],
          this.deps.pool,
        );
      }
    }
  }
}

/** Enqueue a job. */
export async function enqueueJob(
  deps: Deps,
  kind: string,
  payload: Record<string, unknown>,
  opts: { maxAttempts?: number } = {},
): Promise<string> {
  const row = await query<{ id: string }>(
    `insert into job (kind, payload, max_attempts) values ($1,$2,$3) returning id`,
    [kind, JSON.stringify(payload), opts.maxAttempts ?? 3],
    deps.pool,
  );
  return row[0].id;
}
