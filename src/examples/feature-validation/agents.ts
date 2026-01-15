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

import type { AgentMetadata, AgentHooks, StepTools } from "../../ai/types";
import { runAgent } from "../../ai/agent";
import { askUser, formatAnswersAsContext } from "../../ai/questions";
import { validateTools } from "../../ai/tools";

import {
  GatherContextResultSchema,
  AnalyzeFeatureResultSchema,
  GenerateReportResultSchema,
  type GatherContextResult,
  type AnalyzeFeatureResult,
  type GenerateReportResult,
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
} from "./tools";

import { createLoggingHooks } from "./hooks";
import { parseJsonResponse, broadcastQuestionsToSession } from "./utils";
import { getProvider, DEFAULT_MODEL } from "./providers";

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
