import { existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunStore, RUN_TTL_MS, isValidRunId, newRunId } from "../src/store.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "recoup-store-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("run ids", () => {
  it("are 26 lowercase base32 characters and unguessable", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const id = newRunId();
      expect(isValidRunId(id)).toBe(true);
      expect(id).toMatch(/^[0-9a-z]{26}$/);
      ids.add(id);
    }
    expect(ids.size).toBe(500);
  });

  it("rejects path traversal and anything else that is not an id", () => {
    for (const bad of ["", "..", "../etc", "a".repeat(25), "a".repeat(27), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "a/b"]) {
      expect(isValidRunId(bad)).toBe(false);
    }
  });
});

describe("read/write", () => {
  it("round-trips run files and refuses to read outside a valid id", () => {
    const store = new RunStore(join(root, "runs"));
    const id = store.create();
    store.write(id, "report.html", "<h1>hi</h1>");
    expect(store.read(id, "report.html")).toBe("<h1>hi</h1>");
    expect(store.isComplete(id)).toBe(true);
    expect(store.read("../../etc", "passwd")).toBeUndefined();
  });

  it("does not call a run complete until a report exists", () => {
    const store = new RunStore(join(root, "runs"));
    const id = store.create();
    store.write(id, "claims.csv", "a,b\n1,2\n");
    expect(store.exists(id)).toBe(true);
    expect(store.isComplete(id)).toBe(false);
  });

  it("parses meta.json, and shrugs off a corrupt one", () => {
    const store = new RunStore(join(root, "runs"));
    const id = store.create();
    store.write(id, "meta.json", '{"id":"x","findings":3}');
    expect(store.meta(id)?.findings).toBe(3);
    store.write(id, "meta.json", "{not json");
    expect(store.meta(id)).toBeUndefined();
  });
});

describe("TTL sweep", () => {
  it("deletes runs older than the TTL and keeps fresh ones", () => {
    const runsDir = join(root, "runs");
    const store = new RunStore(runsDir);

    const fresh = store.create();
    store.write(fresh, "report.html", "fresh");

    const stale = store.create();
    store.write(stale, "report.html", "stale");
    // Back-date the directory well past the TTL.
    const old = (Date.now() - RUN_TTL_MS - 60_000) / 1000;
    utimesSync(join(runsDir, stale), old, old);

    const removed = store.sweep();
    expect(removed).toEqual([stale]);
    expect(existsSync(join(runsDir, stale))).toBe(false);
    expect(existsSync(join(runsDir, fresh))).toBe(true);
    expect(store.isComplete(stale)).toBe(false);
    expect(store.isComplete(fresh)).toBe(true);
  });

  it("sweeps with an explicit ttl and clock, and ignores loose files", () => {
    const runsDir = join(root, "runs");
    const store = new RunStore(runsDir);
    const id = store.create();
    store.write(id, "report.html", "x");
    writeFileSync(join(runsDir, "stray.txt"), "not a run");

    expect(store.sweep(10 * 60_000, Date.now())).toEqual([]);
    expect(store.sweep(0, Date.now() + 1000)).toEqual([id]);
    expect(existsSync(join(runsDir, "stray.txt"))).toBe(true);
  });

  it("is a no-op on a root that does not exist yet", () => {
    const store = new RunStore(join(root, "runs"));
    rmSync(join(root, "runs"), { recursive: true, force: true });
    expect(store.sweep()).toEqual([]);
  });

  it("removes a run directory whatever it contains", () => {
    const runsDir = join(root, "runs");
    const store = new RunStore(runsDir);
    const id = store.create();
    mkdirSync(join(runsDir, id, "nested"), { recursive: true });
    writeFileSync(join(runsDir, id, "nested", "deep.txt"), "x");
    const old = (Date.now() - RUN_TTL_MS - 1000) / 1000;
    utimesSync(join(runsDir, id), old, old);
    expect(store.sweep()).toEqual([id]);
    expect(existsSync(join(runsDir, id))).toBe(false);
  });
});
