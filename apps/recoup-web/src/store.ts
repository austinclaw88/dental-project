/**
 * Run storage.
 *
 * One directory per run under `var/runs/<id>/`, holding the uploaded CSVs and,
 * once the audit has run, the three engine outputs plus a meta.json describing
 * what was mapped. Ids are 128 bits of crypto randomness in base32url — a run URL
 * is the only credential this dev tool has, so it must not be enumerable.
 *
 * Everything is swept after RUN_TTL_MS. That TTL is a promise made on the landing
 * page, so it is enforced here rather than left to an operator: on boot, and on an
 * unref'd interval thereafter.
 */

import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_RUN_ROOT = resolve(HERE, "..", "var", "runs");
export const RUN_TTL_MS = 60 * 60 * 1000;
export const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const ID_RE = /^[0-9a-z]{26}$/;

/** 130 bits of randomness rendered in lowercase base32 — URL-safe, no ambiguity. */
export function newRunId(): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  const bytes = randomBytes(26);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export function isValidRunId(id: string): boolean {
  return ID_RE.test(id);
}

export interface RunMeta {
  id: string;
  createdAt: string;
  practiceName?: string;
  claimsFilename: string;
  feesFilename?: string;
  /** canonical field -> source header, as confirmed by the user. */
  mapping: Record<string, string>;
  tolerance: { absoluteDollars: number; percent: number };
  since?: string;
  until?: string;
  linesAudited: number;
  rowsRejected: number;
  candidateDollars: number;
  findings: number;
  hasContractSchedule: boolean;
  isDemo: boolean;
}

export class RunStore {
  constructor(readonly root: string = DEFAULT_RUN_ROOT) {
    mkdirSync(this.root, { recursive: true });
  }

  dir(id: string): string {
    return join(this.root, id);
  }

  create(): string {
    const id = newRunId();
    mkdirSync(this.dir(id), { recursive: true });
    return id;
  }

  exists(id: string): boolean {
    return isValidRunId(id) && existsSync(this.dir(id));
  }

  /** A run that has completed — i.e. one with a report to show. */
  isComplete(id: string): boolean {
    return this.exists(id) && existsSync(join(this.dir(id), "report.html"));
  }

  write(id: string, name: string, body: string | Buffer): void {
    mkdirSync(this.dir(id), { recursive: true });
    writeFileSync(join(this.dir(id), name), body);
  }

  read(id: string, name: string): string | undefined {
    const p = join(this.dir(id), name);
    if (!isValidRunId(id) || !existsSync(p)) return undefined;
    return readFileSync(p, "utf8");
  }

  meta(id: string): RunMeta | undefined {
    const raw = this.read(id, "meta.json");
    if (raw === undefined) return undefined;
    try {
      return JSON.parse(raw) as RunMeta;
    } catch {
      return undefined;
    }
  }

  remove(id: string): void {
    if (!isValidRunId(id)) return;
    rmSync(this.dir(id), { recursive: true, force: true });
  }

  /** Delete every run directory older than `ttlMs`. Returns the ids removed. */
  sweep(ttlMs: number = RUN_TTL_MS, now: number = Date.now()): string[] {
    if (!existsSync(this.root)) return [];
    const removed: string[] = [];
    for (const entry of readdirSync(this.root)) {
      const p = join(this.root, entry);
      try {
        const st = statSync(p);
        if (!st.isDirectory()) continue;
        if (now - st.mtimeMs > ttlMs) {
          rmSync(p, { recursive: true, force: true });
          removed.push(entry);
        }
      } catch {
        // A run swept by a concurrent process is the outcome we wanted anyway.
      }
    }
    return removed;
  }
}
