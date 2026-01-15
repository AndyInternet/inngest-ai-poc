import { AzureOpenAI } from "openai";
import type OpenAI from "openai";
import type { ProviderConfig } from "../types";
import { OpenAICompatibleProvider } from "./openai-base";

/**
 * Default Azure OpenAI API version.
 */
const AZURE_DEFAULT_API_VERSION = "2024-02-15-preview";

/**
 * Extended provider configuration for Azure OpenAI.
 */
export type AzureOpenAIProviderConfig = ProviderConfig & {
  /**
   * Azure OpenAI deployment name.
   * This is the name you gave your model deployment in Azure.
   */
  deployment?: string;

  /**
   * Azure OpenAI API version.
   * @default "2024-02-15-preview"
   */
  apiVersion?: string;
};

/**
 * Azure OpenAI LLM provider.
 *
 * Azure OpenAI uses the same API format as OpenAI but requires additional
 * configuration for the Azure endpoint and deployment. This provider handles
 * the Azure-specific authentication and endpoint configuration.
 *
 * ## Required Configuration
 *
 * - `apiKey` - Your Azure OpenAI API key
 * - `baseUrl` - Your Azure OpenAI endpoint (e.g., "https://my-resource.openai.azure.com")
 *
 * ## Optional Configuration
 *
 * - `deployment` - The deployment name (if not specified in the model parameter)
 * - `apiVersion` - API version (defaults to "2024-02-15-preview")
 *
 * @example
 * ```typescript
 * const provider = new AzureOpenAIProvider({
 *   type: "azure-openai",
 *   apiKey: process.env.AZURE_OPENAI_API_KEY,
 *   baseUrl: process.env.AZURE_OPENAI_ENDPOINT,
 *   deployment: "my-gpt4-deployment",
 * });
 *
 * const response = await provider.complete(messages, {
 *   model: "gpt-4", // Or use deployment name
 *   temperature: 0.7,
 *   maxTokens: 1000,
 * });
 * ```
 *
 * @example
 * ```typescript
 * // With specific API version
 * const provider = new AzureOpenAIProvider({
 *   type: "azure-openai",
 *   apiKey: process.env.AZURE_OPENAI_API_KEY,
 *   baseUrl: "https://my-resource.openai.azure.com",
 *   deployment: "gpt-4-turbo",
 *   apiVersion: "2024-05-01-preview",
 * });
 * ```
 */
export class AzureOpenAIProvider extends OpenAICompatibleProvider {
  // AzureOpenAI is compatible with OpenAI type for our purposes
  protected client: OpenAI;

  /**
   * Create a new Azure OpenAI provider instance.
   *
   * @param config - Provider configuration
   * @param config.apiKey - Azure OpenAI API key
   * @param config.baseUrl - Azure OpenAI endpoint URL (required)
   * @param config.deployment - Optional deployment name
   * @param config.apiVersion - Optional API version
   * @throws Error if baseUrl is not provided
   */
  constructor(config: AzureOpenAIProviderConfig) {
    super();

    if (!config.baseUrl) {
      throw new Error(
        "baseUrl is required for Azure OpenAI. " +
          "Provide your Azure OpenAI endpoint (e.g., 'https://my-resource.openai.azure.com')",
      );
    }

    this.client = new AzureOpenAI({
      apiKey: config.apiKey,
      endpoint: config.baseUrl,
      apiVersion: config.apiVersion || AZURE_DEFAULT_API_VERSION,
      deployment: config.deployment,
    }) as unknown as OpenAI;
  }
}
