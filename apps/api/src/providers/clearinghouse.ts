import type { ArtifactStore, EligibilityProvider, EligibilityResult, SubscriberQuery } from "@nightshift/schema";
import { memberBySubscriberId, planForMember } from "../seed.js";

/**
 * MockClearinghouse — deterministic EligibilityProvider (271 stand-in).
 * Looks the subscriber up in docs/SEED-UNIVERSE.json:
 *   - member marked `terminated` -> active:false + planEnd = that date
 *   - everyone else              -> active:true with a plausible planBegin
 * Persists a normalized fake-271 JSON payload as an `x12` artifact for provenance.
 */
export class MockClearinghouse implements EligibilityProvider {
  name = "mock-clearinghouse";

  constructor(private readonly artifacts: ArtifactStore) {}

  async check(q: SubscriberQuery): Promise<EligibilityResult> {
    const member = memberBySubscriberId(q.subscriberId);
    const plan = member ? planForMember(member) : null;

    let active: boolean | null = true;
    let planBegin: string | null = member?.memberSince ?? "2020-01-01";
    let planEnd: string | null = null;

    if (member?.terminated) {
      active = false;
      planEnd = member.terminated;
    }
    if (!member) {
      // Unknown subscriber — clearinghouse returns "no active coverage found".
      active = null;
    }

    const raw = {
      transactionSet: "271",
      subscriberId: q.subscriberId,
      subscriberName: q.subscriberName,
      payerKey: q.payerKey,
      carrierName: plan?.carrierName ?? q.payerKey,
      eligibility: active === false ? "6" /* inactive */ : active === true ? "1" /* active */ : "V" /* cannot process */,
      benefitBegin: planBegin,
      benefitEnd: planEnd,
      planYearStart: plan?.planYearStart ?? null,
      annualMaximum: plan?.annualMax ?? null,
      generatedAt: new Date().toISOString(),
      note: "Simulated 271 (MockClearinghouse). Not a real payer response.",
    };

    const artifactId = await this.artifacts.put({
      kind: "x12",
      contentType: "application/json",
      data: JSON.stringify(raw, null, 2),
    });

    return { active, planBegin, planEnd, raw, artifactId };
  }
}
