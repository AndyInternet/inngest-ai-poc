import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type {
  LLMProvider,
  LLMMessage,
  LLMConfig,
  LLMResponse,
  LLMStreamChunk,
  ToolCallResponse,
  FunctionDefinition,
} from "../types";

/**
 * Transform LLM messages to OpenAI-compatible format.
 * This handles the conversion of tool calls and tool call IDs.
 *
 * @param messages - Array of LLM messages in our internal format
 * @returns Array of messages in OpenAI-compatible format
 */
export function transformMessagesToOpenAI(
  messages: LLMMessage[],
): ChatCompletionMessageParam[] {
  return messages.map((msg): ChatCompletionMessageParam => {
    if (msg.role === "system") {
      return {
        role: "system",
        content: msg.content,
      };
    }

    if (msg.role === "user") {
      return {
        role: "user",
        content: msg.content,
      };
    }

    if (msg.role === "tool") {
      return {
        role: "tool",
        content: msg.content,
        tool_call_id: msg.toolCallId || "",
      };
    }

    // Assistant message
    const assistantMsg: ChatCompletionMessageParam = {
      role: "assistant",
      content: msg.content,
    };

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      (
        assistantMsg as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam
      ).tool_calls = msg.toolCalls.map((tc: ToolCallResponse) => ({
        id: tc.id,
        type: "function" as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      }));
    }

    return assistantMsg;
  });
}

/**
 * Transform tool definitions to OpenAI-compatible format.
 *
 * @param tools - Array of function definitions in our internal format
 * @returns Array of tools in OpenAI-compatible format
 */
export function transformToolsToOpenAI(tools?: FunctionDefinition[]):
  | Array<{
      type: "function";
      function: {
        name: string;
        description: string;
        parameters: FunctionDefinition["parameters"];
      };
    }>
  | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * Extract tool calls from an OpenAI-compatible response.
 *
 * @param toolCalls - Tool calls from the API response
 * @returns Array of tool call responses in our internal format
 */
export function extractToolCalls(
  toolCalls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>,
): ToolCallResponse[] | undefined {
  if (!toolCalls) {
    return undefined;
  }

  return toolCalls.map((tc) => ({
    id: tc.id,
    type: "function" as const,
    function: {
      name: tc.function.name,
      arguments: tc.function.arguments,
    },
  }));
}

/**
 * Abstract base class for OpenAI-compatible LLM providers.
 *
 * This class provides common functionality for providers that use the OpenAI API
 * format, including OpenAI itself, Grok (xAI), and Azure OpenAI. It handles:
 *
 * - Message format transformation
 * - Tool/function calling
 * - Streaming responses
 * - Usage statistics extraction
 *
 * Subclasses only need to:
 * 1. Initialize the `client` property with the appropriate OpenAI client instance
 * 2. Optionally override methods for provider-specific behavior
 *
 * @example
 * ```typescript
 * class MyProvider extends OpenAICompatibleProvider {
 *   constructor(config: ProviderConfig) {
 *     super();
 *     this.client = new OpenAI({
 *       apiKey: config.apiKey,
 *       baseURL: "https://my-api.example.com/v1",
 *     });
 *   }
 * }
 * ```
 */
export abstract class OpenAICompatibleProvider implements LLMProvider {
  /**
   * The OpenAI client instance.
   * Subclasses must initialize this in their constructor.
   */
  protected abstract client: OpenAI;

  /**
   * Complete a chat conversation and return the full response.
   *
   * @param messages - Array of messages in the conversation
   * @param config - LLM configuration (model, temperature, etc.)
   * @returns Promise resolving to the LLM response
   */
  async complete(
    messages: LLMMessage[],
    config: LLMConfig,
  ): Promise<LLMResponse> {
    const openaiMessages = transformMessagesToOpenAI(messages);

    const response = await this.client.chat.completions.create({
      model: config.model,
      messages: openaiMessages,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      top_p: config.topP,
      tools: transformToolsToOpenAI(config.tools),
      stream: false,
    });

    const choice = response.choices[0];
    const toolCalls = extractToolCalls(choice.message.tool_calls);

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

  /**
   * Stream a chat conversation response.
   *
   * Note: Streaming currently does not support tool calls. If tool calling
   * is needed, use the `complete` method instead.
   *
   * @param messages - Array of messages in the conversation
   * @param config - LLM configuration (model, temperature, etc.)
   * @yields LLM stream chunks with content and optional finish reason
   */
  async *stream(
    messages: LLMMessage[],
    config: LLMConfig,
  ): AsyncIterableIterator<LLMStreamChunk> {
    const openaiMessages = transformMessagesToOpenAI(messages);

    const stream = await this.client.chat.completions.create({
      model: config.model,
      messages: openaiMessages,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      top_p: config.topP,
      // Note: Tool calling during streaming is not yet supported
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        yield {
          content: delta.content,
          finishReason: chunk.choices[0]?.finish_reason || undefined,
        };
      } else if (chunk.choices[0]?.finish_reason) {
        // Emit finish reason even without content
        yield {
          content: "",
          finishReason: chunk.choices[0].finish_reason,
        };
      }
    }
  }
}
