import type { ArtifactStore, SubscriberQuery, VoiceCallResult, VoicePipeline } from "@nightshift/schema";
import { memberBySubscriberId, planForMember } from "../seed.js";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VOICE TRANSCRIPT LINE GRAMMAR  (shared contract with HeuristicExtractor)
 * ─────────────────────────────────────────────────────────────────────────────
 * The extractor parses BENEFIT FACTS only from lines that begin with "REP:" and
 * contain a single "key: value" pair after the speaker tag:
 *
 *     REP: <label>: <value>
 *
 * e.g.  "REP: Annual maximum: $1,500.00"
 *       "REP: Prophylaxis: 2 per calendar year, 1 used, last on 02/10/2026"
 *
 * Non-REP lines (IVR:, HOLD, AGENT:, SYSTEM:) are conversational scaffolding and
 * are IGNORED by extraction. The label vocabulary is the SAME keyword set the
 * HTML extractor keys on (max/remaining/deductible/preventive/…), so one matcher
 * handles both portal tables and voice transcripts. See heuristic.ts::PAIR_RULES.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export class SimulatedVoice implements VoicePipeline {
  name = "simulated-voice";

  constructor(private readonly artifacts: ArtifactStore) {}

  async callPayer(q: SubscriberQuery, opts: { practiceName: string }): Promise<VoiceCallResult> {
    // Only mock-guardian has a learned IVR map + scripted rep interaction.
    if (q.payerKey !== "mock-guardian") {
      return {
        completed: false,
        transcript: "",
        audioArtifactId: null,
        transcriptArtifactId: null,
        abortReason: "no_ivr_map",
        durationSeconds: 0,
      };
    }

    const member = memberBySubscriberId(q.subscriberId);
    const plan = member ? planForMember(member) : null;
    if (!member || !plan) {
      return {
        completed: false,
        transcript: "",
        audioArtifactId: null,
        transcriptArtifactId: null,
        abortReason: "member_not_found",
        durationSeconds: 0,
      };
    }

    const transcript = buildTranscript(q, opts.practiceName, member, plan);
    const transcriptArtifactId = await this.artifacts.put({
      kind: "transcript",
      contentType: "text/plain",
      data: transcript,
    });

    return {
      completed: true,
      transcript,
      audioArtifactId: null, // no audio synthesis in the sim
      transcriptArtifactId,
      abortReason: null,
      durationSeconds: 1140, // ~19 min, mostly hold — matches TDD §3.5 economics
    };
  }
}

function money(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function mmddyyyy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

function buildTranscript(
  q: SubscriberQuery,
  practiceName: string,
  member: ReturnType<typeof memberBySubscriberId> & object,
  plan: NonNullable<ReturnType<typeof planForMember>>,
): string {
  const usage = (member.usage ?? {}) as Record<string, number | string>;
  const maxUsed = Number(usage.maxUsed ?? 0);
  const remaining = plan.annualMax - maxUsed;
  const dedMet = Number(usage.dedIndividualMet ?? 0);

  const L: string[] = [];
  L.push(`SYSTEM: Outbound call to Guardian Mock benefits line, ${new Date().toISOString()}`);
  L.push(`IVR: Thank you for calling Guardian Mock. For provider services, say "provider" or press 1.`);
  L.push(`AGENT: Provider.`);
  L.push(`IVR: Please enter or say the subscriber ID.`);
  L.push(`AGENT: ${q.subscriberId}.`);
  L.push(`HOLD: [hold music — 14m22s]`);
  L.push(
    `AGENT: Hi, this is an automated verification assistant calling on behalf of ${practiceName}. ` +
      `I'm not a live person; I'm confirming dental benefits. May I read back a few items?`,
  );
  L.push(`REP: Sure, go ahead. Let me pull up ${member.patient.first} ${member.patient.last}.`);
  L.push(`REP: Plan status: Active`);
  L.push(`REP: Effective date: ${mmddyyyy(member.memberSince ?? "2020-01-01")}`);
  L.push(`REP: Plan year: ${plan.planYearStart === "calendar" ? "Calendar year" : plan.planYearStart}`);
  L.push(`REP: Annual maximum: ${money(plan.annualMax)}`);
  L.push(`REP: Maximum used: ${money(maxUsed)}`);
  L.push(`REP: Maximum remaining: ${money(remaining)}`);
  L.push(`REP: Individual deductible: ${money(plan.dedIndividual)}`);
  L.push(`REP: Deductible met: ${money(dedMet)}`);
  if (plan.dedFamily != null) L.push(`REP: Family deductible: ${money(plan.dedFamily)}`);
  L.push(`REP: Deductible applies to: ${plan.dedAppliesTo.join(", ")}`);
  L.push(`REP: Preventive: ${plan.coverage.preventive}%`);
  L.push(`REP: Basic: ${plan.coverage.basic}%`);
  L.push(`REP: Major: ${plan.coverage.major}%`);
  L.push(`REP: Ortho: ${plan.coverage.ortho}%`);
  // Frequencies with usage read-back.
  if (plan.frequencies.prophylaxis) {
    const used = usage.prophyUsed != null ? Number(usage.prophyUsed) : 0;
    const last = usage.prophyLast ? `, last on ${mmddyyyy(String(usage.prophyLast))}` : "";
    L.push(`REP: Prophylaxis: ${plan.frequencies.prophylaxis}, ${used} used${last}`);
  }
  if (plan.frequencies.bitewings) {
    const used = usage.bwxUsed != null ? Number(usage.bwxUsed) : 0;
    L.push(`REP: Bitewings: ${plan.frequencies.bitewings}, ${used} used`);
  }
  if (plan.frequencies.exam) {
    const used = usage.examUsed != null ? Number(usage.examUsed) : 0;
    L.push(`REP: Exam: ${plan.frequencies.exam}, ${used} used`);
  }
  L.push(`AGENT: Great, so preventive at ${plan.coverage.preventive}% and a ${money(plan.annualMax)} annual max — confirmed?`);
  L.push(`REP: That's correct.`);
  L.push(`AGENT: Thank you very much. Have a good day.`);
  L.push(`SYSTEM: Call ended (completed).`);
  return L.join("\n");
}
