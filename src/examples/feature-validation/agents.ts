import { runAgent, streamingMessages } from "../../ai/agent";
import type {
  AgentMetadata,
  AgentHooks,
  AgentContext,
  AgentMetrics,
  StepTools,
  PipelineContext,
  LLMMessage,
} from "../../ai/types";
import { createLLMClient } from "../../ai/providers";
import { askUser } from "../../ai/questions";
import { createAgentPipeline, defineAgent } from "../../ai/flow";

// Helper to add streaming messages (imported from agent.ts pattern)
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
    import("../../index")
      .then((module) => {
        if (module.broadcastToSession) {
          module.broadcastToSession(sessionId, messageWithTimestamp);
        }
      })
      .catch(() => {});
  } catch {
    // Ignore errors
  }
}
import {
  GatherContextResultSchema,
  AnalyzeFeatureResultSchema,
  GenerateReportResultSchema,
  GatherContextInputSchema,
  AnalyzeFeatureInputSchema,
  GenerateReportInputSchema,
  FeatureValidationInputSchema,
  type GatherContextResult,
  type AnalyzeFeatureResult,
  type GenerateReportResult,
  type GatherContextInput,
  type AnalyzeFeatureInput,
  type GenerateReportInput,
  type FeatureValidationInput,
} from "./schemas";

// Standardized metadata for workflow step tracking
const AGENT_METADATA: Record<string, AgentMetadata> = {
  "gather-context": {
    workflowStep: "context",
    displayName: "Context Gathering",
    icon: "🔍",
    description: "Analyzing your requirements and gathering context",
  },
  "analyze-feature": {
    workflowStep: "analysis",
    displayName: "Feature Analysis",
    icon: "⚙️",
    description: "Evaluating feasibility, impact, and strategic alignment",
  },
  "generate-report": {
    workflowStep: "report",
    displayName: "Report Generation",
    icon: "📄",
    description: "Creating comprehensive validation report",
  },
};
// ============================================================================
// Example Lifecycle Hooks - Demonstrate agent observability
// ============================================================================

/**
 * Creates lifecycle hooks for logging and observability.
 * These hooks log agent lifecycle events and can be extended
 * for custom telemetry, APM integration, or debugging.
 */
export function createLoggingHooks<TResult = unknown>(): AgentHooks<TResult> {
  return {
    onStart: async (ctx: AgentContext) => {
      console.log(`[${ctx.name}] Agent started (run: ${ctx.runId})`);
    },

    onLLMStart: async (ctx: AgentContext, messages: LLMMessage[]) => {
      console.log(
        `[${ctx.name}] LLM call starting (iteration: ${ctx.iteration}, messages: ${messages.length})`,
      );
    },

    onLLMEnd: async (
      ctx: AgentContext,
      response: { content: string; hasToolCalls: boolean },
    ) => {
      console.log(
        `[${ctx.name}] LLM call completed (hasToolCalls: ${response.hasToolCalls}, content length: ${response.content.length})`,
      );
    },

    onToolStart: async (
      ctx: AgentContext,
      tool: string,
      args: Record<string, unknown>,
    ) => {
      console.log(`[${ctx.name}] Tool starting: ${tool}`, args);
    },

    onToolEnd: async (
      ctx: AgentContext,
      tool: string,
      _result: unknown,
      durationMs: number,
    ) => {
      console.log(`[${ctx.name}] Tool completed: ${tool} (${durationMs}ms)`);
    },

    onToolError: async (ctx: AgentContext, tool: string, error: Error) => {
      console.error(`[${ctx.name}] Tool error: ${tool}`, error.message);
    },

    onComplete: async (
      ctx: AgentContext,
      _result: TResult,
      metrics: AgentMetrics,
    ) => {
      console.log(`[${ctx.name}] Agent completed successfully`, {
        totalDurationMs: metrics.totalDurationMs,
        llmCalls: metrics.llmCalls,
        toolCalls: metrics.toolCalls,
        toolDurations: metrics.toolDurations,
      });
    },

    onError: async (ctx: AgentContext, error: Error) => {
      console.error(`[${ctx.name}] Agent failed:`, error.message);
    },
  };
}

/**
 * Creates hooks that track metrics for external monitoring systems.
 * This is an example of how hooks can be used for APM integration.
 */
export function createMetricsHooks<TResult = unknown>(
  onMetrics: (agentName: string, metrics: AgentMetrics) => void,
): AgentHooks<TResult> {
  return {
    onComplete: async (
      ctx: AgentContext,
      _result: TResult,
      metrics: AgentMetrics,
    ) => {
      onMetrics(ctx.name, metrics);
    },
    onError: async (ctx: AgentContext, error: Error) => {
      // Report error metrics
      onMetrics(ctx.name, {
        totalDurationMs: 0,
        llmCalls: 0,
        toolCalls: 0,
        toolDurations: {},
      });
      console.error(`Agent ${ctx.name} error:`, error.message);
    },
  };
}

import {
  gatherContextPrompt,
  analyzeFeaturePrompt,
  generateReportPrompt,
} from "./prompts";
import {
  getCurrentDateTool,
  searchKnowledgeBaseTool,
  estimateComplexityTool,
} from "./tools";

const getAnthropicApiKey = () => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY environment variable is required. Please set it in your .env file.",
    );
  }
  return apiKey;
};

/**
 * Robustly parse JSON from LLM response.
 * Handles markdown code blocks and extracts JSON even if there's extra text.
 */
function parseJsonResponse(response: string): any {
  let cleanResponse = response.trim();

  // Strip markdown code blocks if present
  if (cleanResponse.startsWith("```json")) {
    cleanResponse = cleanResponse.replace(/^```json\s*\n?/, "");
  }
  if (cleanResponse.startsWith("```")) {
    cleanResponse = cleanResponse.replace(/^```\s*\n?/, "");
  }
  if (cleanResponse.endsWith("```")) {
    cleanResponse = cleanResponse.replace(/\n?```\s*$/, "");
  }

  // Try to parse directly first
  try {
    return JSON.parse(cleanResponse);
  } catch {
    // If that fails, try to extract JSON object or array
    const jsonMatch = cleanResponse.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch {
        // If extraction also fails, throw with context
        throw new Error(
          `Failed to parse JSON from response. First 500 chars: ${cleanResponse.substring(0, 500)}`,
        );
      }
    }
    throw new Error(
      `No JSON found in response. First 500 chars: ${cleanResponse.substring(0, 500)}`,
    );
  }
}

export async function gatherContextAgent(
  step: StepTools,
  featureDescription: string,
  existingContext: string,
  sessionId?: string,
  hooks?: AgentHooks<GatherContextResult>,
): Promise<GatherContextResult> {
  const agentHooks = hooks ?? createLoggingHooks<GatherContextResult>();

  // First run: allow questions
  const firstResult = await runAgent<GatherContextResult>({
    step,
    name: "gather-context",
    provider: await createLLMClient({
      type: "anthropic",
      apiKey: getAnthropicApiKey(),
    }),
    prompt: gatherContextPrompt(featureDescription, existingContext),
    config: {
      model: "claude-haiku-4-5-20251001",
      temperature: 0.7,
      maxTokens: 2000,
    },
    tools: [getCurrentDateTool, searchKnowledgeBaseTool],
    streaming: sessionId ? { sessionId } : undefined,
    metadata: AGENT_METADATA["gather-context"],
    resultSchema: GatherContextResultSchema,
    hooks: agentHooks,
    fn: (response: string) => parseJsonResponse(response),
  });

  // If no questions or no sessionId, return the result
  if (
    !sessionId ||
    !firstResult.questions ||
    firstResult.questions.length === 0
  ) {
    return firstResult;
  }

  // Ask questions (max 5)
  const questions = firstResult.questions.slice(0, 5);

  // Notify UI about questions
  await step.run("gather-context-send-questions", async () => {
    addStreamingMessage(sessionId, {
      data: {
        type: "questions",
        content: "The AI needs more information to continue.",
        questions: questions,
        agentName: "gather-context",
        metadata: AGENT_METADATA["gather-context"],
      },
    });
  });

  // Wait for answers - use deterministic step ID so Inngest can resume correctly
  const answers = await askUser(step, {
    questions,
    sessionId,
    timeout: "1h",
    eventName: "feature.validation.answers.provided",
    stepId: "gather-context-wait-for-answers",
  });

  // Build context with answers
  const answersContext = Object.entries(answers)
    .map(([q, a]) => `Q: ${q}\nA: ${a}`)
    .join("\n\n");

  const updatedContext = existingContext
    ? `${existingContext}\n\nUser provided answers:\n${answersContext}`
    : `User provided answers:\n${answersContext}`;

  // Second run: NO questions allowed, must proceed with what we have
  const secondResult = await runAgent<GatherContextResult>({
    step,
    name: "gather-context-final",
    provider: await createLLMClient({
      type: "anthropic",
      apiKey: getAnthropicApiKey(),
    }),
    prompt: {
      messages: [
        {
          role: "system",
          content: `You are a product strategy advisor. You have gathered context about a feature request.

Context gathered:
{{existingContext}}

Based on this context, provide your analysis. Do NOT ask any more questions - work with what you have. If information is incomplete, note what's missing in your reasoning.

Respond in JSON format:
{
  "reasoning": "Your analysis of the context gathered",
  "hasEnoughContext": true,
  "summary": "Brief summary of the context you have"
}`,
        },
        {
          role: "user",
          content: `Feature to evaluate: {{featureDescription}}`,
        },
      ],
      variables: {
        featureDescription,
        existingContext: updatedContext,
      },
    },
    config: {
      model: "claude-haiku-4-5-20251001",
      temperature: 0.7,
      maxTokens: 2000,
    },
    tools: [getCurrentDateTool, searchKnowledgeBaseTool],
    streaming: sessionId ? { sessionId } : undefined,
    metadata: AGENT_METADATA["gather-context"],
    resultSchema: GatherContextResultSchema,
    hooks: agentHooks,
    fn: (response: string) => parseJsonResponse(response),
  });

  return secondResult;
}

export async function analyzeFeatureAgent(
  step: StepTools,
  featureDescription: string,
  context: string,
  sessionId?: string,
  hooks?: AgentHooks<AnalyzeFeatureResult>,
): Promise<AnalyzeFeatureResult> {
  return await runAgent<AnalyzeFeatureResult>({
    step,
    name: "analyze-feature",
    provider: await createLLMClient({
      type: "anthropic",
      apiKey: getAnthropicApiKey(),
    }),
    prompt: analyzeFeaturePrompt(featureDescription, context),
    config: {
      model: "claude-haiku-4-5-20251001",
      temperature: 0.7,
      maxTokens: 3000,
    },
    tools: [
      getCurrentDateTool,
      searchKnowledgeBaseTool,
      estimateComplexityTool,
    ],
    streaming: sessionId ? { sessionId } : undefined,
    metadata: AGENT_METADATA["analyze-feature"],
    resultSchema: AnalyzeFeatureResultSchema,
    hooks: hooks ?? createLoggingHooks<AnalyzeFeatureResult>(),
    fn: (response: string) => parseJsonResponse(response),
  });
}

export async function generateReportAgent(
  step: StepTools,
  analysisResult: AnalyzeFeatureResult,
  sessionId?: string,
  hooks?: AgentHooks<GenerateReportResult>,
): Promise<GenerateReportResult> {
  return await runAgent<GenerateReportResult>({
    step,
    name: "generate-report",
    provider: await createLLMClient({
      type: "anthropic",
      apiKey: getAnthropicApiKey(),
    }),
    prompt: generateReportPrompt(analysisResult),
    config: {
      model: "claude-haiku-4-5-20251001",
      temperature: 0.5,
      maxTokens: 4000,
    },
    streaming: sessionId ? { sessionId } : undefined,
    metadata: AGENT_METADATA["generate-report"],
    resultSchema: GenerateReportResultSchema,
    hooks: hooks ?? createLoggingHooks<GenerateReportResult>(),
    fn: (response: string) => response,
  });
}

// ============================================================================
// Pipeline Definition - Compose agents into a single workflow
// ============================================================================

/**
 * Feature validation pipeline that composes all three agents.
 * This provides a simplified API for running the entire workflow.
 *
 * @example
 * ```typescript
 * const result = await featureValidationPipeline.run(
 *   step,
 *   { featureDescription: "Add dark mode", existingContext: "" },
 *   sessionId
 * );
 * ```
 */
export const featureValidationPipeline = createAgentPipeline<
  FeatureValidationInput,
  GenerateReportResult
>(
  {
    name: "feature-validation",
    description:
      "Validate a feature request through context gathering, analysis, and report generation",
  },
  [
    defineAgent<GatherContextInput, GatherContextResult>({
      name: "gather-context",
      description: "Gather context and determine if enough information exists",
      inputSchema: GatherContextInputSchema,
      outputSchema: GatherContextResultSchema,
      mapInput: (_prev, ctx: PipelineContext) => ({
        featureDescription: ctx.initialInput.featureDescription,
        existingContext: ctx.initialInput.existingContext || "",
      }),
      run: async (step, input, sessionId) => {
        return await gatherContextAgent(
          step,
          input.featureDescription,
          input.existingContext || "",
          sessionId,
        );
      },
    }),
    defineAgent<AnalyzeFeatureInput, AnalyzeFeatureResult>({
      name: "analyze-feature",
      description:
        "Analyze the feature for impact, value, and strategic alignment",
      inputSchema: AnalyzeFeatureInputSchema,
      outputSchema: AnalyzeFeatureResultSchema,
      mapInput: (_prev, ctx: PipelineContext) => ({
        featureDescription: ctx.initialInput.featureDescription,
        context: JSON.stringify(ctx.results["gather-context"]),
      }),
      run: async (step, input, sessionId) => {
        return await analyzeFeatureAgent(
          step,
          input.featureDescription,
          input.context,
          sessionId,
        );
      },
    }),
    defineAgent<GenerateReportInput, GenerateReportResult>({
      name: "generate-report",
      description: "Generate a comprehensive validation report",
      inputSchema: GenerateReportInputSchema,
      outputSchema: GenerateReportResultSchema,
      mapInput: (_prev, ctx: PipelineContext) => ({
        analysisResult: ctx.results["analyze-feature"],
      }),
      run: async (step, input, sessionId) => {
        return await generateReportAgent(step, input.analysisResult, sessionId);
      },
    }),
  ],
);
