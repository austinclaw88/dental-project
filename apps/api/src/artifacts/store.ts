import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type pg from "pg";
import { maybeOne, one } from "@nightshift/db";
import type { ArtifactStore } from "@nightshift/schema";

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "application/json": "json",
  "text/html": "html",
  "text/plain": "txt",
  "image/png": "png",
  "application/pdf": "pdf",
};

/**
 * Filesystem-backed ArtifactStore (TDD §2 object-store stand-in).
 * Bytes land under ARTIFACTS_DIR; a row in `artifact` holds the pointer + type.
 * `GET /api/artifacts/:id` streams the file from getPath().
 */
export class FsArtifactStore implements ArtifactStore {
  constructor(
    private readonly dir: string,
    private readonly pool: pg.Pool,
  ) {}

  async put(opts: {
    kind: string;
    contentType: string;
    data: Buffer | string;
    verificationId?: string | null;
  }): Promise<string> {
    const row = await one<{ id: string }>(
      `insert into artifact (verification_id, kind, content_type, storage_path)
       values ($1,$2,$3,$4) returning id`,
      [opts.verificationId ?? null, opts.kind, opts.contentType, "PENDING"],
      this.pool,
    );
    const ext = EXT_BY_CONTENT_TYPE[opts.contentType] ?? "bin";
    const abs = resolve(this.dir);
    await mkdir(abs, { recursive: true });
    const path = join(abs, `${row.id}.${ext}`);
    const buf = typeof opts.data === "string" ? Buffer.from(opts.data, "utf8") : opts.data;
    await writeFile(path, buf);
    await one<{ id: string }>(`update artifact set storage_path=$1 where id=$2 returning id`, [path, row.id], this.pool);
    return row.id;
  }

  async getPath(artifactId: string): Promise<{ path: string; contentType: string }> {
    const row = await maybeOne<{ storage_path: string; content_type: string }>(
      `select storage_path, content_type from artifact where id=$1`,
      [artifactId],
      this.pool,
    );
    if (!row) throw new Error(`artifact ${artifactId} not found`);
    return { path: row.storage_path, contentType: row.content_type };
  }
}
