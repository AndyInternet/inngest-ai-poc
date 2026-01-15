/**
 * LLM Provider Configuration for Feature Validation
 *
 * This file handles LLM provider setup and configuration for the
 * feature validation agents.
 *
 * @module feature-validation/providers
 */

import type { LLMProvider } from "../../ai/types";
import { createLLMClient } from "../../ai/providers";

// ============================================================================
// Configuration
// ============================================================================

/**
 * Get the Anthropic API key from environment.
 * Throws a helpful error if not configured.
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

// ============================================================================
// Provider Management
// ============================================================================

/**
 * Cached LLM provider instance.
 * Reusing the provider avoids creating multiple client instances.
 */
let cachedProvider: LLMProvider | null = null;

/**
 * Get or create the LLM provider.
 *
 * This function caches the provider instance to avoid creating
 * multiple client instances during a single workflow execution.
 *
 * @returns The LLM provider instance
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
