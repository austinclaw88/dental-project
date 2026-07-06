import type { Confidence, DisplayStatus, FieldSource } from "../types";

const TZ = "America/Chicago";

export function fmtTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: TZ,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function fmtDateLong(dateOrIso: string): string {
  const iso = dateOrIso.length === 10 ? `${dateOrIso}T12:00:00Z` : dateOrIso;
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: dateOrIso.length === 10 ? "UTC" : TZ,
    }).format(new Date(iso));
  } catch {
    return dateOrIso;
  }
}

export function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "2-digit",
      day: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso));
  } catch {
    return iso;
  }
}

export function fmtMoney(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return `$${n.toLocaleString("en-US")}`;
}

export function fmtPercent(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return `${n}%`;
}

export function fmtDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  verified: "Verified",
  attention: "Attention",
  in_progress: "In progress",
  failed: "Failed",
  planned: "Planned",
};

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: "H",
  medium: "M",
  low: "L",
};
export const CONFIDENCE_WORD: Record<Confidence, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

export const SOURCE_ICON: Record<FieldSource, string> = {
  portal: "🌐",
  x12_271: "📠",
  voice_call: "📞",
  human: "👤",
  pms: "🗂️",
};
export const SOURCE_LABEL: Record<FieldSource, string> = {
  portal: "Payer portal",
  x12_271: "Clearinghouse 271",
  voice_call: "Payer phone call",
  human: "Human reviewer",
  pms: "OpenDental record",
};
