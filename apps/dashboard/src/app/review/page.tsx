"use client";
import { useCallback, useEffect, useState } from "react";
import type { ReviewTask } from "../../types";
import { completeReview, getReviewTasks } from "../../lib/api";
import { ReviewCard } from "../../components/ReviewCard";
import { OfflineBanner } from "../../components/OfflineBanner";

export default function ReviewQueue() {
  const [tasks, setTasks] = useState<ReviewTask[] | null>(null);

  const load = useCallback(async () => {
    try {
      setTasks(await getReviewTasks());
    } catch {
      setTasks([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onComplete = useCallback(
    async (id: string, fields: Record<string, unknown>, reviewer: string) => {
      await completeReview(id, fields, reviewer);
      await load();
    },
    [load],
  );

  return (
    <>
      <OfflineBanner />
      <div className="head">
        <div>
          <h1>Review queue</h1>
          <div className="sub">
            Verifications parked for the verification team (low confidence, no portal/voice path).
          </div>
        </div>
      </div>

      {tasks === null ? (
        <div className="skeleton" style={{ height: 120 }} />
      ) : tasks.length === 0 ? (
        <div className="empty">
          <div className="big">✅</div>
          <h3>Review queue empty</h3>
          <p>No open review tasks. Everything is verified automatically.</p>
        </div>
      ) : (
        tasks.map((t) => <ReviewCard key={t.id} task={t} onComplete={onComplete} />)
      )}
    </>
  );
}
