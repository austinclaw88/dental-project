"use client";
import Link from "next/link";
import { useState } from "react";
import type { ListException, VerificationListItem } from "../types";
import { fmtTime } from "../lib/format";
import { StatusPill } from "./StatusPill";

const EXC_ICON: Record<string, string> = { info: "ⓘ", warning: "⚠︎", critical: "⛔" };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const a = parts[0]?.[0] ?? "";
  const b = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (a + b).toUpperCase();
}

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
  const resolved = item.exceptions.filter((e) => e.resolvedAt);
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
    <div className={`qrow st-${item.displayStatus}`} data-testid="queue-row">
      <div className="qrow-main">
        <div className="qtime">
          {fmtTime(item.appointmentAt)}
          <small>{item.provider ?? "—"}</small>
        </div>
        <div className="qpatient">
          <span className="avatar" aria-hidden>{initials(item.patientName)}</span>
          <span className="who">
            <span className="name">{item.patientName}</span>
            <span className="meta">{item.scope === "eligibility_only" ? "Eligibility only" : "Full breakdown"}</span>
          </span>
        </div>
        <div className={`qcarrier${item.carrierName ? "" : " nocarrier"}`}>
          {item.carrierName ?? "No carrier on file"}
        </div>
        <div className="qchips">
          {item.cdtCodes.map((c, i) => (
            <span className="chip" key={`${c}-${i}`}>
              {c}
            </span>
          ))}
        </div>
        <div className="qstatus">
          <StatusPill status={item.displayStatus} />
        </div>
        <div className="qright">
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

      {(unresolved.length > 0 || resolved.length > 0) && (
        <div className="exceptions">
          {unresolved.map((e) => (
            <ExceptionRow key={e.id} exc={e} onResolve={onResolve} />
          ))}
          {resolved.map((e) => (
            <div className={`exc exc-${e.severity} resolved`} key={e.id} data-testid="exception-row">
              <span className="excico" aria-hidden>✓</span>
              <span className="msg">
                <span className="rlabel">Resolved</span> · {e.type.replace(/_/g, " ")} — {e.message}
              </span>
              <span />
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
      <span className="excico" aria-hidden>{EXC_ICON[exc.severity] ?? "ⓘ"}</span>
      <span className="msg">
        <span className="tag">{exc.type.replace(/_/g, " ")}</span>
        {exc.message}
      </span>
      <button type="button" className="btn btn-sm" onClick={handle} disabled={resolving}>
        {resolving ? "Resolving…" : "Resolve"}
      </button>
    </div>
  );
}
