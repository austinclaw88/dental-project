"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { VerificationDetail } from "../../../types";
import { getVerification, reverify } from "../../../lib/api";
import { fmtDate, fmtTime, STATUS_LABEL } from "../../../lib/format";
import { StatusPill } from "../../../components/StatusPill";
import { BreakdownForm } from "../../../components/BreakdownForm";
import { Timeline } from "../../../components/Timeline";
import { Writebacks } from "../../../components/Writebacks";
import { OfflineBanner } from "../../../components/OfflineBanner";

export default function VerificationDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [data, setData] = useState<VerificationDetail | null | undefined>(undefined);
  const [reverifying, setReverifying] = useState(false);

  async function load() {
    try {
      setData(await getVerification(id));
    } catch {
      setData(null);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onReverify() {
    setReverifying(true);
    try {
      await reverify(id);
      await load();
    } finally {
      setReverifying(false);
    }
  }

  if (data === undefined) {
    return (
      <>
        <BackLink />
        <div className="skeleton" style={{ height: 120, marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 320 }} />
      </>
    );
  }
  if (data === null) {
    return (
      <>
        <BackLink />
        <OfflineBanner />
        <div className="empty">
          <div className="big">🔍</div>
          <h3>Verification not found</h3>
          <p>No verification with id <code>{id}</code>.</p>
        </div>
      </>
    );
  }

  const { verification, patient, coverage, appointment, steps, snapshot, exceptions, writebacks } = data;
  const unresolved = exceptions.filter((e) => !e.resolvedAt);

  return (
    <>
      <BackLink />
      <OfflineBanner />

      <div className="head">
        <div>
          <h1>
            {patient.firstName} {patient.lastName}
          </h1>
          <div className="sub">
            {fmtTime(appointment.startsAt)} · {appointment.provider ?? "—"} · {appointment.cdtCodes.join(", ")}
          </div>
        </div>
        <div className="head-actions">
          <StatusPill status={verification.displayStatus} />
          <button className="btn" onClick={onReverify} disabled={reverifying}>
            {reverifying ? "Re-verifying…" : "Re-verify"}
          </button>
        </div>
      </div>

      {/* coverage header */}
      <div className="card">
        <div className="cover-head">
          <F k="Carrier" v={coverage.carrierName} />
          <F k="Subscriber" v={coverage.subscriberName} />
          <F k="Subscriber ID" v={coverage.subscriberId} />
          <F k="Group" v={coverage.groupNumber ?? coverage.groupName ?? "—"} />
          <F k="Relationship" v={coverage.relationship} />
          <F k="Date of birth" v={fmtDate(patient.birthdate)} />
          <F k="Status" v={STATUS_LABEL[verification.displayStatus]} />
          <F k="Completed" v={verification.completedAt ? fmtDate(verification.completedAt) : "—"} />
        </div>
      </div>

      {unresolved.length > 0 && (
        <div className="card" style={{ paddingTop: 8, paddingBottom: 8 }}>
          {unresolved.map((e) => (
            <div className={`exc exc-${e.severity}`} key={e.id} style={{ border: "none" }}>
              <span className="tag">{e.type.replace(/_/g, " ")}</span>
              <span className="msg">{e.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* breakdown — the paper form */}
      <div className="card">
        <h2>Benefit breakdown</h2>
        {snapshot ? (
          <BreakdownForm b={snapshot.breakdown} />
        ) : verification.displayStatus === "in_progress" ? (
          <p className="muted">
            Breakdown not available yet — verification is still running
            {steps.some((s) => s.kind === "human")
              ? " (parked for human review; being completed by our team)."
              : "."}
          </p>
        ) : (
          <p className="muted">No breakdown captured for this verification.</p>
        )}
      </div>

      <div className="card">
        <h2>Verification steps</h2>
        <Timeline steps={steps} />
      </div>

      <div className="card">
        <h2>OpenDental writebacks</h2>
        <Writebacks writebacks={writebacks} />
      </div>
    </>
  );
}

function F({ k, v }: { k: string; v: string }) {
  return (
    <div className="f">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}

function BackLink() {
  return (
    <Link className="backlink" href="/">
      ← Morning queue
    </Link>
  );
}
