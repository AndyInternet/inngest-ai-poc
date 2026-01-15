/**
 * Feature Validation Agents
 *
 * This file defines the AI agents for the feature validation pipeline:
 * 1. gather-context: Determines if enough context exists, asks questions if needed
 * 2. analyze-feature: Evaluates the feature across multiple dimensions
 * 3. generate-report: Creates a comprehensive validation report
 *
 * Each agent demonstrates key patterns:
 * - Using runAgent with Zod schema validation
 * - Tool calling (pre-call and post-call)
 * - Lifecycle hooks for observability
 * - Human-in-the-loop with askUser
 *
 * @module feature-validation/agents
 */

// ============================================================================
// Imports
// ============================================================================

import type {
  AgentMetadata,
  AgentHooks,
  AgentContext,
  AgentMetrics,
  StepTools,
  LLMMessage,
  LLMProvider,
} from "../../ai/types";
import type {
  PipelineHooks,
  PipelineError,
  ErrorRecoveryResult,
} from "../../ai/flow";
import { runAgent } from "../../ai/agent";
import { createLLMClient } from "../../ai/providers";
import { askUser, formatAnswersAsContext } from "../../ai/questions";
import { createAgentPipeline, defineAgent } from "../../ai/flow";
import { validateTools } from "../../ai/tools";
import {
  globalStreamingManager,
  createQuestionsMessage,
} from "../../ai/streaming";
import { formatMetricsSummary } from "../../ai/metrics";

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

import {
  gatherContextPrompt,
  gatherContextFinalPrompt,
  analyzeFeaturePrompt,
  generateReportPrompt,
} from "./prompts";

import {
  getCurrentDateTool,
  searchKnowledgeBaseTool,
  estimateComplexityTool,
  allTools,
} from "./tools";

// ============================================================================
// Configuration
// ============================================================================

/**
 * Get the Anthropic API key from environment.
 * Throws a helpful error if not configured.
 */
function getAnthropicApiKey(): string {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY environment variable is required. " +
        "Please set it in your .env file.",
    );
  }
  return apiKey;
}

/**
 * Default model configuration for all agents.
 */
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

/**
 * Cached LLM provider instance.
 * Reusing the provider avoids creating multiple client instances.
 */
let cachedProvider: LLMProvider | null = null;

/**
 * Get or create the LLM provider.
 */
async function getProvider(): Promise<LLMProvider> {
  if (!cachedProvider) {
    cachedProvider = await createLLMClient({
      type: "anthropic",
      apiKey: getAnthropicApiKey(),
    });
  }
  return cachedProvider;
}

// ============================================================================
// Agent Metadata
// ============================================================================

/**
 * Metadata for each agent, used for UI display and tracking.
 */
const AGENT_METADATA: Record<string, AgentMetadata> = {
  "gather-context": {
    workflowStep: "context",
    displayName: "Context Gathering",
    icon: "search",
    description: "Analyzing requirements and gathering context",
  },
  "analyze-feature": {
    workflowStep: "analysis",
    displayName: "Feature Analysis",
    icon: "chart",
    description: "Evaluating feasibility, impact, and strategic alignment",
  },
  "generate-report": {
    workflowStep: "report",
    displayName: "Report Generation",
    icon: "document",
    description: "Creating comprehensive validation report",
  },
};

// ============================================================================
// Lifecycle Hooks
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

/**
 * Create pipeline hooks for observability.
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

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse JSON from LLM response, handling markdown code blocks.
 *
 * LLMs often wrap JSON in markdown code blocks. This function
 * handles that and provides helpful error messages on failure.
 */
function parseJsonResponse<T>(response: string): T {
  let cleanResponse = response.trim();

  // Strip markdown code blocks
  if (cleanResponse.startsWith("```json")) {
    cleanResponse = cleanResponse.replace(/^```json\s*\n?/, "");
  }
  if (cleanResponse.startsWith("```")) {
    cleanResponse = cleanResponse.replace(/^```\s*\n?/, "");
  }
  if (cleanResponse.endsWith("```")) {
    cleanResponse = cleanResponse.replace(/\n?```\s*$/, "");
  }

  // Try direct parse
  try {
    return JSON.parse(cleanResponse);
  } catch {
    // Try to extract JSON from response
    const jsonMatch = cleanResponse.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch {
        // Fall through to error
      }
    }
    throw new Error(
      `Failed to parse JSON from response. Content: ${cleanResponse.substring(0, 200)}...`,
    );
  }
}

/**
 * Broadcast a questions message to the streaming session.
 *
 * Sends a questions message to the UI for human-in-the-loop interactions.
 * The UI listens for messages with type="questions" to display
 * question prompts to the user.
 */
function broadcastQuestionsToSession(
  sessionId: string,
  questions: string[],
  agentName: string,
  metadata?: AgentMetadata,
): void {
  globalStreamingManager.addMessage(
    sessionId,
    createQuestionsMessage(
      agentName,
      questions,
      "The AI needs more information to continue.",
      metadata,
    ),
  );
}

// ============================================================================
// Individual Agent Functions
// ============================================================================

/**
 * Gather context about a feature request.
 *
 * This agent:
 * 1. Analyzes existing context
 * 2. Determines if more information is needed
 * 3. Asks clarifying questions if needed (human-in-the-loop)
 * 4. Returns a summary of gathered context
 *
 * @param step - Inngest step tools
 * @param featureDescription - The feature to evaluate
 * @param existingContext - Any existing context
 * @param sessionId - Optional session ID for streaming
 * @param hooks - Optional lifecycle hooks
 * @returns Context gathering result with reasoning and summary
 */
export async function gatherContextAgent(
  step: StepTools,
  featureDescription: string,
  existingContext: string,
  sessionId?: string,
  hooks?: AgentHooks<GatherContextResult>,
): Promise<GatherContextResult> {
  const provider = await getProvider();
  const agentHooks = hooks ?? createLoggingHooks<GatherContextResult>();

  // Validate tools before use
  validateTools([getCurrentDateTool, searchKnowledgeBaseTool]);

  // First pass: analyze context and potentially ask questions
  const firstResult = await runAgent<GatherContextResult>({
    step,
    name: "gather-context",
    provider,
    prompt: gatherContextPrompt(featureDescription, existingContext),
    config: {
      model: DEFAULT_MODEL,
      temperature: 0.7,
      maxTokens: 2000,
    },
    tools: [getCurrentDateTool, searchKnowledgeBaseTool],
    streaming: sessionId ? { sessionId } : undefined,
    metadata: AGENT_METADATA["gather-context"],
    resultSchema: GatherContextResultSchema,
    hooks: agentHooks,
    fn: parseJsonResponse<GatherContextResult>,
  });

  // If no questions or no sessionId, return result
  if (
    !sessionId ||
    !firstResult.questions ||
    firstResult.questions.length === 0
  ) {
    return firstResult;
  }

  // Limit to 5 questions maximum
  const questions = firstResult.questions.slice(0, 5);

  // Notify UI that questions are ready
  await step.run("gather-context-notify-questions", async () => {
    broadcastQuestionsToSession(
      sessionId,
      questions,
      "gather-context",
      AGENT_METADATA["gather-context"],
    );
  });

  // Wait for user answers (human-in-the-loop)
  const answers = await askUser(step, {
    questions,
    sessionId,
    stepId: "gather-context-wait-for-answers", // Deterministic step ID!
    timeout: "1h",
    eventName: "feature.validation.answers.provided",
  });

  // Format answers for the prompt
  const answersContext = formatAnswersAsContext(answers);
  const updatedContext = existingContext
    ? `${existingContext}\n\nUser provided answers:\n${answersContext}`
    : `User provided answers:\n${answersContext}`;

  // Second pass: proceed with gathered context (no more questions)
  const secondResult = await runAgent<GatherContextResult>({
    step,
    name: "gather-context-final",
    provider,
    prompt: gatherContextFinalPrompt(featureDescription, updatedContext),
    config: {
      model: DEFAULT_MODEL,
      temperature: 0.7,
      maxTokens: 2000,
    },
    tools: [getCurrentDateTool, searchKnowledgeBaseTool],
    streaming: sessionId ? { sessionId } : undefined,
    metadata: AGENT_METADATA["gather-context"],
    resultSchema: GatherContextResultSchema,
    hooks: agentHooks,
    fn: parseJsonResponse<GatherContextResult>,
  });

  return secondResult;
}

/**
 * Analyze a feature for impact, value, and strategic alignment.
 *
 * This agent evaluates the feature across multiple dimensions
 * and provides scores along with a recommendation.
 *
 * @param step - Inngest step tools
 * @param featureDescription - The feature to evaluate
 * @param context - Context gathered from previous agent
 * @param sessionId - Optional session ID for streaming
 * @param hooks - Optional lifecycle hooks
 * @returns Analysis result with scores and recommendation
 */
export async function analyzeFeatureAgent(
  step: StepTools,
  featureDescription: string,
  context: string,
  sessionId?: string,
  hooks?: AgentHooks<AnalyzeFeatureResult>,
): Promise<AnalyzeFeatureResult> {
  const provider = await getProvider();
  const tools = [
    getCurrentDateTool,
    searchKnowledgeBaseTool,
    estimateComplexityTool,
  ];

  // Validate tools before use
  validateTools(tools);

  return runAgent<AnalyzeFeatureResult>({
    step,
    name: "analyze-feature",
    provider,
    prompt: analyzeFeaturePrompt(featureDescription, context),
    config: {
      model: DEFAULT_MODEL,
      temperature: 0.7,
      maxTokens: 3000,
    },
    tools,
    streaming: sessionId ? { sessionId } : undefined,
    metadata: AGENT_METADATA["analyze-feature"],
    resultSchema: AnalyzeFeatureResultSchema,
    hooks: hooks ?? createLoggingHooks<AnalyzeFeatureResult>(),
    fn: parseJsonResponse<AnalyzeFeatureResult>,
  });
}

/**
 * Generate a comprehensive validation report.
 *
 * This agent creates a markdown-formatted report summarizing
 * the analysis findings and recommendation.
 *
 * @param step - Inngest step tools
 * @param analysisResult - Analysis result from previous agent
 * @param sessionId - Optional session ID for streaming
 * @param hooks - Optional lifecycle hooks
 * @returns Markdown report string
 */
export async function generateReportAgent(
  step: StepTools,
  analysisResult: AnalyzeFeatureResult,
  sessionId?: string,
  hooks?: AgentHooks<GenerateReportResult>,
): Promise<GenerateReportResult> {
  const provider = await getProvider();

  return runAgent<GenerateReportResult>({
    step,
    name: "generate-report",
    provider,
    prompt: generateReportPrompt(analysisResult),
    config: {
      model: DEFAULT_MODEL,
      temperature: 0.5, // Lower temperature for more consistent reports
      maxTokens: 4000,
    },
    streaming: sessionId ? { sessionId } : undefined,
    metadata: AGENT_METADATA["generate-report"],
    resultSchema: GenerateReportResultSchema,
    hooks: hooks ?? createLoggingHooks<GenerateReportResult>(),
    fn: (response: string) => response, // Report is plain text/markdown
  });
}

// ============================================================================
// Pipeline Definition
// ============================================================================

/**
 * Feature validation pipeline that composes all three agents.
 *
 * This pipeline demonstrates:
 * - Sequential agent execution
 * - Context passing between agents via mapInput
 * - Input/output schema validation
 * - Pipeline lifecycle hooks
 *
 * @example
 * ```typescript
 * const result = await featureValidationPipeline.run(
 *   step,
 *   {
 *     featureDescription: "Add dark mode support",
 *     existingContext: "B2B SaaS platform for project management",
 *   },
 *   sessionId,
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
    hooks: createPipelineHooks<FeatureValidationInput, GenerateReportResult>(),
  },
  [
    // Agent 1: Gather Context
    defineAgent<
      GatherContextInput,
      GatherContextResult,
      FeatureValidationInput,
      FeatureValidationInput,
      Record<string, unknown>
    >({
      name: "gather-context",
      description: "Gather context and determine if enough information exists",
      inputSchema: GatherContextInputSchema,
      outputSchema: GatherContextResultSchema,
      mapInput: (_prev, ctx) => ({
        featureDescription: ctx.initialInput.featureDescription,
        existingContext: ctx.initialInput.existingContext || "",
      }),
      run: async (step, input, sessionId) => {
        return gatherContextAgent(
          step,
          input.featureDescription,
          input.existingContext || "",
          sessionId,
        );
      },
    }),

    // Agent 2: Analyze Feature
    defineAgent<
      AnalyzeFeatureInput,
      AnalyzeFeatureResult,
      GatherContextResult,
      FeatureValidationInput,
      { "gather-context": GatherContextResult }
    >({
      name: "analyze-feature",
      description:
        "Analyze the feature for impact, value, and strategic alignment",
      inputSchema: AnalyzeFeatureInputSchema,
      outputSchema: AnalyzeFeatureResultSchema,
      mapInput: (_prev, ctx) => ({
        featureDescription: ctx.initialInput.featureDescription,
        context: JSON.stringify(ctx.results["gather-context"]),
      }),
      run: async (step, input, sessionId) => {
        return analyzeFeatureAgent(
          step,
          input.featureDescription,
          input.context,
          sessionId,
        );
      },
    }),

    // Agent 3: Generate Report
    defineAgent<
      GenerateReportInput,
      GenerateReportResult,
      AnalyzeFeatureResult,
      FeatureValidationInput,
      {
        "gather-context": GatherContextResult;
        "analyze-feature": AnalyzeFeatureResult;
      }
    >({
      name: "generate-report",
      description: "Generate a comprehensive validation report",
      inputSchema: GenerateReportInputSchema,
      outputSchema: GenerateReportResultSchema,
      mapInput: (_prev, ctx) => ({
        analysisResult: ctx.results["analyze-feature"],
      }),
      run: async (step, input, sessionId) => {
        return generateReportAgent(step, input.analysisResult, sessionId);
      },
    }),
  ],
);
