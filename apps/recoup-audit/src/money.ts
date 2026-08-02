import type { Cents } from "./types.js";

/**
 * Parse a money-ish CSV cell into integer cents.
 * Accepts: "123.45", "$1,234.56", "(45.00)" (accounting negative), "", "-".
 * Returns null when the cell is blank/absent; throws on genuinely unparseable text.
 */
export function parseMoney(raw: string | undefined | null, field: string): Cents | null {
  if (raw === undefined || raw === null) return null;
  let s = String(raw).trim();
  if (s === "" || s === "-" || s === "--" || s.toUpperCase() === "N/A" || s.toUpperCase() === "NULL") {
    return null;
  }
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$\s,]/g, "");
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  if (!/^\d*(\.\d+)?$/.test(s) || s === "" || s === ".") {
    throw new Error(`Cannot parse "${raw}" as a money amount for field "${field}"`);
  }
  const cents = Math.round(Number(s) * 100);
  return negative ? -cents : cents;
}

export function parseMoneyRequired(raw: string | undefined | null, field: string, rowIndex: number): Cents {
  const v = parseMoney(raw, field);
  if (v === null) {
    throw new Error(`Row ${rowIndex}: required money field "${field}" is empty`);
  }
  return v;
}

/** $1,234.56 */
export function fmtMoney(cents: Cents): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = String(abs % 100).padStart(2, "0");
  return `${neg ? "-" : ""}$${dollars.toLocaleString("en-US")}.${rem}`;
}

/** $1,235 — for headline figures where cents are noise. */
export function fmtMoneyRounded(cents: Cents): string {
  const neg = cents < 0;
  const dollars = Math.round(Math.abs(cents) / 100);
  return `${neg ? "-" : ""}$${dollars.toLocaleString("en-US")}`;
}

export function fmtPct(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits)}%`;
}

export function sum(xs: number[]): number {
  let t = 0;
  for (const x of xs) t += x;
  return t;
}

/** Median of integers; even-length medians round half-up so the result stays integral cents. */
export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}
