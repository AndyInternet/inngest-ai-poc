import OpenAI from "openai";
import type { ProviderConfig } from "../types";
import { OpenAICompatibleProvider } from "./openai-base";

/**
 * OpenAI LLM provider.
 *
 * Supports all OpenAI chat models including GPT-4, GPT-4 Turbo, GPT-3.5 Turbo,
 * and newer models. Provides both completion and streaming interfaces with
 * full tool/function calling support.
 *
 * @example
 * ```typescript
 * const provider = new OpenAIProvider({
 *   type: "openai",
 *   apiKey: process.env.OPENAI_API_KEY,
 * });
 *
 * const response = await provider.complete(messages, {
 *   model: "gpt-4-turbo",
 *   temperature: 0.7,
 *   maxTokens: 1000,
 * });
 * ```
 *
 * @example
 * ```typescript
 * // With organization ID
 * const provider = new OpenAIProvider({
 *   type: "openai",
 *   apiKey: process.env.OPENAI_API_KEY,
 *   organizationId: "org-xxx",
 * });
 * ```
 *
 * @example
 * ```typescript
 * // With custom base URL (for proxies or compatible APIs)
 * const provider = new OpenAIProvider({
 *   type: "openai",
 *   apiKey: process.env.OPENAI_API_KEY,
 *   baseUrl: "https://my-proxy.example.com/v1",
 * });
 * ```
 */
export class OpenAIProvider extends OpenAICompatibleProvider {
  protected client: OpenAI;

  /**
   * Create a new OpenAI provider instance.
   *
   * @param config - Provider configuration
   * @param config.apiKey - OpenAI API key
   * @param config.baseUrl - Optional custom base URL
   * @param config.organizationId - Optional organization ID
   */
  constructor(config: ProviderConfig) {
    super();
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      organization: config.organizationId,
    });
  }
}
