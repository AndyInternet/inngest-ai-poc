/**
 * Lifecycle Hooks for Feature Validation
 *
 * This file defines lifecycle hooks for both agents and pipelines:
 * - Agent hooks: Track individual agent execution (LLM calls, tool usage)
 * - Pipeline hooks: Track pipeline-level events (agent transitions, errors)
 *
 * These hooks are used for observability and can be extended for
 * custom telemetry, APM integration, or debugging.
 *
 * @module feature-validation/hooks
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

// ============================================================================
// Agent Lifecycle Hooks
// ============================================================================

/**
 * Create logging hooks for agent observability.
 *
 * These hooks log agent lifecycle events and can be extended
 * for custom telemetry, APM integration, or debugging.
 *
 * @example
 * ```typescript
 * const hooks = createLoggingHooks<MyResult>();
 * await runAgent({ ...config, hooks });
 * ```
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

// ============================================================================
// Pipeline Lifecycle Hooks
// ============================================================================

/**
 * Create pipeline hooks for observability.
 *
 * These hooks log pipeline-level events including agent transitions,
 * timing, and error handling.
 *
 * @example
 * ```typescript
 * const hooks = createPipelineHooks();
 * const pipeline = createAgentPipeline({ name: "...", hooks }, agents);
 * ```
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
      // Re-throw errors by default
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
