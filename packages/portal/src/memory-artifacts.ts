import type { ArtifactStore } from "@nightshift/schema";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Minimal filesystem-backed ArtifactStore used by the canary and tests. The
 * real store lives in apps/api; adapters only depend on the ArtifactStore
 * seam, so this stand-in exercises the same put()/getPath() contract.
 */
export class TempArtifactStore implements ArtifactStore {
  readonly dir: string;
  readonly saved: Array<{ id: string; kind: string; contentType: string; bytes: number }> = [];
  private meta = new Map<string, { path: string; contentType: string }>();

  constructor(dir?: string) {
    this.dir = dir ?? mkdtempSync(join(tmpdir(), "ns-artifacts-"));
  }

  async put(opts: {
    kind: string;
    contentType: string;
    data: Buffer | string;
    verificationId?: string | null;
  }): Promise<string> {
    const id = randomUUID();
    const ext = extFor(opts.contentType);
    const path = join(this.dir, `${id}${ext}`);
    const buf = Buffer.isBuffer(opts.data) ? opts.data : Buffer.from(opts.data);
    writeFileSync(path, buf);
    this.meta.set(id, { path, contentType: opts.contentType });
    this.saved.push({ id, kind: opts.kind, contentType: opts.contentType, bytes: buf.length });
    return id;
  }

  async getPath(artifactId: string): Promise<{ path: string; contentType: string }> {
    const m = this.meta.get(artifactId);
    if (!m) throw new Error(`unknown artifact ${artifactId}`);
    return m;
  }
}

function extFor(contentType: string): string {
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("html")) return ".html";
  if (contentType.includes("json")) return ".json";
  return ".bin";
}
