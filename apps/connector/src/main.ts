import { createHash } from "node:crypto";
import { WritebackAck, WritebackCommand } from "@nightshift/schema";
import { odsimPool } from "@nightshift/od-sim";
import { buildSyncRequest, PRACTICE_ID } from "./mapping.js";
import { applyWriteback } from "./writeback.js";

/**
 * Practice-side sync agent (TDD §3.1). Long-running loop:
 *   1. read od-sim, map to ConnectorSyncRequest, POST to cloud (only on change)
 *   2. pull pending WritebackCommands and apply them to od-sim, ack each
 * Resilient: cloud outages are logged and the loop keeps polling; it never crashes.
 */

interface Config {
  apiBaseUrl: string;
  token: string;
  pollMs: number;
  practiceId: string;
}

function loadConfig(): Config {
  return {
    apiBaseUrl: process.env.API_BASE_URL ?? "http://127.0.0.1:4000",
    token: process.env.CONNECTOR_TOKEN ?? "dev-connector-token",
    pollMs: Number(process.env.CONNECTOR_POLL_MS ?? 5000),
    practiceId: PRACTICE_ID,
  };
}

function log(msg: string, extra?: unknown): void {
  const ts = new Date().toISOString();
  if (extra === undefined) console.log(`[connector ${ts}] ${msg}`);
  else console.log(`[connector ${ts}] ${msg}`, extra);
}

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs = 10_000,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    let body: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

let lastSyncHash = "";

async function doSync(cfg: Config): Promise<void> {
  const payload = await buildSyncRequest();
  const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  if (hash === lastSyncHash) {
    log(`sync: no change (patients=${payload.patients.length}, appts=${payload.appointments.length}) — skipping POST`);
    return;
  }
  try {
    const r = await fetchJson(`${cfg.apiBaseUrl}/internal/connector/sync`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-connector-token": cfg.token },
      body: JSON.stringify(payload),
    });
    if (r.ok) {
      lastSyncHash = hash;
      log(`sync POST ok status=${r.status}`, r.body);
    } else {
      log(`sync POST rejected status=${r.status} (will retry next loop)`, r.body);
    }
  } catch (err) {
    log(`sync POST failed: ${(err as Error).message} (cloud down? will retry)`);
  }
}

async function doWritebacks(cfg: Config): Promise<void> {
  let list: unknown;
  try {
    const r = await fetchJson(
      `${cfg.apiBaseUrl}/internal/connector/writebacks?practiceId=${encodeURIComponent(cfg.practiceId)}`,
      { method: "GET", headers: { "x-connector-token": cfg.token } },
    );
    if (!r.ok) {
      log(`writebacks GET status=${r.status} — skipping`);
      return;
    }
    list = r.body;
  } catch (err) {
    log(`writebacks GET failed: ${(err as Error).message} (cloud down? will retry)`);
    return;
  }

  const raw = (list as { writebacks?: unknown })?.writebacks;
  if (!Array.isArray(raw) || raw.length === 0) {
    log("writebacks: none pending");
    return;
  }
  log(`writebacks: ${raw.length} pending`);

  for (const item of raw) {
    let cmd: WritebackCommand;
    let ack: WritebackAck;
    try {
      cmd = WritebackCommand.parse(item);
    } catch (err) {
      log(`writeback parse failed, skipping: ${(err as Error).message}`);
      continue;
    }
    try {
      ack = await applyWriteback(cmd);
      log(`writeback ${cmd.id} target=${cmd.target} -> ${ack.status}${ack.error ? " " + ack.error : ""}`);
    } catch (err) {
      // applyWriteback shouldn't throw, but never let one command crash the loop.
      ack = WritebackAck.parse({ status: "failed", beforeImage: null, error: (err as Error).message });
      log(`writeback ${cmd.id} apply crashed: ${(err as Error).message}`);
    }
    try {
      const r = await fetchJson(
        `${cfg.apiBaseUrl}/internal/connector/writebacks/${encodeURIComponent(cmd.id)}/ack`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-connector-token": cfg.token },
          body: JSON.stringify(ack),
        },
      );
      log(`writeback ${cmd.id} ack POST status=${r.status}`);
    } catch (err) {
      log(`writeback ${cmd.id} ack POST failed: ${(err as Error).message}`);
    }
  }
}

async function tick(cfg: Config): Promise<void> {
  try {
    await doSync(cfg);
    await doWritebacks(cfg);
  } catch (err) {
    // Absolute backstop — the loop must never die.
    log(`tick error (continuing): ${(err as Error).message}`);
  }
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  log(`starting: api=${cfg.apiBaseUrl} practiceId=${cfg.practiceId} pollMs=${cfg.pollMs}`);
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    log("shutting down");
    await odsimPool().end().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Run forever; first loop always attempts a sync (lastSyncHash empty).
  while (!stopping) {
    await tick(cfg);
    await new Promise((res) => setTimeout(res, cfg.pollMs));
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    log(`fatal: ${(err as Error).message}`);
    process.exit(1);
  });
}

export { doSync, doWritebacks, tick, loadConfig };
