import OpenAI from "openai";
import type { ProviderConfig } from "../types";
import { OpenAICompatibleProvider } from "./openai-base";

/**
 * Default base URL for the Grok (xAI) API.
 */
const GROK_DEFAULT_BASE_URL = "https://api.x.ai/v1";

/**
 * Grok (xAI) LLM provider.
 *
 * Grok uses an OpenAI-compatible API, so this provider extends the
 * OpenAI-compatible base class. It supports Grok models with both
 * completion and streaming interfaces.
 *
 * @example
 * ```typescript
 * const provider = new GrokProvider({
 *   type: "grok",
 *   apiKey: process.env.XAI_API_KEY,
 * });
 *
 * const response = await provider.complete(messages, {
 *   model: "grok-1",
 *   temperature: 0.7,
 *   maxTokens: 1000,
 * });
 * ```
 *
 * @example
 * ```typescript
 * // With custom base URL
 * const provider = new GrokProvider({
 *   type: "grok",
 *   apiKey: process.env.XAI_API_KEY,
 *   baseUrl: "https://custom-grok-proxy.example.com/v1",
 * });
 * ```
 */
export class GrokProvider extends OpenAICompatibleProvider {
  protected client: OpenAI;

  /**
   * Create a new Grok provider instance.
   *
   * @param config - Provider configuration
   * @param config.apiKey - xAI API key
   * @param config.baseUrl - Optional custom base URL (defaults to https://api.x.ai/v1)
   */
  constructor(config: ProviderConfig) {
    super();
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || GROK_DEFAULT_BASE_URL,
    });
  }
}
