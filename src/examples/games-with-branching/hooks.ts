/**
 * Lifecycle Hooks for Games with Branching
 *
 * @module games-with-branching/hooks
 */

import type {
  AgentHooks,
  AgentContext,
  AgentMetrics,
  LLMMessage,
} from "../../ai/types";
import type {
  PipelineHooks,
  PipelineError,
  ErrorRecoveryResult,
} from "../../ai/pipeline";
import { formatMetricsSummary } from "../../ai/metrics";

/**
 * Create logging hooks for agent observability.
 */
export function createLoggingHooks<TResult = unknown>(): AgentHooks<TResult> {
  return {
    onStart: async (ctx: AgentContext) => {
      console.log(`[${ctx.name}] Started (run: ${ctx.runId})`);
    },

    onLLMStart: async (ctx: AgentContext, messages: LLMMessage[]) => {
      console.log(
        `[${ctx.name}] LLM call #${ctx.iteration} starting (${messages.length} messages)`,
      );
    },

    onLLMEnd: async (
      ctx: AgentContext,
      response: { content: string; hasToolCalls: boolean },
    ) => {
      console.log(
        `[${ctx.name}] LLM call #${ctx.iteration} completed ` +
          `(hasToolCalls: ${response.hasToolCalls})`,
      );
    },

    onToolStart: async (
      ctx: AgentContext,
      tool: string,
      args: Record<string, unknown>,
    ) => {
      console.log(`[${ctx.name}] Tool ${tool} starting`, args);
    },

    onToolEnd: async (
      ctx: AgentContext,
      tool: string,
      _result: unknown,
      durationMs: number,
    ) => {
      console.log(`[${ctx.name}] Tool ${tool} completed (${durationMs}ms)`);
    },

    onToolError: async (ctx: AgentContext, tool: string, error: Error) => {
      console.error(`[${ctx.name}] Tool ${tool} failed:`, error.message);
    },

    onComplete: async (
      ctx: AgentContext,
      _result: TResult,
      metrics: AgentMetrics,
    ) => {
      console.log(`[${ctx.name}] Completed - ${formatMetricsSummary(metrics)}`);
    },

    onError: async (ctx: AgentContext, error: Error) => {
      console.error(`[${ctx.name}] Failed:`, error.message);
    },
  };
}

/**
 * Create pipeline hooks for observability.
 */
export function createPipelineHooks<
  TInput = unknown,
  TOutput = unknown,
>(): PipelineHooks<TInput, TOutput> {
  return {
    onPipelineStart: async (input: TInput, sessionId?: string) => {
      console.log(`[Pipeline] Started (session: ${sessionId || "none"})`);
    },

    onAgentStart: async (agentName: string, agentIndex: number) => {
      console.log(`[Pipeline] Agent ${agentIndex + 1}: ${agentName} starting`);
    },

    onAgentEnd: async (
      agentName: string,
      agentIndex: number,
      _result: unknown,
      durationMs: number,
    ) => {
      console.log(
        `[Pipeline] Agent ${agentIndex + 1}: ${agentName} completed (${durationMs}ms)`,
      );
    },

    onAgentError: async (
      error: PipelineError,
    ): Promise<ErrorRecoveryResult | undefined> => {
      console.error(
        `[Pipeline] Agent ${error.agentName} failed:`,
        error.error.message,
      );
      return { action: "throw" };
    },

    onPipelineEnd: async (_result: TOutput, totalDurationMs: number) => {
      console.log(`[Pipeline] Completed (${totalDurationMs}ms total)`);
    },

    onPipelineError: async (error: Error) => {
      console.error(`[Pipeline] Failed:`, error.message);
    },
  };
}
