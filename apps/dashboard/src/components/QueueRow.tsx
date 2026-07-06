"use client";
import Link from "next/link";
import { useState } from "react";
import type { ListException, VerificationListItem } from "../types";
import { fmtTime } from "../lib/format";
import { StatusPill } from "./StatusPill";

export function QueueRow({
  item,
  onReverify,
  onResolve,
}: {
  item: VerificationListItem;
  onReverify: (id: string) => Promise<void> | void;
  onResolve: (exceptionId: string) => Promise<void> | void;
}) {
  const [reverifying, setReverifying] = useState(false);
  const unresolved = item.exceptions.filter((e) => !e.resolvedAt);
  const busy = item.displayStatus === "in_progress" || item.displayStatus === "planned";

  async function handleReverify() {
    setReverifying(true);
    try {
      await onReverify(item.id);
    } finally {
      setReverifying(false);
    }
  }

  return (
    <div className="qrow" data-testid="queue-row">
      <div className="qrow-main">
        <div className="qtime">
          {fmtTime(item.appointmentAt)}
          <small>{item.provider ?? "—"}</small>
        </div>
        <div className="qpatient">
          <div className="name">{item.patientName}</div>
          <div className="meta">{item.scope === "eligibility_only" ? "Eligibility only" : "Full breakdown"}</div>
        </div>
        <div className="qcarrier">{item.carrierName ?? "No carrier on file"}</div>
        <div className="qchips">
          {item.cdtCodes.map((c, i) => (
            <span className="chip" key={`${c}-${i}`}>
              {c}
            </span>
          ))}
        </div>
        <div className="qright">
          <StatusPill status={item.displayStatus} />
          <Link className="btn btn-sm" href={`/verifications/${item.id}`}>
            Details
          </Link>
          <button
            type="button"
            className="btn btn-sm"
            onClick={handleReverify}
            disabled={reverifying || busy}
          >
            {reverifying || busy ? "Re-verifying…" : "Re-verify"}
          </button>
        </div>
      </div>

      {unresolved.length > 0 && (
        <div className="exceptions">
          {unresolved.map((e) => (
            <ExceptionRow key={e.id} exc={e} onResolve={onResolve} />
          ))}
        </div>
      )}

      {unresolved.length === 0 && item.exceptions.length > 0 && (
        <div className="exceptions">
          {item.exceptions.map((e) => (
            <div className={`exc exc-${e.severity} resolved`} key={e.id}>
              <span className="tag">{e.type.replace(/_/g, " ")}</span>
              <span className="msg">{e.message}</span>
              <span className="resolvedby">✓ resolved</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExceptionRow({
  exc,
  onResolve,
}: {
  exc: ListException;
  onResolve: (exceptionId: string) => Promise<void> | void;
}) {
  const [resolving, setResolving] = useState(false);
  async function handle() {
    setResolving(true);
    try {
      await onResolve(exc.id);
    } finally {
      setResolving(false);
    }
  }
  return (
    <div className={`exc exc-${exc.severity}`} data-testid="exception-row">
      <span className="tag">{exc.type.replace(/_/g, " ")}</span>
      <span className="msg">{exc.message}</span>
      <button type="button" className="btn btn-sm" onClick={handle} disabled={resolving}>
        {resolving ? "Resolving…" : "Resolve"}
      </button>
    </div>
  );
}
