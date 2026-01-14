export type LLMMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type FunctionDefinition = {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, any>;
    required: string[];
  };
};

export type LLMConfig = {
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
  tools?: FunctionDefinition[];
};

export type LLMResponse = {
  content: string;
  finishReason?: string;
  toolCalls?: ToolCall[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
};

export type LLMStreamChunk = {
  content: string;
  finishReason?: string;
};

export interface LLMProvider {
  complete(messages: LLMMessage[], config: LLMConfig): Promise<LLMResponse>;

  stream(
    messages: LLMMessage[],
    config: LLMConfig,
  ): AsyncIterableIterator<LLMStreamChunk>;
}

export type ProviderType =
  | "openai"
  | "anthropic"
  | "gemini"
  | "grok"
  | "azure-openai";

export type ProviderConfig = {
  type: ProviderType;
  apiKey: string;
  baseUrl?: string;
  organizationId?: string;
};

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
