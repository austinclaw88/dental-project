import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";

export interface Harness {
  app: FastifyInstance;
  root: string;
  close: () => Promise<void>;
}

/** A server whose run directory is a throwaway temp dir and whose sweep timer is off. */
export async function harness(): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), "recoup-web-test-"));
  const app = buildServer({ runRoot: join(root, "runs"), disableSweep: true });
  await app.ready();
  return {
    app,
    root,
    close: async () => {
      await app.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

const BOUNDARY = "----recouptestboundary8f2c1";

export interface MultipartFile {
  field: string;
  filename: string;
  content: string | Buffer;
  contentType?: string;
}

/** Build a multipart/form-data body by hand — no client library needed for inject(). */
export function multipartBody(
  files: MultipartFile[],
  fields: Record<string, string> = {},
): { payload: Buffer; headers: Record<string, string> } {
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        "utf8",
      ),
    );
  }
  for (const f of files) {
    chunks.push(
      Buffer.from(
        `--${BOUNDARY}\r\n` +
          `Content-Disposition: form-data; name="${f.field}"; filename="${f.filename}"\r\n` +
          `Content-Type: ${f.contentType ?? "text/csv"}\r\n\r\n`,
        "utf8",
      ),
    );
    chunks.push(typeof f.content === "string" ? Buffer.from(f.content, "utf8") : f.content);
    chunks.push(Buffer.from("\r\n", "utf8"));
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`, "utf8"));
  return {
    payload: Buffer.concat(chunks),
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

/** Pull the selected <option> out of a mapping-screen <select> for one field. */
export function selectedOption(html: string, field: string): string | undefined {
  const selectRe = new RegExp(
    `<select[^>]*id="col_${field}"[^>]*>([\\s\\S]*?)</select>`,
    "i",
  );
  const block = selectRe.exec(html);
  if (block === null) return undefined;
  const opt = /<option value="([^"]*)"\s+selected>/.exec(block[1]!);
  return opt === null ? undefined : opt[1];
}

export function formBody(fields: Record<string, string>): {
  payload: string;
  headers: Record<string, string>;
} {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) params.append(k, v);
  return {
    payload: params.toString(),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  };
}
