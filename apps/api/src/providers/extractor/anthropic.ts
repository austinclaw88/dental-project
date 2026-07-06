import Anthropic from "@anthropic-ai/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import { BenefitBreakdown, type ExtractionProvider, type RawCapture } from "@nightshift/schema";

/**
 * AnthropicExtractor — schema-constrained LLM extraction (TDD §3.7).
 * Used ONLY when EXTRACTOR=anthropic and ANTHROPIC_API_KEY is set. Any failure
 * (network, parse, schema) throws so the workflow falls back to HeuristicExtractor.
 *
 * SDK usage per the claude-api skill:
 *   - default model from env ANTHROPIC_MODEL ("claude-sonnet-5" — API-CONTRACT default)
 *   - structured output against the BenefitBreakdown JSON schema (output_config.format)
 *   - strict instruction: never invent values; map provenance artifactIds from context
 */
export class AnthropicExtractor implements ExtractionProvider {
  name = "anthropic";
  private client: Anthropic;
  private model: string;

  constructor(opts: { apiKey: string; model: string }) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.model = opts.model;
  }

  async extract(captures: RawCapture[], hint: { payerKey: string }): Promise<BenefitBreakdown> {
    const jsonSchema = zodToJsonSchema(BenefitBreakdown, { target: "openApi3" });

    const capturesForPrompt = captures.map((c, i) => ({
      index: i,
      kind: c.kind,
      payerKey: c.payerKey,
      // artifactIds MUST be reused verbatim as provenance.artifactId for any field
      // derived from this capture.
      artifactIds: c.artifactIds,
      content: c.content.slice(0, 60_000),
    }));

    const system =
      "You extract a canonical dental BenefitBreakdown from raw payer captures " +
      "(portal HTML, voice-call transcripts). Rules: (1) NEVER invent a value — if a " +
      "field is not present in the captures, set value:null. (2) For every field you " +
      "DO populate, set provenance.source to 'portal' for HTML captures or 'voice_call' " +
      "for transcripts, provenance.artifactId to one of the artifactIds of the capture the " +
      "value came from, and provenance.retrievedAt to an ISO-8601 timestamp. (3) confidence " +
      "is 'high' for values read directly from a label, 'medium' for derived/footnote values, " +
      "'low' for anything inferred. (4) If a payer explicitly does not publish a field, set " +
      "value:null and a short unavailableReason. Output MUST satisfy the provided JSON schema.";

    const user =
      `payerKey: ${hint.payerKey}\n\nCaptures (JSON):\n` +
      JSON.stringify(capturesForPrompt, null, 2) +
      `\n\nReturn the BenefitBreakdown object.`;

    const resp = await this.client.messages.create({
      model: this.model,
      max_tokens: 8192,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { format: { type: "json_schema", schema: jsonSchema as Record<string, unknown> } },
    } as never);

    const block = (resp as { content: Array<{ type: string; text?: string }> }).content.find((b) => b.type === "text");
    if (!block?.text) throw new Error("AnthropicExtractor: no text block in response");
    const parsed = JSON.parse(block.text);
    // Throws on schema mismatch → caller falls back to heuristic.
    return BenefitBreakdown.parse(parsed);
  }
}
