import type {
  Prompt,
  LLMProvider,
  LLMConfig,
  LLMMessage,
  Tool,
  PreCallTool,
  PostCallTool,
  StepTools,
  StreamingConfig,
  AgentMetadata,
  AgentContext,
  AgentHooks,
  ToolCallResponse,
} from "./types";
import { isPreCallTool, isPostCallTool, toFunctionSchema } from "./tools";
import {
  globalStreamingManager,
  createLLMResponseMessage,
  createFinalResponseMessage,
  createToolStartMessage,
  createToolProgressMessage,
  createToolResultMessage,
  createToolErrorMessage,
} from "./streaming";
import { AgentMetricsCollector } from "./metrics";
import type { ZodType } from "zod";

// Re-export the underlying Map for backward compatibility with code that uses .get(), .set(), .has()
// This is a workaround - new code should use globalStreamingManager methods instead
const streamingMessagesMap = new Map<string, StreamMessage[]>();

// Sync the map with the StreamingManager by setting up a broadcaster
globalStreamingManager.setBroadcaster((sessionId, message) => {
  if (!streamingMessagesMap.has(sessionId)) {
    streamingMessagesMap.set(sessionId, []);
  }
  streamingMessagesMap.get(sessionId)!.push(message);

  // Also try to broadcast via WebSocket
  try {
    import("../index")
      .then((module) => {
        if (module.broadcastToSession) {
          module.broadcastToSession(sessionId, message);
        }
      })
      .catch(() => {
        // WebSocket not available
      });
  } catch {
    // Ignore errors
  }
});

export { streamingMessagesMap as streamingMessages };

// Import StreamMessage type for the map
import type { StreamMessage } from "./streaming";

/**
 * Default maximum number of tool-calling iterations.
 */
const DEFAULT_MAX_ITERATIONS = 10;

/**
 * Parameters for running an agent.
 */
export type RunAgentParams<TResult> = {
  /** Inngest step tools for durable execution */
  step: StepTools;
  /** Unique name for the agent */
  name: string;
  /** LLM provider to use */
  provider: LLMProvider;
  /** Prompt configuration with messages and variables */
  prompt: Prompt;
  /** LLM configuration (model, temperature, etc.) */
  config: LLMConfig;
  /** Optional tools the agent can use */
  tools?: Tool[];
  /** Function to process the LLM response into the result type */
  fn: (response: string) => TResult | Promise<TResult>;
  /** Optional streaming configuration */
  streaming?: StreamingConfig;
  /** Optional metadata to include in streaming messages */
  metadata?: AgentMetadata;
  /**
   * Optional Zod schema for validating and typing the result.
   * When provided, the result from `fn` will be validated against this schema.
   * If validation fails, an error will be thrown with details about what failed.
   */
  resultSchema?: ZodType<TResult>;
  /**
   * Lifecycle hooks for monitoring, logging, and custom behavior.
   */
  hooks?: AgentHooks<TResult>;
  /**
   * Maximum number of tool-calling iterations before throwing an error.
   * @default 10
   */
  maxIterations?: number;
  /**
   * Optional run ID for deterministic step naming.
   * If not provided, a random ID will be generated.
   */
  runId?: string;
};

/**
 * Internal message type that includes tool execution metadata.
 * Used to pass error/result information between steps.
 */
type InternalToolMessage = {
  role: "tool";
  content: string;
  toolCallId: string;
  _error?: boolean;
  _errorMessage?: string;
  _result?: unknown;
};

/**
 * Serialized message type for Inngest step storage.
 * Inngest serializes data through JSON, which loses some type information.
 * We use `any` here to work around JsonifyObject type transformation issues.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SerializedMessages = any[];

/**
 * Convert serialized messages back to LLMMessage format for API calls.
 */
function toAPIMessages(messages: SerializedMessages): LLMMessage[] {
  return messages.map((msg) => ({
    role: msg.role as LLMMessage["role"],
    content: msg.content as string,
    toolCalls: msg.toolCalls as ToolCallResponse[] | undefined,
    toolCallId: msg.toolCallId as string | undefined,
  }));
}

/**
 * Generate a unique run ID.
 * Uses crypto.randomUUID for better uniqueness than Math.random.
 */
function generateRunId(): string {
  // Use crypto.randomUUID if available, fallback to timestamp-based ID
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID().substring(0, 8);
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
}

/**
 * Create an AgentContext object for hooks.
 */
function createAgentContext(
  name: string,
  runId: string,
  iteration: number,
  metadata?: AgentMetadata,
  sessionId?: string,
): AgentContext {
  return {
    name,
    runId,
    iteration,
    metadata,
    sessionId,
  };
}

/**
 * Execute pre-call tools and collect their variables.
 */
async function executePreCallTools(
  tools: Tool[],
): Promise<Record<string, string>> {
  const preCallTools = tools.filter(isPreCallTool) as PreCallTool[];
  let variables: Record<string, string> = {};

  for (const tool of preCallTools) {
    const result = await tool.execute();
    variables = { ...variables, ...result };
  }

  return variables;
}

/**
 * Prepare LLM configuration with tool definitions.
 */
function prepareConfigWithTools(config: LLMConfig, tools: Tool[]): LLMConfig {
  const postCallTools = tools.filter(isPostCallTool) as PostCallTool[];
  const functionDefinitions = postCallTools.map(toFunctionSchema);

  return {
    ...config,
    tools: functionDefinitions.length > 0 ? functionDefinitions : undefined,
  };
}

/**
 * Handle streaming LLM call with proper message broadcasting.
 */
async function handleStreamingLLMCall(
  provider: LLMProvider,
  messages: LLMMessage[],
  config: LLMConfig,
  streamingConfig: StreamingConfig,
  agentName: string,
  iteration: number,
  metadata?: AgentMetadata,
): Promise<{
  content: string;
  finishReason?: string;
  toolCalls?: ToolCallResponse[];
}> {
  const sessionId = streamingConfig.sessionId;
  const broadcastInterval = streamingConfig.interval ?? 50;

  if (!provider.stream) {
    throw new Error("Provider does not support streaming");
  }

  let fullContent = "";
  let lastBroadcast = Date.now();

  try {
    for await (const chunk of provider.stream(messages, config)) {
      if (chunk.content) {
        fullContent += chunk.content;

        // Call onChunk callback if provided
        if (streamingConfig.onChunk) {
          await streamingConfig.onChunk(chunk.content, fullContent);
        }

        // Broadcast at regular intervals
        const now = Date.now();
        if (now - lastBroadcast >= broadcastInterval) {
          globalStreamingManager.addMessage(
            sessionId,
            createLLMResponseMessage(agentName, fullContent, iteration, {
              streaming: true,
              metadata,
            }),
          );
          lastBroadcast = now;
        }
      }

      // Check for finish
      if (chunk.finishReason) {
        // Call onComplete callback if provided
        if (streamingConfig.onComplete) {
          await streamingConfig.onComplete(fullContent);
        }

        // Send final complete message
        globalStreamingManager.addMessage(
          sessionId,
          createLLMResponseMessage(agentName, fullContent, iteration, {
            streaming: false,
            hasToolCalls: false,
            metadata,
          }),
        );

        return {
          content: fullContent,
          finishReason: chunk.finishReason,
          toolCalls: undefined,
        };
      }
    }

    // If no finish reason was provided, still return the content
    if (streamingConfig.onComplete) {
      await streamingConfig.onComplete(fullContent);
    }

    return {
      content: fullContent,
      finishReason: "stop",
      toolCalls: undefined,
    };
  } catch (error) {
    // Fallback to non-streaming on error
    console.error("Streaming error, falling back to complete:", error);
    const llmResponse = await provider.complete(messages, config);

    globalStreamingManager.addMessage(
      sessionId,
      createLLMResponseMessage(agentName, llmResponse.content, iteration, {
        streaming: false,
        hasToolCalls: Boolean(
          llmResponse.toolCalls && llmResponse.toolCalls.length > 0,
        ),
        metadata,
      }),
    );

    return llmResponse;
  }
}

/**
 * Handle non-streaming LLM call.
 */
async function handleNonStreamingLLMCall(
  provider: LLMProvider,
  messages: LLMMessage[],
  config: LLMConfig,
  agentName: string,
  iteration: number,
  sessionId?: string,
  metadata?: AgentMetadata,
): Promise<{
  content: string;
  finishReason?: string;
  toolCalls?: ToolCallResponse[];
}> {
  const llmResponse = await provider.complete(messages, config);

  // Broadcast if we have a session
  if (sessionId) {
    globalStreamingManager.addMessage(
      sessionId,
      createLLMResponseMessage(agentName, llmResponse.content, iteration, {
        streaming: false,
        hasToolCalls: Boolean(
          llmResponse.toolCalls && llmResponse.toolCalls.length > 0,
        ),
        metadata,
      }),
    );
  }

  return llmResponse;
}

/**
 * Execute a single tool call and return the result message.
 */
async function executeToolCall(
  tool: PostCallTool,
  toolCall: { id: string; function: { name: string; arguments: string } },
  agentName: string,
  iteration: number,
  sessionId?: string,
): Promise<InternalToolMessage> {
  const toolName = toolCall.function.name;
  const toolArgs = JSON.parse(toolCall.function.arguments);

  try {
    // Broadcast tool start
    if (sessionId) {
      globalStreamingManager.addMessage(
        sessionId,
        createToolStartMessage(toolName, agentName, iteration, toolArgs),
      );
    }

    // Create context for progress reporting
    const context = sessionId
      ? {
          reportProgress: (message: string) => {
            globalStreamingManager.addMessage(
              sessionId,
              createToolProgressMessage(
                toolName,
                agentName,
                iteration,
                message,
              ),
            );
          },
          agentName,
          iteration,
        }
      : undefined;

    const result = await tool.execute(toolArgs, context);

    // Broadcast tool result
    if (sessionId) {
      globalStreamingManager.addMessage(
        sessionId,
        createToolResultMessage(toolName, agentName, iteration, result),
      );
    }

    return {
      role: "tool",
      content: JSON.stringify(result),
      toolCallId: toolCall.id,
      _result: result,
    };
  } catch (error) {
    const errorMessage = (error as Error).message;

    // Broadcast tool error
    if (sessionId) {
      globalStreamingManager.addMessage(
        sessionId,
        createToolErrorMessage(toolName, agentName, iteration, errorMessage),
      );
    }

    return {
      role: "tool",
      content: JSON.stringify({ error: errorMessage }),
      toolCallId: toolCall.id,
      _error: true,
      _errorMessage: errorMessage,
    };
  }
}

/**
 * Validate and process the final result.
 */
async function processResult<TResult>(
  content: string,
  fn: (response: string) => TResult | Promise<TResult>,
  resultSchema?: ZodType<TResult>,
  agentName?: string,
): Promise<TResult> {
  const rawResult = await fn(content);

  if (resultSchema) {
    const parseResult = resultSchema.safeParse(rawResult);
    if (!parseResult.success) {
      const errorDetails = parseResult.error.issues
        .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
        .join("\n");
      throw new Error(
        `Agent "${agentName}" result validation failed:\n${errorDetails}\n\nReceived: ${JSON.stringify(rawResult, null, 2).substring(0, 500)}`,
      );
    }
    return parseResult.data;
  }

  return rawResult;
}

/**
 * Run an AI agent with tool calling support.
 *
 * This function orchestrates the complete agent execution lifecycle:
 * 1. Execute pre-call tools to gather context
 * 2. Hydrate the prompt with variables
 * 3. Call the LLM (with optional streaming)
 * 4. Execute any tool calls the LLM requests
 * 5. Loop until the LLM produces a final response
 * 6. Process and validate the result
 *
 * @param params - Agent execution parameters
 * @returns Promise resolving to the processed result
 *
 * @example
 * ```typescript
 * const result = await runAgent({
 *   step,
 *   name: "analyzer",
 *   provider: openaiProvider,
 *   prompt: analysisPrompt,
 *   config: { model: "gpt-4", temperature: 0.7 },
 *   tools: [searchTool, fetchTool],
 *   fn: (response) => JSON.parse(response),
 *   resultSchema: AnalysisResultSchema,
 *   maxIterations: 5,
 *   hooks: {
 *     onStart: (ctx) => console.log(`Starting ${ctx.name}`),
 *     onComplete: (ctx, result, metrics) => {
 *       console.log(`Completed in ${metrics.totalDurationMs}ms`);
 *     },
 *   },
 * });
 * ```
 */
export async function runAgent<TResult>({
  step,
  name,
  provider,
  prompt,
  config,
  tools = [],
  fn,
  streaming,
  metadata,
  resultSchema,
  hooks,
  maxIterations = DEFAULT_MAX_ITERATIONS,
  runId: providedRunId,
}: RunAgentParams<TResult>): Promise<TResult> {
  const sessionId = streaming?.sessionId;
  const runId = providedRunId ?? generateRunId();
  const stepPrefix = `${name}-${runId}`;

  // Initialize metrics collector
  const metricsCollector = new AgentMetricsCollector();

  // Helper to create context
  const createContext = (iteration: number) =>
    createAgentContext(name, runId, iteration, metadata, sessionId);

  // Call onStart hook
  if (hooks?.onStart) {
    await hooks.onStart(createContext(0));
  }

  // Step 1: Execute pre-call tools
  const additionalVariables = await step.run(
    `${stepPrefix}-pre-call-tools`,
    async () => executePreCallTools(tools),
  );

  // Step 2: Hydrate prompt
  const hydratedMessages = await step.run(
    `${stepPrefix}-hydrate-prompt`,
    async () => {
      const { hydratePrompt } = await import("./prompt");

      const hydratedPrompt = {
        ...prompt,
        variables: { ...prompt.variables, ...additionalVariables },
      };

      return hydratePrompt(hydratedPrompt);
    },
  );

  // Step 3: Prepare tool definitions
  const configWithTools = await step.run(
    `${stepPrefix}-prepare-tools`,
    async () => prepareConfigWithTools(config, tools),
  );

  // Step 4: LLM interaction loop with tool calling
  const postCallTools = tools.filter(isPostCallTool) as PostCallTool[];
  // Use SerializedMessages to work around Inngest's JsonifyObject type issues
  let currentMessages: SerializedMessages =
    hydratedMessages as SerializedMessages;
  let iterations = 0;

  while (iterations < maxIterations) {
    iterations++;

    // Call onLLMStart hook
    if (hooks?.onLLMStart) {
      await hooks.onLLMStart(
        createContext(iterations),
        toAPIMessages(currentMessages),
      );
    }

    // Step 4a: Call LLM
    const response = await step.run(
      `${stepPrefix}-llm-call-${iterations}`,
      async () => {
        metricsCollector.recordLLMCall();

        const messagesForLLM = toAPIMessages(currentMessages);

        // Use streaming if available and configured
        if (sessionId && streaming && typeof provider.stream === "function") {
          return handleStreamingLLMCall(
            provider,
            messagesForLLM,
            configWithTools,
            streaming,
            name,
            iterations,
            metadata,
          );
        } else {
          return handleNonStreamingLLMCall(
            provider,
            messagesForLLM,
            configWithTools,
            name,
            iterations,
            sessionId,
            metadata,
          );
        }
      },
    );

    // Call onLLMEnd hook
    if (hooks?.onLLMEnd) {
      await hooks.onLLMEnd(createContext(iterations), {
        content: response.content || "",
        hasToolCalls: Boolean(
          response.toolCalls && response.toolCalls.length > 0,
        ),
      });
    }

    // Check if we're done (no tool calls)
    if (!response.toolCalls || response.toolCalls.length === 0) {
      // Publish final response
      if (sessionId) {
        await step.run(`${stepPrefix}-publish-final-response`, async () => {
          globalStreamingManager.addMessage(
            sessionId,
            createFinalResponseMessage(
              name,
              response.content,
              iterations,
              metadata,
            ),
          );
        });
      }

      // Step 5: Process final response
      const result = await step.run(
        `${stepPrefix}-process-response`,
        async () => processResult(response.content, fn, resultSchema, name),
      );

      // Call onComplete hook
      if (hooks?.onComplete) {
        await hooks.onComplete(
          createContext(iterations),
          result as TResult,
          metricsCollector.getMetrics(),
        );
      }

      return result as TResult;
    }

    // Step 4b: Add assistant message with tool calls
    // Cast to any to work around Inngest's JsonifyObject type issues
    const toolCallsForMessage =
      response.toolCalls as unknown as ToolCallResponse[];
    currentMessages = await step.run(
      `${stepPrefix}-add-assistant-message-${iterations}`,
      async () => {
        const assistantMessage = {
          role: "assistant" as const,
          content: response.content || "",
          toolCalls: toolCallsForMessage,
        };
        return [...currentMessages, assistantMessage];
      },
    );

    // Step 4c: Execute tool calls and add tool messages
    for (let i = 0; i < toolCallsForMessage.length; i++) {
      const toolCall = toolCallsForMessage[i];
      const toolName = toolCall.function.name;
      const toolArgs = JSON.parse(toolCall.function.arguments);

      // Call onToolStart hook
      if (hooks?.onToolStart) {
        await hooks.onToolStart(createContext(iterations), toolName, toolArgs);
      }

      const toolStartTime = Date.now();

      const toolMessage = await step.run(
        `${stepPrefix}-tool-${toolName}-${iterations}-${i}`,
        async () => {
          const tool = postCallTools.find((t) => t.name === toolName);

          if (!tool) {
            return {
              role: "tool" as const,
              content: JSON.stringify({ error: `Tool ${toolName} not found` }),
              toolCallId: toolCall.id,
              _error: true,
              _errorMessage: `Tool ${toolName} not found`,
            };
          }

          return executeToolCall(tool, toolCall, name, iterations, sessionId);
        },
      );

      const toolDuration = Date.now() - toolStartTime;
      metricsCollector.recordToolCall(toolName, toolDuration);

      // Call onToolEnd or onToolError hook
      const internalMessage = toolMessage as InternalToolMessage;
      if (internalMessage._error) {
        if (hooks?.onToolError) {
          await hooks.onToolError(
            createContext(iterations),
            toolName,
            new Error(internalMessage._errorMessage || "Unknown error"),
          );
        }
      } else {
        if (hooks?.onToolEnd) {
          await hooks.onToolEnd(
            createContext(iterations),
            toolName,
            internalMessage._result,
            toolDuration,
          );
        }
      }

      // Add tool message to current messages
      currentMessages = await step.run(
        `${stepPrefix}-add-tool-message-${iterations}-${i}`,
        async () => {
          // Strip internal properties when adding to messages
          const cleanMessage: LLMMessage = {
            role: toolMessage.role,
            content: toolMessage.content,
            toolCallId: toolMessage.toolCallId,
          };
          return [...currentMessages, cleanMessage];
        },
      );
    }
  }

  // Max iterations reached
  const maxIterationsError = new Error(
    `Max iterations (${maxIterations}) reached in tool calling loop`,
  );
  if (hooks?.onError) {
    await hooks.onError(createContext(iterations), maxIterationsError);
  }
  throw maxIterationsError;
}
