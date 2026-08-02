/**
 * Minimal RFC-4180 CSV reader/writer. Deliberately dependency-free: a dental
 * office's export is the only input this tool takes, so the parse path is
 * something we want to own, read, and unit-test rather than inherit.
 *
 * Handles: quoted fields, embedded commas/newlines/quotes, CRLF, BOM,
 * ragged rows (short rows are padded, long rows keep their extras under
 * positional keys so nothing is silently dropped).
 */

export type CsvRow = Record<string, string>;

export interface CsvTable {
  headers: string[];
  rows: CsvRow[];
  /** rows[i] came from source line number sourceLines[i] (1-based, header = 1). */
  sourceLines: number[];
}

export function parseCsv(text: string, delimiter = ","): CsvTable {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  const lineNumbers: number[] = [];

  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let started = false;
  let line = 1;
  let recordLine = 1;

  const pushField = () => {
    record.push(field);
    field = "";
  };
  const pushRecord = () => {
    pushField();
    // Skip fully blank lines.
    if (!(record.length === 1 && record[0]!.trim() === "")) {
      records.push(record);
      lineNumbers.push(recordLine);
    }
    record = [];
    started = false;
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (!started) {
      recordLine = line;
      started = true;
    }
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === delimiter) {
      pushField();
    } else if (ch === "\r") {
      // swallow; \n handles the record break
    } else if (ch === "\n") {
      pushRecord();
      line++;
    } else {
      field += ch;
    }
  }
  if (field !== "" || record.length > 0 || started) pushRecord();

  if (records.length === 0) {
    return { headers: [], rows: [], sourceLines: [] };
  }

  const headers = records[0]!.map((h) => h.trim());
  const rows: CsvRow[] = [];
  const sourceLines: number[] = [];
  for (let r = 1; r < records.length; r++) {
    const rec = records[r]!;
    const row: CsvRow = {};
    for (let c = 0; c < Math.max(headers.length, rec.length); c++) {
      const key = c < headers.length && headers[c] !== "" ? headers[c]! : `__col${c}`;
      row[key] = (rec[c] ?? "").trim();
    }
    rows.push(row);
    sourceLines.push(lineNumbers[r]!);
  }
  return { headers, rows, sourceLines };
}

function escapeCell(v: unknown): string {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const out: string[] = [headers.map(escapeCell).join(",")];
  for (const row of rows) {
    out.push(headers.map((h) => escapeCell(row[h])).join(","));
  }
  return out.join("\n") + "\n";
}
