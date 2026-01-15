/**
 * LLM Provider Configuration for Games with Branching
 *
 * @module games-with-branching/providers
 */

import type { LLMProvider } from "../../ai/types";
import { createLLMClient } from "../../ai/providers";

/**
 * Get the Anthropic API key from environment.
 */
function getAnthropicApiKey(): string {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY environment variable is required. " +
        "Please set it in your .env file.",
    );
  }
  return apiKey;
}

/**
 * Default model configuration for all agents.
 */
export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

/**
 * Cached LLM provider instance.
 */
let cachedProvider: LLMProvider | null = null;

/**
 * Get or create the LLM provider.
 */
export async function getProvider(): Promise<LLMProvider> {
  if (!cachedProvider) {
    cachedProvider = await createLLMClient({
      type: "anthropic",
      apiKey: getAnthropicApiKey(),
    });
  }
  return cachedProvider;
}
