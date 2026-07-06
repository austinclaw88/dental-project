import { z } from "zod";
import type { BenefitBreakdown } from "./benefits.js";

/**
 * Provider interfaces (TDD §3.3–3.7). Implementations live in apps/api and
 * packages/portal; these types are the seam.
 */

export const SubscriberQuery = z.object({
  subscriberId: z.string(),
  subscriberName: z.string(),
  patientFirstName: z.string(),
  patientLastName: z.string(),
  patientBirthdate: z.string(),
  groupNumber: z.string().nullable(),
  payerKey: z.string(),
});
export type SubscriberQuery = z.infer<typeof SubscriberQuery>;

export const EligibilityResult = z.object({
  active: z.boolean().nullable(),
  planBegin: z.string().nullable(),
  planEnd: z.string().nullable(),
  /** raw normalized 271-ish payload, stored as an artifact for provenance */
  raw: z.record(z.unknown()),
  artifactId: z.string().nullable(),
});
export type EligibilityResult = z.infer<typeof EligibilityResult>;

export interface EligibilityProvider {
  name: string;
  check(q: SubscriberQuery): Promise<EligibilityResult>;
}

/**
 * RawCapture — what a portal adapter or voice call produces. Extraction is
 * NOT the adapter's job (capture-then-extract, TDD §3.4).
 */
export const RawCapture = z.object({
  kind: z.enum(["portal_page", "portal_pdf", "voice_transcript", "x12_271"]),
  payerKey: z.string(),
  /** artifact ids already persisted to the artifact store */
  artifactIds: z.array(z.string()),
  /** primary machine-readable content: HTML for portal_page, transcript text for voice */
  content: z.string(),
  capturedAt: z.string(),
  meta: z.record(z.unknown()).default({}),
});
export type RawCapture = z.infer<typeof RawCapture>;

export interface ExtractionProvider {
  name: string;
  /**
   * Extract a (partial) BenefitBreakdown from raw captures. Implementations
   * must set per-field provenance referencing the capture's artifactIds and
   * NEVER invent values (missing → value:null).
   */
  extract(captures: RawCapture[], hint: { payerKey: string }): Promise<BenefitBreakdown>;
}

export const VoiceCallResult = z.object({
  completed: z.boolean(),
  transcript: z.string(),
  audioArtifactId: z.string().nullable(),
  transcriptArtifactId: z.string().nullable(),
  /** why the call ended early, if it did (routes to human review — PRD R11) */
  abortReason: z.string().nullable(),
  durationSeconds: z.number(),
});
export type VoiceCallResult = z.infer<typeof VoiceCallResult>;

export interface VoicePipeline {
  name: string;
  callPayer(q: SubscriberQuery, opts: { practiceName: string }): Promise<VoiceCallResult>;
}

/** Artifact store — filesystem in dev, object store in prod (TDD §2). */
export interface ArtifactStore {
  put(opts: {
    kind: string; // "screenshot" | "dom" | "transcript" | "x12" | "pdf" | "audio"
    contentType: string;
    data: Buffer | string;
    verificationId?: string | null;
  }): Promise<string>; // returns artifactId
  getPath(artifactId: string): Promise<{ path: string; contentType: string }>;
}
