import type { ProviderConfig, LLMProvider } from "../types";

export async function createLLMClient(
  config: ProviderConfig,
): Promise<LLMProvider> {
  switch (config.type) {
    case "openai":
      const { OpenAIProvider } = await import("./openai.js");
      return new OpenAIProvider(config);
    case "anthropic":
      const { AnthropicProvider } = await import("./anthropic.js");
      return new AnthropicProvider(config);
    case "gemini":
      const { GeminiProvider } = await import("./gemini.js");
      return new GeminiProvider(config);
    case "grok":
      const { GrokProvider } = await import("./grok.js");
      return new GrokProvider(config);
    case "azure-openai":
      const { AzureOpenAIProvider } = await import("./azure-openai.js");
      return new AzureOpenAIProvider(config);
    default:
      throw new Error(`Unsupported provider type: ${config.type}`);
  }
}
