"use client";
import { useState } from "react";
import { artifactUrl } from "../lib/api";

/**
 * Provenance link. Opens a lightbox that tries to render the artifact as an
 * image (portal screenshot). If it is not an image — HTML/DOM capture, raw 271,
 * call transcript — or the API is offline, the <img> onError swaps in an
 * "open in new tab" link to GET /api/artifacts/:id. (The contract serves each
 * artifact with its own content-type; we detect image-ness by attempting load.)
 */
export function ArtifactLink({
  artifactId,
  label = "source",
  locator,
}: {
  artifactId: string;
  label?: string;
  locator?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const url = artifactUrl(artifactId);

  return (
    <>
      <button
        type="button"
        className="btn-ghost src-link"
        onClick={() => setOpen(true)}
        title={`Provenance: open artifact ${artifactId}${locator ? ` @ ${locator}` : ""}`}
      >
        🔎 {label}
      </button>
      {open && (
        <div className="lb-backdrop" role="dialog" aria-modal="true" onClick={() => setOpen(false)}>
          <div className="lb-panel" onClick={(e) => e.stopPropagation()}>
            <div className="lb-head">
              <strong>Provenance — {artifactId}</strong>
              <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
            {!imgFailed ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt={`Artifact ${artifactId}`} onError={() => setImgFailed(true)} />
            ) : (
              <p className="muted">
                This artifact is not an image (HTML capture, raw 271, or call transcript), or the
                API is offline.{" "}
                <a href={url} target="_blank" rel="noreferrer">
                  Open artifact in new tab ↗
                </a>
              </p>
            )}
            {locator && <p className="faint" style={{ marginTop: 8 }}>Locator: <code>{locator}</code></p>}
          </div>
        </div>
      )}
    </>
  );
}
