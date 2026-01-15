/**
 * Feature Validation Agents
 *
 * This file defines the AI agents for the feature validation pipeline:
 * 1. evaluate-context: Determines if enough context exists to proceed
 * 2. ask-questions: Conditionally asks user for more information (human-in-the-loop)
 * 3. analyze-feature: Evaluates the feature across multiple dimensions
 * 4. generate-report: Creates a comprehensive validation report
 *
 * Each agent demonstrates key patterns:
 * - Using runAgent with Zod schema validation
 * - Tool calling (pre-call and post-call)
 * - Lifecycle hooks for observability
 * - Conditional execution with shouldRun
 * - Human-in-the-loop with askUser
 *
 * @module feature-validation/agents
 */

// ============================================================================
// Imports
// ============================================================================

import type { AgentMetadata, AgentHooks, StepTools } from "../../ai/types";
import { runAgent } from "../../ai/agent";
import { askUser, formatAnswersAsContext } from "../../ai/questions";
import { validateTools } from "../../ai/tools";

import {
  EvaluateContextResultSchema,
  AskQuestionsResultSchema,
  AnalyzeFeatureResultSchema,
  GenerateReportResultSchema,
  type EvaluateContextResult,
  type AskQuestionsResult,
  type AnalyzeFeatureResult,
  type GenerateReportResult,
} from "./schemas";

import {
  evaluateContextPrompt,
  analyzeFeaturePrompt,
  generateReportPrompt,
} from "./prompts";

import {
  getCurrentDateTool,
  searchKnowledgeBaseTool,
  estimateComplexityTool,
} from "./tools";

import { createLoggingHooks } from "./hooks";
import { parseJsonResponse, broadcastQuestionsToSession } from "./utils";
import { getProvider, DEFAULT_MODEL } from "./providers";

// ============================================================================
// Individual Agent Functions
// ============================================================================

/**
 * Evaluate context about a feature request.
 *
 * This agent:
 * 1. Analyzes existing context
 * 2. Determines if more information is needed
 * 3. Returns questions to ask if context is insufficient
 *
 * @param step - Inngest step tools
 * @param featureDescription - The feature to evaluate
 * @param existingContext - Any existing context
 * @param sessionId - Optional session ID for streaming
 * @param hooks - Optional lifecycle hooks
 * @returns Context evaluation result with hasEnoughContext flag and optional questions
 */
export async function evaluateContextAgent(
  step: StepTools,
  featureDescription: string,
  existingContext: string,
  sessionId?: string,
  hooks?: AgentHooks<EvaluateContextResult>,
): Promise<EvaluateContextResult> {
  const provider = await getProvider();
  const agentHooks = hooks ?? createLoggingHooks<EvaluateContextResult>();

  // Validate tools before use
  validateTools([getCurrentDateTool, searchKnowledgeBaseTool]);

  return runAgent<EvaluateContextResult>({
    step,
    name: "evaluate-context",
    provider,
    prompt: evaluateContextPrompt(featureDescription, existingContext),
    config: {
      model: DEFAULT_MODEL,
      temperature: 0.7,
      maxTokens: 2000,
    },
    tools: [getCurrentDateTool, searchKnowledgeBaseTool],
    streaming: sessionId ? { sessionId } : undefined,
    metadata: {
      workflowStep: "context",
      displayName: "Context Evaluation",
      icon: "search",
      description: "Evaluating if enough context exists to proceed",
    },
    resultSchema: EvaluateContextResultSchema,
    hooks: agentHooks,
    fn: parseJsonResponse<EvaluateContextResult>,
  });
}

/**
 * Ask questions to gather more context (human-in-the-loop).
 *
 * This agent:
 * 1. Broadcasts questions to the UI
 * 2. Waits for user answers
 * 3. Returns enriched context with answers
 *
 * This agent should only run when evaluate-context returns hasEnoughContext=false.
 *
 * @param step - Inngest step tools
 * @param featureDescription - The feature to evaluate
 * @param existingContext - Any existing context
 * @param questions - Questions to ask the user
 * @param sessionId - Session ID for streaming (required for this agent)
 * @param hooks - Optional lifecycle hooks
 * @returns Result with enriched context
 */
export async function askQuestionsAgent(
  step: StepTools,
  featureDescription: string,
  existingContext: string,
  questions: string[],
  sessionId: string,
  hooks?: AgentHooks<AskQuestionsResult>,
): Promise<AskQuestionsResult> {
  const agentHooks = hooks ?? createLoggingHooks<AskQuestionsResult>();

  const metadata: AgentMetadata = {
    workflowStep: "context",
    displayName: "Gathering Information",
    icon: "question",
    description: "Asking clarifying questions to gather more context",
  };

  // Call onStart hook
  await agentHooks.onStart?.({
    name: "ask-questions",
    runId: "ask-questions",
    iteration: 1,
    metadata,
    sessionId,
  });

  // Limit to 5 questions maximum
  const limitedQuestions = questions.slice(0, 5);

  // Notify UI that questions are ready
  await step.run("ask-questions-notify", async () => {
    broadcastQuestionsToSession(
      sessionId,
      limitedQuestions,
      "ask-questions",
      metadata,
    );
  });

  // Wait for user answers (human-in-the-loop)
  const answers = await askUser(step, {
    questions: limitedQuestions,
    sessionId,
    stepId: "ask-questions-wait-for-answers", // Deterministic step ID!
    timeout: "1h",
    eventName: "feature.validation.answers.provided",
  });

  // Format answers for the context
  const answersContext = formatAnswersAsContext(answers);
  const enrichedContext = existingContext
    ? `${existingContext}\n\nUser provided answers:\n${answersContext}`
    : `User provided answers:\n${answersContext}`;

  const result: AskQuestionsResult = {
    enrichedContext,
    answersReceived: Object.keys(answers).length,
  };

  // Call onComplete hook
  await agentHooks.onComplete?.(
    {
      name: "ask-questions",
      runId: "ask-questions",
      iteration: 1,
      metadata,
      sessionId,
    },
    result,
    { totalDurationMs: 0, llmCalls: 0, toolCalls: 0, toolDurations: {} },
  );

  return result;
}

/**
 * Analyze a feature for impact, value, and strategic alignment.
 *
 * This agent evaluates the feature across multiple dimensions
 * and provides scores along with a recommendation.
 *
 * @param step - Inngest step tools
 * @param featureDescription - The feature to evaluate
 * @param context - Context gathered from previous agents
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
    metadata: {
      workflowStep: "analysis",
      displayName: "Feature Analysis",
      icon: "chart",
      description: "Evaluating feasibility, impact, and strategic alignment",
    },
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
    metadata: {
      workflowStep: "report",
      displayName: "Report Generation",
      icon: "document",
      description: "Creating comprehensive validation report",
    },
    resultSchema: GenerateReportResultSchema,
    hooks: hooks ?? createLoggingHooks<GenerateReportResult>(),
    fn: (response: string) => response, // Report is plain text/markdown
  });
}
