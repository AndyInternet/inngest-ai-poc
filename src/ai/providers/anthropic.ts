import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  ToolUseBlock,
  ToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/messages";
import type {
  LLMProvider,
  LLMMessage,
  LLMConfig,
  LLMResponse,
  LLMStreamChunk,
  ProviderConfig,
  ToolCallResponse,
  FunctionDefinition,
} from "../types";

/**
 * Content block types for Anthropic assistant messages.
 */
type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

/**
 * Transform our internal tool definitions to Anthropic's tool format.
 *
 * @param tools - Array of function definitions in our internal format
 * @returns Array of tools in Anthropic's format
 */
function transformToolsToAnthropic(
  tools?: FunctionDefinition[],
): Anthropic.Tool[] | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: "object" as const,
      properties: tool.parameters.properties,
      required: tool.parameters.required,
    },
  }));
}

/**
 * Transform our internal messages to Anthropic's message format.
 *
 * Anthropic has a different message structure than OpenAI:
 * - System messages are passed separately, not in the messages array
 * - Tool use and tool results are content blocks within messages
 * - Messages must alternate between user and assistant roles
 *
 * @param messages - Array of messages in our internal format (excluding system)
 * @returns Array of messages in Anthropic's format
 */
function transformMessagesToAnthropic(messages: LLMMessage[]): MessageParam[] {
  const result: MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      // System messages are handled separately
      continue;
    }

    if (msg.role === "user") {
      result.push({
        role: "user",
        content: msg.content,
      });
      continue;
    }

    if (msg.role === "assistant") {
      // Assistant message may contain text and/or tool use blocks
      const contentBlocks: AnthropicContentBlock[] = [];

      // Add text content if present
      if (msg.content) {
        contentBlocks.push({
          type: "text",
          text: msg.content,
        });
      }

      // Add tool use blocks if present
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const toolCall of msg.toolCalls) {
          contentBlocks.push({
            type: "tool_use",
            id: toolCall.id,
            name: toolCall.function.name,
            input: JSON.parse(toolCall.function.arguments),
          });
        }
      }

      if (contentBlocks.length > 0) {
        result.push({
          role: "assistant",
          content: contentBlocks,
        });
      }
      continue;
    }

    if (msg.role === "tool") {
      // Tool results in Anthropic are user messages with tool_result content blocks
      result.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: msg.toolCallId || "",
            content: msg.content,
          } as ToolResultBlockParam,
        ],
      });
      continue;
    }
  }

  return result;
}

/**
 * Extract tool calls from Anthropic's response content blocks.
 *
 * @param content - Array of content blocks from Anthropic's response
 * @returns Array of tool calls in our internal format, or undefined if none
 */
function extractToolCallsFromAnthropic(
  content: Anthropic.ContentBlock[],
): ToolCallResponse[] | undefined {
  const toolUseBlocks = content.filter(
    (block): block is ToolUseBlock => block.type === "tool_use",
  );

  if (toolUseBlocks.length === 0) {
    return undefined;
  }

  return toolUseBlocks.map((block) => ({
    id: block.id,
    type: "function" as const,
    function: {
      name: block.name,
      arguments: JSON.stringify(block.input),
    },
  }));
}

/**
 * Extract text content from Anthropic's response content blocks.
 *
 * @param content - Array of content blocks from Anthropic's response
 * @returns Combined text content from all text blocks
 */
function extractTextFromAnthropic(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/**
 * Anthropic Claude LLM provider.
 *
 * Supports Claude 3 (Opus, Sonnet, Haiku) and Claude 2 models with both
 * completion and streaming interfaces. Includes full tool/function calling
 * support using Anthropic's native tool use format.
 *
 * ## Key Differences from OpenAI
 *
 * 1. **System messages**: Passed separately via the `system` parameter,
 *    not included in the messages array.
 *
 * 2. **Tool calling format**: Anthropic uses `tool_use` and `tool_result`
 *    content blocks rather than separate message roles.
 *
 * 3. **Message alternation**: Messages must strictly alternate between
 *    user and assistant roles (tool results are user messages).
 *
 * 4. **Multiple system messages**: If multiple system messages are provided,
 *    they are joined with newlines.
 *
 * @example
 * ```typescript
 * const provider = new AnthropicProvider({
 *   type: "anthropic",
 *   apiKey: process.env.ANTHROPIC_API_KEY,
 * });
 *
 * const response = await provider.complete(messages, {
 *   model: "claude-3-opus-20240229",
 *   temperature: 0.7,
 *   maxTokens: 1000,
 * });
 * ```
 *
 * @example
 * ```typescript
 * // With tools
 * const response = await provider.complete(messages, {
 *   model: "claude-3-sonnet-20240229",
 *   maxTokens: 1000,
 *   tools: [
 *     {
 *       name: "get_weather",
 *       description: "Get current weather for a location",
 *       parameters: {
 *         type: "object",
 *         properties: {
 *           location: { type: "string", description: "City name" },
 *         },
 *         required: ["location"],
 *       },
 *     },
 *   ],
 * });
 *
 * if (response.toolCalls) {
 *   // Handle tool calls
 * }
 * ```
 */
export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;

  /**
   * Create a new Anthropic provider instance.
   *
   * @param config - Provider configuration
   * @param config.apiKey - Anthropic API key
   * @param config.baseUrl - Optional custom base URL (for proxies)
   */
  constructor(config: ProviderConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
  }

  /**
   * Complete a chat conversation and return the full response.
   *
   * @param messages - Array of messages in the conversation
   * @param config - LLM configuration (model, temperature, etc.)
   * @returns Promise resolving to the LLM response with content and optional tool calls
   */
  async complete(
    messages: LLMMessage[],
    config: LLMConfig,
  ): Promise<LLMResponse> {
    // Extract system messages (handled separately in Anthropic)
    const systemMessages = messages.filter((m) => m.role === "system");
    const otherMessages = messages.filter((m) => m.role !== "system");

    // Build system prompt from all system messages
    const systemPrompt =
      systemMessages.length > 0
        ? systemMessages.map((m) => m.content).join("\n\n")
        : undefined;

    // Transform messages to Anthropic format
    const anthropicMessages = transformMessagesToAnthropic(otherMessages);

    // Transform tools if provided
    const tools = transformToolsToAnthropic(config.tools);

    const response = await this.client.messages.create({
      model: config.model,
      max_tokens: config.maxTokens || 1024,
      temperature: config.temperature,
      top_p: config.topP,
      system: systemPrompt,
      messages: anthropicMessages,
      tools,
      stream: false,
    });

    // Extract text content and tool calls from response
    const textContent = extractTextFromAnthropic(response.content);
    const toolCalls = extractToolCallsFromAnthropic(response.content);

    return {
      content: textContent,
      finishReason: response.stop_reason || undefined,
      toolCalls,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
    };
  }

  /**
   * Stream a chat conversation response.
   *
   * Note: Streaming with tool calls has limited support. The stream will
   * yield text content incrementally, but tool calls are only available
   * in the final message. For reliable tool calling, use `complete()`.
   *
   * @param messages - Array of messages in the conversation
   * @param config - LLM configuration (model, temperature, etc.)
   * @yields LLM stream chunks with content and optional finish reason
   */
  async *stream(
    messages: LLMMessage[],
    config: LLMConfig,
  ): AsyncIterableIterator<LLMStreamChunk> {
    // Extract system messages (handled separately in Anthropic)
    const systemMessages = messages.filter((m) => m.role === "system");
    const otherMessages = messages.filter((m) => m.role !== "system");

    // Build system prompt from all system messages
    const systemPrompt =
      systemMessages.length > 0
        ? systemMessages.map((m) => m.content).join("\n\n")
        : undefined;

    // Transform messages to Anthropic format
    const anthropicMessages = transformMessagesToAnthropic(otherMessages);

    // Note: Tool calling during streaming has limited support
    // Tools are not passed during streaming to avoid complications
    const stream = await this.client.messages.create({
      model: config.model,
      max_tokens: config.maxTokens || 1024,
      temperature: config.temperature,
      top_p: config.topP,
      system: systemPrompt,
      messages: anthropicMessages,
      stream: true,
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield {
          content: event.delta.text,
        };
      } else if (event.type === "message_delta") {
        yield {
          content: "",
          finishReason: event.delta.stop_reason || undefined,
        };
      }
    }
  }
}
