/**
 * Offline mock backend. Used ONLY when the real API is unreachable.
 *
 * Holds mutable in-memory copies of the fixtures so the app stays interactive
 * with the API down: "Run nightly batch", "Re-verify" and "Resolve" produce
 * realistic in_progress -> terminal transitions (so auto-refresh + status pulse
 * are demonstrable), and "Complete review" clears the review task.
 *
 * This module is intentionally the ONLY place with timers/mutation; api.ts just
 * delegates here on network failure.
 */
import {
  buildDayItems,
  buildDetail,
  buildMetrics,
  buildReviewTasks,
  defaultDate,
  PRACTICE,
} from "./fixtures";
import type {
  MetricsSummary,
  Practice,
  ReviewTask,
  VerificationDetail,
  VerificationListItem,
} from "../types";

const days = new Map<string, VerificationListItem[]>();
let reviewTasks: ReviewTask[] | null = null;

function ensureDay(date: string): VerificationListItem[] {
  if (!days.has(date)) days.set(date, buildDayItems(date));
  return days.get(date)!;
}
function settledItem(date: string, id: string): VerificationListItem | undefined {
  return buildDayItems(date).find((i) => i.id === id);
}
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export const mock = {
  practices(): Practice[] {
    return [PRACTICE];
  },

  day(date: string): VerificationListItem[] {
    return clone(ensureDay(date));
  },

  metrics(): MetricsSummary {
    return buildMetrics();
  },

  runBatch(date: string): { batchId: string; planned: number } {
    const items = ensureDay(date);
    // flip everything to a running/planned state, then settle to scenario outcome
    items.forEach((it, idx) => {
      it.displayStatus = idx % 4 === 0 ? "planned" : "in_progress";
      it.status = it.displayStatus === "planned" ? "PLANNED" : "ELIGIBILITY";
      it.completedAt = null;
      it.exceptions = [];
      const delay = 1500 + idx * 500;
      setTimeout(() => {
        const settled = settledItem(date, it.id);
        if (settled) Object.assign(it, clone(settled));
      }, delay);
    });
    return { batchId: `batch-${date}`, planned: items.length };
  },

  reverify(id: string): { verificationId: string } {
    for (const [date, items] of days) {
      const it = items.find((x) => x.id === id);
      if (it) {
        it.displayStatus = "in_progress";
        it.status = "PORTAL";
        it.completedAt = null;
        it.exceptions = [];
        setTimeout(() => {
          const settled = settledItem(date, id);
          if (settled) Object.assign(it, clone(settled));
        }, 3500);
        break;
      }
    }
    return { verificationId: id };
  },

  verifyNow(patientLinkId: string, date: string): { verificationId: string } {
    const it = ensureDay(date).find((x) => x.patientLinkId === patientLinkId);
    if (it) return this.reverify(it.id);
    return { verificationId: `v-${patientLinkId}` };
  },

  resolveException(exceptionId: string): { ok: true } {
    const stamp = new Date().toISOString();
    for (const items of days.values()) {
      for (const it of items) {
        const exc = it.exceptions.find((e) => e.id === exceptionId);
        if (exc) exc.resolvedAt = stamp;
      }
    }
    return { ok: true };
  },

  verification(id: string): VerificationDetail | null {
    // reflect any live status changes from the day store onto the detail
    const detail = buildDetail(id);
    if (!detail) return null;
    for (const items of days.values()) {
      const it = items.find((x) => x.id === id);
      if (it) {
        detail.verification.displayStatus = it.displayStatus;
        detail.exceptions = detail.exceptions.map((e) => {
          const live = it.exceptions.find((x) => x.id === e.id);
          return live ? { ...e, resolvedAt: live.resolvedAt } : e;
        });
      }
    }
    return detail;
  },

  reviewTasks(): ReviewTask[] {
    if (!reviewTasks) reviewTasks = buildReviewTasks();
    return clone(reviewTasks.filter((t) => t.status === "open"));
  },

  completeReview(id: string): { ok: true } {
    if (!reviewTasks) reviewTasks = buildReviewTasks();
    const t = reviewTasks.find((x) => x.id === id);
    if (t) {
      t.status = "completed";
      // the parked verification resumes and finishes
      const date = defaultDate();
      const it = ensureDay(date).find((x) => x.id === t.verificationId);
      if (it) {
        it.displayStatus = "in_progress";
        it.status = "NORMALIZE";
        it.exceptions = [];
        setTimeout(() => {
          it.displayStatus = "verified";
          it.status = "DONE";
          it.completedAt = new Date().toISOString();
        }, 3000);
      }
    }
    return { ok: true };
  },
};
