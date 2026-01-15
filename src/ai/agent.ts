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
  AgentMetrics,
  AgentHooks,
} from "./types";
import { isPreCallTool, isPostCallTool, toFunctionSchema } from "./tools";
import type { ZodType } from "zod";

// Streaming message store
const streamingMessages = new Map<string, any[]>();

function addStreamingMessage(sessionId: string, message: any) {
  const messageWithTimestamp = {
    ...message,
    timestamp: Date.now(),
  };

  if (!streamingMessages.has(sessionId)) {
    streamingMessages.set(sessionId, []);
  }
  streamingMessages.get(sessionId)!.push(messageWithTimestamp);

  // Broadcast to WebSocket clients
  try {
    // Dynamic import to avoid circular dependency
    import("../index")
      .then((module) => {
        if (module.broadcastToSession) {
          module.broadcastToSession(sessionId, messageWithTimestamp);
        }
      })
      .catch(() => {
        // WebSocket not available, messages still in store
      });
  } catch (error) {
    // Ignore errors, fallback to store only
  }
}

// Export for server access
export { streamingMessages };

type RunAgentParams<TResult> = {
  step: StepTools;
  name: string;
  provider: LLMProvider;
  prompt: Prompt;
  config: LLMConfig;
  tools?: Tool[];
  fn: (response: string) => TResult | Promise<TResult>;
  streaming?: StreamingConfig;
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
};

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
}: RunAgentParams<TResult>): Promise<TResult> {
  const sessionId = streaming?.sessionId;
  const broadcastInterval = streaming?.interval ?? 50;

  // Generate unique run ID for step names
  // This ensures each agent invocation has unique step names
  const runId = Math.random().toString(36).substring(2, 8);
  const stepPrefix = `${name}-${runId}`;

  // Track metrics for hooks
  const startTime = Date.now();
  let llmCallCount = 0;
  let toolCallCount = 0;
  const toolDurations: Record<string, number> = {};

  // Create context for hooks
  const createContext = (iteration: number): AgentContext => ({
    name,
    runId,
    iteration,
    metadata,
    sessionId,
  });

  // Call onStart hook
  if (hooks?.onStart) {
    await hooks.onStart(createContext(0));
  }
  // Step 1: Execute pre-call tools
  const additionalVariables = await step.run(
    `${stepPrefix}-pre-call-tools`,
    async () => {
      const preCallTools = tools.filter(isPreCallTool) as PreCallTool[];
      let variables: Record<string, string> = {};

      for (const tool of preCallTools) {
        const result = await tool.execute();
        variables = { ...variables, ...result };
      }

      return variables;
    },
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
    async () => {
      const postCallTools = tools.filter(isPostCallTool) as PostCallTool[];
      const functionDefinitions = postCallTools.map(toFunctionSchema);

      return {
        ...config,
        tools: functionDefinitions.length > 0 ? functionDefinitions : undefined,
      };
    },
  );

  // Step 4: LLM interaction loop with tool calling
  const postCallTools = tools.filter(isPostCallTool) as PostCallTool[];
  const MAX_ITERATIONS = 10;

  // Use any[] initially to work around Inngest serialization issues
  let currentMessages: any[] = hydratedMessages as any[];
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    // Call onLLMStart hook before LLM call
    if (hooks?.onLLMStart) {
      const messagesForHook = currentMessages.map((msg) => ({
        role: msg.role,
        content: msg.content,
        toolCalls: msg.toolCalls,
        toolCallId: msg.toolCallId,
      })) as LLMMessage[];
      await hooks.onLLMStart(createContext(iterations), messagesForHook);
    }

    // Step 4a: Call LLM with streaming
    const response = await step.run(
      `${stepPrefix}-llm-call-${iterations}`,
      async () => {
        llmCallCount++;
        // Convert back to proper types for LLM call
        const messagesForLLM = currentMessages.map((msg) => ({
          role: msg.role,
          content: msg.content,
          toolCalls: msg.toolCalls,
          toolCallId: msg.toolCallId,
        })) as LLMMessage[];

        // Use streaming if provider supports it and sessionId exists
        if (sessionId && provider.stream) {
          let fullContent = "";
          let lastBroadcast = Date.now();

          try {
            for await (const chunk of provider.stream(
              messagesForLLM,
              configWithTools,
            )) {
              if (chunk.content) {
                fullContent += chunk.content;

                // Call onChunk callback if provided
                if (streaming?.onChunk) {
                  await streaming.onChunk(chunk.content, fullContent);
                }

                // Broadcast at regular intervals
                const now = Date.now();
                if (now - lastBroadcast >= broadcastInterval) {
                  const messageData = {
                    type: "llm_response",
                    content: fullContent,
                    agentName: name,
                    iteration: iterations,
                    streaming: true,
                    ...(metadata && { metadata }),
                  };
                  addStreamingMessage(sessionId, { data: messageData });
                  lastBroadcast = now;
                }
              }

              // Check for finish
              if (chunk.finishReason) {
                // Call onComplete callback if provided
                if (streaming?.onComplete) {
                  await streaming.onComplete(fullContent);
                }

                // Send final complete message
                const finalData = {
                  type: "llm_response",
                  content: fullContent,
                  agentName: name,
                  iteration: iterations,
                  streaming: false,
                  hasToolCalls: false,
                  ...(metadata && { metadata }),
                };
                addStreamingMessage(sessionId, { data: finalData });

                return {
                  content: fullContent,
                  finishReason: chunk.finishReason,
                  toolCalls: undefined,
                };
              }
            }

            // If no finish reason was provided, still return the content
            // Call onComplete callback
            if (streaming?.onComplete) {
              await streaming.onComplete(fullContent);
            }

            return {
              content: fullContent,
              finishReason: "stop",
              toolCalls: undefined,
            };
          } catch (error) {
            console.error("Streaming error, falling back to complete:", error);
            // Fallback to non-streaming
            const llmResponse = await provider.complete(
              messagesForLLM,
              configWithTools,
            );

            const messageData = {
              type: "llm_response",
              content: llmResponse.content,
              agentName: name,
              iteration: iterations,
              hasToolCalls: Boolean(
                llmResponse.toolCalls && llmResponse.toolCalls.length > 0,
              ),
              ...(metadata && { metadata }),
            };
            addStreamingMessage(sessionId, { data: messageData });

            return llmResponse;
          }
        } else {
          // Non-streaming fallback
          const llmResponse = await provider.complete(
            messagesForLLM,
            configWithTools,
          );

          // Publish streaming response
          const messageData = {
            type: "llm_response",
            content: llmResponse.content,
            agentName: name,
            iteration: iterations,
            hasToolCalls: Boolean(
              llmResponse.toolCalls && llmResponse.toolCalls.length > 0,
            ),
            ...(metadata && { metadata }),
          };

          // Always store in memory and broadcast via WebSocket
          if (sessionId) {
            addStreamingMessage(sessionId, { data: messageData });
          }

          return llmResponse;
        }
      },
    );

    // Call onLLMEnd hook after LLM call
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
      const finalMessageData = {
        type: "final_response",
        content: response.content,
        agentName: name,
        iteration: iterations,
        completed: true,
        ...(metadata && { metadata }),
      };

      // Always store and broadcast
      if (sessionId) {
        await step.run(`${stepPrefix}-publish-final-response`, async () => {
          addStreamingMessage(sessionId, { data: finalMessageData });
        });
      }

      // Step 5: Process final response
      const result = await step.run(
        `${stepPrefix}-process-response`,
        async () => {
          const rawResult = await fn(response.content);

          // Validate result against schema if provided
          if (resultSchema) {
            const parseResult = resultSchema.safeParse(rawResult);
            if (!parseResult.success) {
              const errorDetails = parseResult.error.issues
                .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
                .join("\n");
              throw new Error(
                `Agent "${name}" result validation failed:\n${errorDetails}\n\nReceived: ${JSON.stringify(rawResult, null, 2).substring(0, 500)}`,
              );
            }
            return parseResult.data;
          }

          return rawResult;
        },
      );

      // Call onComplete hook
      if (hooks?.onComplete) {
        const metrics: AgentMetrics = {
          totalDurationMs: Date.now() - startTime,
          llmCalls: llmCallCount,
          toolCalls: toolCallCount,
          toolDurations,
        };
        await hooks.onComplete(
          createContext(iterations),
          result as TResult,
          metrics,
        );
      }

      return result as TResult;
    }

    // Step 4b: Add assistant message with tool calls
    currentMessages = await step.run(
      `${stepPrefix}-add-assistant-message-${iterations}`,
      async () => {
        const assistantMessage = {
          role: "assistant",
          content: response.content || "",
          toolCalls: response.toolCalls,
        };
        return [...currentMessages, assistantMessage];
      },
    );

    // Step 4c: Execute tool calls and add tool messages
    if (response.toolCalls && response.toolCalls.length > 0) {
      for (let i = 0; i < response.toolCalls.length; i++) {
        const toolCall = response.toolCalls[i] as unknown as {
          id: string;
          function: { name: string; arguments: string };
        };
        const toolName = toolCall.function.name;
        const toolArgs = JSON.parse(toolCall.function.arguments);

        // Call onToolStart hook before tool execution
        if (hooks?.onToolStart) {
          await hooks.onToolStart(
            createContext(iterations),
            toolName,
            toolArgs,
          );
        }

        const toolStartTime = Date.now();

        const toolMessage = await step.run(
          `${stepPrefix}-tool-${toolName}-${iterations}-${i}`,
          async () => {
            const tool = postCallTools.find((t) => t.name === toolName);

            if (!tool) {
              return {
                role: "tool",
                content: JSON.stringify({
                  error: `Tool ${toolName} not found`,
                }),
                toolCallId: toolCall.id,
                _error: true,
                _errorMessage: `Tool ${toolName} not found`,
              };
            }

            try {
              // Broadcast tool start message
              if (sessionId) {
                const toolStartData = {
                  type: "tool_start",
                  toolName: toolName,
                  agentName: name,
                  iteration: iterations,
                  args: toolArgs,
                };
                addStreamingMessage(sessionId, { data: toolStartData });
              }

              // Create context for progress reporting
              const context = sessionId
                ? {
                    reportProgress: (message: string) => {
                      const toolProgressData = {
                        type: "tool_progress",
                        toolName: toolName,
                        agentName: name,
                        iteration: iterations,
                        message: message,
                      };
                      addStreamingMessage(sessionId, {
                        data: toolProgressData,
                      });
                    },
                    agentName: name,
                    iteration: iterations,
                  }
                : undefined;

              const result = await tool.execute(toolArgs, context);

              // Publish tool execution result
              const toolResultData = {
                type: "tool_result",
                toolName: toolName,
                agentName: name,
                iteration: iterations,
                result: result,
                success: true,
              };

              // Always store and broadcast
              if (sessionId) {
                addStreamingMessage(sessionId, { data: toolResultData });
              }

              return {
                role: "tool",
                content: JSON.stringify(result),
                toolCallId: toolCall.id,
                _result: result,
              };
            } catch (error) {
              // Publish tool error
              const toolErrorData = {
                type: "tool_error",
                toolName: toolName,
                agentName: name,
                iteration: iterations,
                error: (error as Error).message,
                success: false,
              };

              // Always store and broadcast
              if (sessionId) {
                addStreamingMessage(sessionId, { data: toolErrorData });
              }

              return {
                role: "tool",
                content: JSON.stringify({ error: (error as Error).message }),
                toolCallId: toolCall.id,
                _error: true,
                _errorMessage: (error as Error).message,
              };
            }
          },
        );

        const toolDuration = Date.now() - toolStartTime;
        toolCallCount++;
        toolDurations[toolName] = (toolDurations[toolName] || 0) + toolDuration;

        // Call onToolEnd or onToolError hook after tool execution
        if ((toolMessage as any)._error) {
          if (hooks?.onToolError) {
            await hooks.onToolError(
              createContext(iterations),
              toolName,
              new Error((toolMessage as any)._errorMessage),
            );
          }
        } else {
          if (hooks?.onToolEnd) {
            await hooks.onToolEnd(
              createContext(iterations),
              toolName,
              (toolMessage as any)._result,
              toolDuration,
            );
          }
        }

        // Add tool message to current messages
        currentMessages = await step.run(
          `${stepPrefix}-add-tool-message-${iterations}-${i}`,
          async () => {
            return [...currentMessages, toolMessage];
          },
        );
      }
    }
  }

  // Max iterations reached - call onError hook
  const maxIterationsError = new Error(
    `Max iterations (${MAX_ITERATIONS}) reached in tool calling loop`,
  );
  if (hooks?.onError) {
    await hooks.onError(createContext(iterations), maxIterationsError);
  }
  throw maxIterationsError;
}
