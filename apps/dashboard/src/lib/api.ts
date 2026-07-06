/**
 * API client. Wires to the real API at NEXT_PUBLIC_API_URL (default
 * http://127.0.0.1:4000). Every call attempts a real fetch; on a network error
 * (API not running) it flips a global "offline" flag and delegates to the
 * in-memory mock backend so the UI degrades gracefully instead of white-screening.
 *
 * Endpoints per docs/API-CONTRACT.md "Dashboard-facing (/api)".
 */
import { mock } from "./mockApi";
import type {
  MetricsSummary,
  Practice,
  ReviewTask,
  VerificationDetail,
  VerificationListItem,
} from "../types";

export const API_URL =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_URL) ||
  "http://127.0.0.1:4000";

// ---- offline flag (observable) ----
let offline = false;
const listeners = new Set<(v: boolean) => void>();
export function isOffline(): boolean {
  return offline;
}
export function onOfflineChange(cb: (v: boolean) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function setOffline(v: boolean) {
  if (offline !== v) {
    offline = v;
    listeners.forEach((l) => l(v));
  }
}

export function artifactUrl(artifactId: string): string {
  return `${API_URL}/api/artifacts/${encodeURIComponent(artifactId)}`;
}

/** Try a real request; on network failure, mark offline and run the fallback. */
async function withFallback<T>(
  request: () => Promise<T>,
  fallback: () => T,
): Promise<T> {
  try {
    const out = await request();
    setOffline(false);
    return out;
  } catch (err) {
    // Network/refused -> offline. (HTTP error responses are handled in request().)
    setOffline(true);
    return fallback();
  }
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return (await res.json()) as T;
}
async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

// ---- endpoints ----
export function getPractices(): Promise<Practice[]> {
  return withFallback(
    async () => (await getJSON<{ practices: Practice[] }>("/api/practices")).practices,
    () => mock.practices(),
  );
}

export function getDay(practiceId: string, date: string): Promise<VerificationListItem[]> {
  return withFallback(
    async () =>
      (await getJSON<{ items: VerificationListItem[] }>(
        `/api/practices/${practiceId}/day/${date}/verifications`,
      )).items,
    () => mock.day(date),
  );
}

export function getMetrics(practiceId: string, date: string): Promise<MetricsSummary | null> {
  return withFallback(
    () => getJSON<MetricsSummary>(`/api/practices/${practiceId}/metrics/summary?date=${date}`),
    () => mock.metrics(),
  );
}

export function runBatch(practiceId: string, date: string): Promise<{ batchId: string; planned: number }> {
  return withFallback(
    () => postJSON("/api/batch/run", { practiceId, date }),
    () => mock.runBatch(date),
  );
}

export function reverify(verificationId: string): Promise<{ verificationId: string }> {
  return withFallback(
    () => postJSON(`/api/verifications/${verificationId}/reverify`, {}),
    () => mock.reverify(verificationId),
  );
}

export function verifyNow(patientLinkId: string, date: string): Promise<{ verificationId: string }> {
  return withFallback(
    () => postJSON(`/api/patients/${patientLinkId}/verify-now`, { date }),
    () => mock.verifyNow(patientLinkId, date),
  );
}

export function resolveException(exceptionId: string, resolvedBy: string): Promise<unknown> {
  return withFallback(
    () => postJSON(`/api/exceptions/${exceptionId}/resolve`, { resolvedBy }),
    () => mock.resolveException(exceptionId),
  );
}

export function getVerification(id: string): Promise<VerificationDetail | null> {
  return withFallback(
    () => getJSON<VerificationDetail>(`/api/verifications/${id}`),
    () => mock.verification(id),
  );
}

export function getReviewTasks(): Promise<ReviewTask[]> {
  return withFallback(
    async () => (await getJSON<{ tasks: ReviewTask[] }>("/api/review-tasks?status=open")).tasks,
    () => mock.reviewTasks(),
  );
}

export function completeReview(
  id: string,
  fields: Record<string, unknown>,
  reviewer: string,
): Promise<unknown> {
  return withFallback(
    () => postJSON(`/api/review-tasks/${id}/complete`, { fields, reviewer }),
    () => mock.completeReview(id),
  );
}
