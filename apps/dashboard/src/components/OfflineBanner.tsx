"use client";
import { useEffect, useState } from "react";
import { API_URL, isOffline, onOfflineChange } from "../lib/api";

/** Shows a persistent banner whenever the live API is unreachable. */
export function OfflineBanner() {
  const [off, setOff] = useState(false);
  useEffect(() => {
    setOff(isOffline());
    return onOfflineChange(setOff);
  }, []);
  if (!off) return null;
  return (
    <div className="banner" role="alert">
      <span aria-hidden>⚠️</span>
      <span>
        API offline — can’t reach {API_URL}. Showing demo fixture data; actions are simulated
        locally. Start <code>apps/api</code> on port 4000 to use live verifications.
      </span>
    </div>
  );
}
