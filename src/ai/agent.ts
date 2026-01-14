import type { Prompt } from "./prompt";
import type {
  LLMProvider,
  LLMConfig,
  LLMMessage,
  ToolCall,
  LLMResponse,
} from "./providers/index";
import type { Tool, PreCallTool, PostCallTool } from "./tools";
import { isPreCallTool, isPostCallTool, toFunctionSchema } from "./tools";
import type { GetStepTools } from "inngest";

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

export type StepTools = GetStepTools<any>;

type RunAgentParams<TResult> = {
  step: StepTools;
  name: string;
  provider: LLMProvider;
  prompt: Prompt;
  config: LLMConfig;
  tools?: Tool[];
  fn: (response: string) => TResult | Promise<TResult>;
  publish?: (params: {
    channel: string;
    topic: string;
    data: any;
  }) => Promise<void>;
  streamingConfig?: {
    channel: string;
    topic: string;
  };
  sessionId?: string;
};

export async function runAgent<TResult>({
  step,
  name,
  provider,
  prompt,
  config,
  tools = [],
  fn,
  publish,
  streamingConfig,
  sessionId,
}: RunAgentParams<TResult>): Promise<TResult> {
  // Step 1: Execute pre-call tools
  const additionalVariables = await step.run(
    `${name}-pre-call-tools`,
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
    `${name}-hydrate-prompt`,
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
  const configWithTools = await step.run(`${name}-prepare-tools`, async () => {
    const postCallTools = tools.filter(isPostCallTool) as PostCallTool[];
    const functionDefinitions = postCallTools.map(toFunctionSchema);

    return {
      ...config,
      tools: functionDefinitions.length > 0 ? functionDefinitions : undefined,
    };
  });

  // Step 4: LLM interaction loop with tool calling
  const postCallTools = tools.filter(isPostCallTool) as PostCallTool[];
  const MAX_ITERATIONS = 10;

  // Use any[] initially to work around Inngest serialization issues
  let currentMessages: any[] = hydratedMessages as any[];
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    // Step 4a: Call LLM with streaming
    const response = await step.run(
      `${name}-llm-call-${iterations}`,
      async () => {
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
          const BROADCAST_INTERVAL = 50; // Broadcast at least every 50ms

          try {
            for await (const chunk of provider.stream(
              messagesForLLM,
              configWithTools,
            )) {
              if (chunk.content) {
                fullContent += chunk.content;

                // Broadcast at regular intervals
                const now = Date.now();
                if (now - lastBroadcast >= BROADCAST_INTERVAL) {
                  const messageData = {
                    type: "llm_response",
                    content: fullContent,
                    agentName: name,
                    iteration: iterations,
                    streaming: true,
                  };
                  addStreamingMessage(sessionId, { data: messageData });
                  lastBroadcast = now;
                }
              }

              // Check for finish
              if (chunk.finishReason) {
                // Send final complete message
                const finalData = {
                  type: "llm_response",
                  content: fullContent,
                  agentName: name,
                  iteration: iterations,
                  streaming: false,
                  hasToolCalls: false,
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
          };

          // Always store in memory and broadcast via WebSocket
          if (sessionId) {
            addStreamingMessage(sessionId, { data: messageData });
          }

          return llmResponse;
        }
      },
    );

    // Check if we're done (no tool calls)
    if (!response.toolCalls || response.toolCalls.length === 0) {
      // Publish final response
      const finalMessageData = {
        type: "final_response",
        content: response.content,
        agentName: name,
        iteration: iterations,
        completed: true,
      };

      // Always store and broadcast
      if (sessionId) {
        await step.run(`${name}-publish-final-response`, async () => {
          addStreamingMessage(sessionId, { data: finalMessageData });
        });
      }

      // Step 5: Process final response
      const result = await step.run(`${name}-process-response`, async () => {
        return await fn(response.content);
      });
      return result as TResult;
    }

    // Step 4b: Add assistant message with tool calls
    currentMessages = await step.run(
      `${name}-add-assistant-message-${iterations}`,
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
        const toolCall = response.toolCalls[i];

        const toolMessage = await step.run(
          `${name}-tool-${(toolCall as any).function.name}-${iterations}-${i}`,
          async () => {
            const tool = postCallTools.find(
              (t) => t.name === (toolCall as any).function.name,
            );

            if (!tool) {
              return {
                role: "tool",
                content: JSON.stringify({
                  error: `Tool ${(toolCall as any).function.name} not found`,
                }),
                toolCallId: toolCall.id,
              };
            }

            try {
              const args = JSON.parse((toolCall as any).function.arguments);
              const result = await tool.execute(args);

              // Publish tool execution result
              const toolResultData = {
                type: "tool_result",
                toolName: (toolCall as any).function.name,
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
              };
            } catch (error) {
              // Publish tool error
              const toolErrorData = {
                type: "tool_error",
                toolName: (toolCall as any).function.name,
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
              };
            }
          },
        );

        // Add tool message to current messages
        currentMessages = await step.run(
          `${name}-add-tool-message-${iterations}-${i}`,
          async () => {
            return [...currentMessages, toolMessage];
          },
        );
      }
    }
  }

  throw new Error(
    `Max iterations (${MAX_ITERATIONS}) reached in tool calling loop`,
  );
}
