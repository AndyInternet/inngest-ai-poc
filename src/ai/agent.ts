import type { Prompt, hydratePrompt } from "./prompt";
import type { LLMProvider, LLMConfig } from "./providers/index";
import type { Tool, PreCallTool, PostCallTool } from "./tools";
import { isPreCallTool, isPostCallTool, toFunctionSchema } from "./tools";

export type StepTools = {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
  sleep: (name: string, duration: number | string) => Promise<void>;
  sleepUntil: (name: string, time: Date | string) => Promise<void>;
  invoke: <T = any>(
    name: string,
    opts: {
      function: any;
      data?: any;
      timeout?: number | string;
    },
  ) => Promise<T>;
  waitForEvent: <T = any>(
    name: string,
    opts: {
      event: string;
      timeout: number | string;
      if?: string;
      match?: string;
    },
  ) => Promise<T>;
  sendEvent: (
    name: string,
    events: { name: string; data?: any } | { name: string; data?: any }[],
  ) => Promise<void>;
};

type RunAgentParams<TResult> = {
  step: StepTools;
  name: string;
  provider: LLMProvider;
  prompt: Prompt;
  config: LLMConfig;
  tools?: Tool[];
  fn: (response: string) => TResult | Promise<TResult>;
};

export function runAgent<TResult>({
  step,
  name,
  provider,
  prompt,
  config,
  tools = [],
  fn,
}: RunAgentParams<TResult>) {
  return step.run(name, async () => {
    const { hydratePrompt } = await import("./prompt");

    const preCallTools = tools.filter(isPreCallTool) as PreCallTool[];
    const postCallTools = tools.filter(isPostCallTool) as PostCallTool[];

    let additionalVariables: Record<string, string> = {};
    for (const tool of preCallTools) {
      const result = await tool.execute();
      additionalVariables = { ...additionalVariables, ...result };
    }

    const hydratedPrompt = {
      ...prompt,
      variables: { ...prompt.variables, ...additionalVariables },
    };

    let messages = hydratePrompt(hydratedPrompt);

    const functionDefinitions = postCallTools.map(toFunctionSchema);
    const configWithTools = {
      ...config,
      tools: functionDefinitions.length > 0 ? functionDefinitions : undefined,
    };

    const MAX_ITERATIONS = 10;
    let iterations = 0;

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      const response = await provider.complete(messages, configWithTools);

      if (!response.toolCalls || response.toolCalls.length === 0) {
        return fn(response.content);
      }

      messages.push({
        role: "assistant",
        content: response.content || "",
        toolCalls: response.toolCalls,
      });

      for (const toolCall of response.toolCalls) {
        const tool = postCallTools.find(
          (t) => t.name === toolCall.function.name,
        );

        if (!tool) {
          messages.push({
            role: "tool",
            content: JSON.stringify({
              error: `Tool ${toolCall.function.name} not found`,
            }),
            toolCallId: toolCall.id,
          });
          continue;
        }

        try {
          const args = JSON.parse(toolCall.function.arguments);
          const result = await tool.execute(args);

          messages.push({
            role: "tool",
            content: JSON.stringify(result),
            toolCallId: toolCall.id,
          });
        } catch (error) {
          messages.push({
            role: "tool",
            content: JSON.stringify({ error: (error as Error).message }),
            toolCallId: toolCall.id,
          });
        }
      }
    }

    throw new Error(
      `Max iterations (${MAX_ITERATIONS}) reached in tool calling loop`,
    );
  });
}
