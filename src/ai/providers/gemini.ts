import {
  GoogleGenerativeAI,
  FunctionCallingMode,
  SchemaType,
  type Content,
  type Part,
  type FunctionDeclaration,
  type FunctionCall,
  type FunctionResponse,
  type Tool,
} from "@google/generative-ai";
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
 * Map of Gemini finish reasons to normalized values.
 * Gemini uses different finish reason strings than OpenAI.
 */
const FINISH_REASON_MAP: Record<string, string> = {
  STOP: "stop",
  MAX_TOKENS: "length",
  SAFETY: "content_filter",
  RECITATION: "content_filter",
  OTHER: "stop",
  FINISH_REASON_UNSPECIFIED: "stop",
};

/**
 * Normalize Gemini finish reason to a standard format.
 *
 * @param reason - Gemini finish reason
 * @returns Normalized finish reason
 */
function normalizeFinishReason(reason?: string): string | undefined {
  if (!reason) return undefined;
  return FINISH_REASON_MAP[reason] || reason.toLowerCase();
}

/**
 * Transform our internal tool definitions to Gemini's function declaration format.
 *
 * @param tools - Array of function definitions in our internal format
 * @returns Array of Gemini tools, or undefined if no tools
 */
function transformToolsToGemini(
  tools?: FunctionDefinition[],
): Tool[] | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  const functionDeclarations: FunctionDeclaration[] = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: {
      type: SchemaType.OBJECT,
      properties: tool.parameters.properties,
      required: tool.parameters.required,
    },
  }));

  return [{ functionDeclarations }];
}

/**
 * Transform our internal messages to Gemini's Content format.
 *
 * Gemini has specific requirements:
 * - System messages are passed separately via systemInstruction
 * - Roles are "user" and "model" (not "assistant")
 * - Function calls and responses are Parts within Content
 * - The last message is sent separately (not in history)
 *
 * @param messages - Array of messages excluding system messages
 * @returns Object with history (all but last) and lastMessage
 */
function transformMessagesToGemini(messages: LLMMessage[]): {
  history: Content[];
  lastMessage: LLMMessage | null;
} {
  if (messages.length === 0) {
    return { history: [], lastMessage: null };
  }

  const history: Content[] = [];

  // Process all messages except the last one for history
  for (let i = 0; i < messages.length - 1; i++) {
    const msg = messages[i];
    const content = transformMessageToContent(msg);
    if (content) {
      history.push(content);
    }
  }

  return {
    history,
    lastMessage: messages[messages.length - 1],
  };
}

/**
 * Transform a single message to Gemini Content format.
 *
 * @param msg - Message to transform
 * @returns Gemini Content object or null if message should be skipped
 */
function transformMessageToContent(msg: LLMMessage): Content | null {
  const parts: Part[] = [];

  if (msg.role === "user") {
    // User message with text
    if (msg.content) {
      parts.push({ text: msg.content });
    }
    return parts.length > 0 ? { role: "user", parts } : null;
  }

  if (msg.role === "assistant") {
    // Model message may contain text and/or function calls
    if (msg.content) {
      parts.push({ text: msg.content });
    }

    // Add function calls if present
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      for (const toolCall of msg.toolCalls) {
        const functionCall: FunctionCall = {
          name: toolCall.function.name,
          args: JSON.parse(toolCall.function.arguments),
        };
        parts.push({ functionCall });
      }
    }

    return parts.length > 0 ? { role: "model", parts } : null;
  }

  if (msg.role === "tool") {
    // Function response - this comes after the model's function call
    // In Gemini, function responses are user messages
    const functionResponse: FunctionResponse = {
      name: msg.toolCallId || "unknown",
      response: safeJsonParse(msg.content),
    };
    parts.push({ functionResponse });
    return { role: "user", parts };
  }

  return null;
}

/**
 * Safely parse JSON, returning the original string wrapped in an object if parsing fails.
 */
function safeJsonParse(content: string): object {
  try {
    const parsed = JSON.parse(content);
    return typeof parsed === "object" ? parsed : { result: parsed };
  } catch {
    return { result: content };
  }
}

/**
 * Build parts array for sending a message, handling text and function responses.
 *
 * @param msg - The message to convert to parts
 * @returns Array of Parts to send
 */
function buildMessageParts(msg: LLMMessage): Part[] {
  const parts: Part[] = [];

  if (msg.role === "tool") {
    // Function response
    const functionResponse: FunctionResponse = {
      name: msg.toolCallId || "unknown",
      response: safeJsonParse(msg.content),
    };
    parts.push({ functionResponse });
  } else if (msg.content) {
    parts.push({ text: msg.content });
  }

  return parts;
}

/**
 * Extract tool calls from Gemini response candidates.
 *
 * @param candidates - Response candidates from Gemini
 * @returns Array of tool calls in our internal format, or undefined if none
 */
function extractToolCallsFromGemini(
  candidates?: Array<{ content?: { parts?: Part[] } }>,
): ToolCallResponse[] | undefined {
  if (!candidates || candidates.length === 0) {
    return undefined;
  }

  const parts = candidates[0]?.content?.parts;
  if (!parts) {
    return undefined;
  }

  const functionCalls = parts.filter(
    (part): part is Part & { functionCall: FunctionCall } =>
      "functionCall" in part && part.functionCall !== undefined,
  );

  if (functionCalls.length === 0) {
    return undefined;
  }

  return functionCalls.map((part, index) => ({
    id: `call_${index}_${part.functionCall.name}`,
    type: "function" as const,
    function: {
      name: part.functionCall.name,
      arguments: JSON.stringify(part.functionCall.args),
    },
  }));
}

/**
 * Extract text content from Gemini response candidates.
 *
 * @param candidates - Response candidates from Gemini
 * @returns Combined text content
 */
function extractTextFromGemini(
  candidates?: Array<{ content?: { parts?: Part[] } }>,
): string {
  if (!candidates || candidates.length === 0) {
    return "";
  }

  const parts = candidates[0]?.content?.parts;
  if (!parts) {
    return "";
  }

  return parts
    .filter((part): part is Part & { text: string } => "text" in part)
    .map((part) => part.text)
    .join("");
}

/**
 * Google Gemini LLM provider.
 *
 * Supports Gemini Pro, Gemini Pro Vision, and other Gemini models with both
 * completion and streaming interfaces. Includes function calling support
 * using Gemini's native format.
 *
 * ## Key Differences from OpenAI
 *
 * 1. **Role naming**: Uses "model" instead of "assistant" for AI responses.
 *
 * 2. **System messages**: Passed via `systemInstruction` parameter,
 *    not in the messages array.
 *
 * 3. **Function calling**: Uses `FunctionCall` and `FunctionResponse` Parts
 *    within Content objects, not separate message roles.
 *
 * 4. **Chat interface**: Uses a chat session model where history is provided
 *    upfront and messages are sent one at a time.
 *
 * 5. **Finish reasons**: Uses different values (STOP, MAX_TOKENS, SAFETY)
 *    which are normalized to standard format (stop, length, content_filter).
 *
 * ## Limitations
 *
 * - Tool call IDs are generated (Gemini doesn't provide them like OpenAI)
 * - Function responses use the function name as identifier
 *
 * @example
 * ```typescript
 * const provider = new GeminiProvider({
 *   type: "gemini",
 *   apiKey: process.env.GOOGLE_API_KEY,
 * });
 *
 * const response = await provider.complete(messages, {
 *   model: "gemini-pro",
 *   temperature: 0.7,
 *   maxTokens: 1000,
 * });
 * ```
 *
 * @example
 * ```typescript
 * // With function calling
 * const response = await provider.complete(messages, {
 *   model: "gemini-pro",
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
 *   // Handle function calls
 * }
 * ```
 */
export class GeminiProvider implements LLMProvider {
  private client: GoogleGenerativeAI;

  /**
   * Create a new Gemini provider instance.
   *
   * @param config - Provider configuration
   * @param config.apiKey - Google AI API key
   */
  constructor(config: ProviderConfig) {
    this.client = new GoogleGenerativeAI(config.apiKey);
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
    // Extract system messages (handled separately)
    const systemMessages = messages.filter((m) => m.role === "system");
    const conversationMessages = messages.filter((m) => m.role !== "system");

    // Validate we have at least one message
    if (conversationMessages.length === 0) {
      throw new Error(
        "At least one non-system message is required for Gemini provider",
      );
    }

    // Build system instruction from all system messages
    const systemInstruction =
      systemMessages.length > 0
        ? systemMessages.map((m) => m.content).join("\n\n")
        : undefined;

    // Transform tools if provided
    const tools = transformToolsToGemini(config.tools);

    // Get the model with tools configured
    const model = this.client.getGenerativeModel({
      model: config.model,
      tools,
      toolConfig: tools
        ? { functionCallingConfig: { mode: FunctionCallingMode.AUTO } }
        : undefined,
      systemInstruction,
    });

    // Transform messages to Gemini format
    const { history, lastMessage } =
      transformMessagesToGemini(conversationMessages);

    // Start chat with history
    const chat = model.startChat({
      history,
      generationConfig: {
        temperature: config.temperature,
        maxOutputTokens: config.maxTokens,
        topP: config.topP,
      },
    });

    // Send the last message
    const messageParts = buildMessageParts(lastMessage!);
    const result = await chat.sendMessage(messageParts);
    const response = result.response;

    // Extract content and tool calls
    const textContent = extractTextFromGemini(response.candidates);
    const toolCalls = extractToolCallsFromGemini(response.candidates);

    return {
      content: textContent,
      finishReason: normalizeFinishReason(
        response.candidates?.[0]?.finishReason,
      ),
      toolCalls,
      usage: response.usageMetadata
        ? {
            promptTokens: response.usageMetadata.promptTokenCount || 0,
            completionTokens: response.usageMetadata.candidatesTokenCount || 0,
            totalTokens: response.usageMetadata.totalTokenCount || 0,
          }
        : undefined,
    };
  }

  /**
   * Stream a chat conversation response.
   *
   * Note: Streaming with function calls has limited support. The stream will
   * yield text content incrementally, but function calls may not be properly
   * captured. For reliable function calling, use `complete()`.
   *
   * @param messages - Array of messages in the conversation
   * @param config - LLM configuration (model, temperature, etc.)
   * @yields LLM stream chunks with content and optional finish reason
   */
  async *stream(
    messages: LLMMessage[],
    config: LLMConfig,
  ): AsyncIterableIterator<LLMStreamChunk> {
    // Extract system messages (handled separately)
    const systemMessages = messages.filter((m) => m.role === "system");
    const conversationMessages = messages.filter((m) => m.role !== "system");

    // Validate we have at least one message
    if (conversationMessages.length === 0) {
      throw new Error(
        "At least one non-system message is required for Gemini provider",
      );
    }

    // Build system instruction from all system messages
    const systemInstruction =
      systemMessages.length > 0
        ? systemMessages.map((m) => m.content).join("\n\n")
        : undefined;

    // Get the model (no tools for streaming to avoid complications)
    const model = this.client.getGenerativeModel({
      model: config.model,
      systemInstruction,
    });

    // Transform messages to Gemini format
    const { history, lastMessage } =
      transformMessagesToGemini(conversationMessages);

    // Start chat with history
    const chat = model.startChat({
      history,
      generationConfig: {
        temperature: config.temperature,
        maxOutputTokens: config.maxTokens,
        topP: config.topP,
      },
    });

    // Send the last message with streaming
    const messageParts = buildMessageParts(lastMessage!);
    const result = await chat.sendMessageStream(messageParts);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        yield {
          content: text,
          finishReason: normalizeFinishReason(
            chunk.candidates?.[0]?.finishReason,
          ),
        };
      } else if (chunk.candidates?.[0]?.finishReason) {
        // Emit finish reason even without text
        yield {
          content: "",
          finishReason: normalizeFinishReason(chunk.candidates[0].finishReason),
        };
      }
    }
  }
}
