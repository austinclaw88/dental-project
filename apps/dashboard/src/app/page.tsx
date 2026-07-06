"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MetricsSummary, Practice, VerificationListItem } from "../types";
import {
  getDay,
  getMetrics,
  getPractices,
  resolveException,
  reverify,
  runBatch,
} from "../lib/api";
import { fmtDateLong } from "../lib/format";
import { QueueRow } from "../components/QueueRow";
import { SummaryStrip } from "../components/SummaryStrip";
import { OfflineBanner } from "../components/OfflineBanner";

function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export default function MorningQueue() {
  const [practice, setPractice] = useState<Practice | null>(null);
  const [date, setDate] = useState<string>(tomorrow());
  const [items, setItems] = useState<VerificationListItem[] | null>(null);
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  const [batching, setBatching] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // resolve practice once
  useEffect(() => {
    getPractices()
      .then((ps) => setPractice(ps[0] ?? null))
      .catch(() => setPractice(null));
  }, []);

  const load = useCallback(
    async (practiceId: string, d: string) => {
      try {
        const [list, m] = await Promise.all([
          getDay(practiceId, d),
          getMetrics(practiceId, d).catch(() => null),
        ]);
        list.sort((a, b) => a.appointmentAt.localeCompare(b.appointmentAt));
        setItems(list);
        setMetrics(m);
        setLoadError(false);
      } catch {
        setItems([]);
        setLoadError(true);
      }
    },
    [],
  );

  // (re)load when practice or date changes
  useEffect(() => {
    if (practice) {
      setItems(null);
      load(practice.id, date);
    }
  }, [practice, date, load]);

  // auto-refresh every 3s while anything is in progress / planned
  const anyBusy = !!items?.some(
    (i) => i.displayStatus === "in_progress" || i.displayStatus === "planned",
  );
  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (practice && anyBusy) {
      pollRef.current = setInterval(() => load(practice.id, date), 3000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [practice, date, anyBusy, load]);

  const onReverify = useCallback(
    async (id: string) => {
      await reverify(id);
      if (practice) await load(practice.id, date);
    },
    [practice, date, load],
  );

  const onResolve = useCallback(
    async (exceptionId: string) => {
      await resolveException(exceptionId, "front-desk");
      if (practice) await load(practice.id, date);
    },
    [practice, date, load],
  );

  const onRunBatch = useCallback(async () => {
    if (!practice) return;
    setBatching(true);
    try {
      await runBatch(practice.id, date);
      await load(practice.id, date);
    } finally {
      setBatching(false);
    }
  }, [practice, date, load]);

  return (
    <>
      <OfflineBanner />

      <div className="head">
        <div>
          <h1>Morning queue</h1>
          <div className="sub">{fmtDateLong(date)} · {practice?.name ?? "…"}</div>
        </div>
        <div className="head-actions">
          <label className="datefield">
            Schedule date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <button className="btn btn-primary" onClick={onRunBatch} disabled={batching || !practice}>
            {batching ? "Running batch…" : "Run nightly batch"}
          </button>
        </div>
      </div>

      {items && <SummaryStrip items={items} metrics={metrics} />}

      {items === null ? (
        <QueueSkeleton />
      ) : loadError ? (
        <div className="banner error" role="alert">
          Could not load the schedule. Check the API and try again.
        </div>
      ) : items.length === 0 ? (
        <div className="empty">
          <div className="big">☕</div>
          <h3>Nothing on the schedule</h3>
          <p>No appointments for {fmtDateLong(date)}. Pick another date or run the nightly batch.</p>
        </div>
      ) : allClean(items) ? (
        <>
          <div className="empty" style={{ paddingBottom: 20 }}>
            <div className="big">✅</div>
            <h3>All clear — nothing to do</h3>
            <p>Every patient verified clean. The rows below are for reference.</p>
          </div>
          <Queue items={items} onReverify={onReverify} onResolve={onResolve} />
        </>
      ) : (
        <Queue items={items} onReverify={onReverify} onResolve={onResolve} />
      )}
    </>
  );
}

function allClean(items: VerificationListItem[]): boolean {
  return items.every(
    (i) => i.displayStatus === "verified" && i.exceptions.every((e) => e.resolvedAt),
  );
}

function Queue({
  items,
  onReverify,
  onResolve,
}: {
  items: VerificationListItem[];
  onReverify: (id: string) => Promise<void>;
  onResolve: (exceptionId: string) => Promise<void>;
}) {
  return (
    <div className="queue">
      {items.map((it) => (
        <QueueRow key={it.id} item={it} onReverify={onReverify} onResolve={onResolve} />
      ))}
    </div>
  );
}

function QueueSkeleton() {
  return (
    <div className="queue" aria-busy="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div className="skeleton sk-row" key={i} />
      ))}
    </div>
  );
}
