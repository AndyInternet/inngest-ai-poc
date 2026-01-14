import { AzureOpenAI } from "openai";
import type {
  LLMProvider,
  LLMMessage,
  LLMConfig,
  LLMResponse,
  LLMStreamChunk,
  ProviderConfig,
} from "./index";

export class AzureOpenAIProvider implements LLMProvider {
  private client: AzureOpenAI;

  constructor(
    config: ProviderConfig & { deployment?: string; apiVersion?: string },
  ) {
    if (!config.baseUrl) {
      throw new Error("baseUrl is required for Azure OpenAI");
    }

    this.client = new AzureOpenAI({
      apiKey: config.apiKey,
      endpoint: config.baseUrl,
      apiVersion: config.apiVersion || "2024-02-15-preview",
      deployment: config.deployment,
    });
  }

  async complete(
    messages: LLMMessage[],
    config: LLMConfig,
  ): Promise<LLMResponse> {
    const azureMessages = messages.map((msg) => {
      const base: any = {
        role: msg.role === "tool" ? "tool" : msg.role,
        content: msg.content,
      };

      if (msg.toolCalls) {
        base.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: tc.type,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        }));
      }

      if (msg.toolCallId) {
        base.tool_call_id = msg.toolCallId;
      }

      return base;
    });

    const response = await this.client.chat.completions.create({
      model: config.model,
      messages: azureMessages,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      top_p: config.topP,
      tools: config.tools?.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
      stream: false,
    });

    const choice = response.choices[0];
    const toolCalls = choice.message.tool_calls?.map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments,
      },
    }));

    return {
      content: choice.message.content || "",
      finishReason: choice.finish_reason,
      toolCalls,
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
    };
  }

  async *stream(
    messages: LLMMessage[],
    config: LLMConfig,
  ): AsyncIterableIterator<LLMStreamChunk> {
    const azureMessages = messages.map((msg) => {
      const base: any = {
        role: msg.role === "tool" ? "tool" : msg.role,
        content: msg.content,
      };

      if (msg.toolCalls) {
        base.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: tc.type,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        }));
      }

      if (msg.toolCallId) {
        base.tool_call_id = msg.toolCallId;
      }

      return base;
    });

    const stream = await this.client.chat.completions.create({
      model: config.model,
      messages: azureMessages,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      top_p: config.topP,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        yield {
          content: delta.content,
          finishReason: chunk.choices[0]?.finish_reason || undefined,
        };
      }
    }
  }
}
