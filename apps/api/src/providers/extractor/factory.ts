import type { ExtractionProvider } from "@nightshift/schema";
import type { Config } from "../../config.js";
import { HeuristicExtractor } from "./heuristic.js";

/**
 * ExtractionProvider factory (TDD §3.7). Returns an extractor per payer.
 * Default: HeuristicExtractor (deterministic). When EXTRACTOR=anthropic and a
 * key is present, wraps AnthropicExtractor with a heuristic fallback so any LLM
 * failure degrades gracefully rather than failing the verification.
 */
export function makeExtractorFactory(config: Config): (payerKey: string) => ExtractionProvider {
  const heuristic = new HeuristicExtractor();

  if (config.extractor === "anthropic" && config.anthropicApiKey) {
    // Lazy import so tests / heuristic-mode never load the SDK.
    let fallbackWrapped: ExtractionProvider | null = null;
    return (_payerKey: string) => {
      if (fallbackWrapped) return fallbackWrapped;
      fallbackWrapped = {
        name: "anthropic+heuristic-fallback",
        async extract(captures, hint) {
          try {
            const { AnthropicExtractor } = await import("./anthropic.js");
            const llm = new AnthropicExtractor({
              apiKey: config.anthropicApiKey as string,
              model: config.anthropicModel,
            });
            return await llm.extract(captures, hint);
          } catch (err) {
            console.warn(`[extractor] AnthropicExtractor failed, falling back to heuristic: ${(err as Error).message}`);
            return heuristic.extract(captures, hint);
          }
        },
      };
      return fallbackWrapped;
    };
  }

  return (_payerKey: string) => heuristic;
}
