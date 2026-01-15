/**
 * Inngest Functions and Pipeline for Feature Validation
 *
 * This file defines:
 * 1. The feature validation pipeline that composes all agents
 * 2. Inngest functions that expose the pipeline as event-triggered workflows
 *
 * The pipeline demonstrates conditional agent execution using shouldRun:
 * - evaluate-context: Always runs, determines if more info is needed
 * - ask-questions: Only runs if hasEnoughContext is false (conditional)
 * - analyze-feature: Always runs
 * - generate-report: Always runs
 *
 * @module feature-validation/pipelines
 */

import { inngest } from "../../inngest/client";
import { createAgentPipeline, defineAgent } from "../../ai/pipeline";

import {
  evaluateContextAgent,
  askQuestionsAgent,
  analyzeFeatureAgent,
  generateReportAgent,
} from "./agents";

import {
  EvaluateContextResultSchema,
  AskQuestionsResultSchema,
  AnalyzeFeatureResultSchema,
  GenerateReportResultSchema,
  EvaluateContextInputSchema,
  AskQuestionsInputSchema,
  AnalyzeFeatureInputSchema,
  GenerateReportInputSchema,
  type EvaluateContextResult,
  type AskQuestionsResult,
  type AnalyzeFeatureResult,
  type GenerateReportResult,
  type EvaluateContextInput,
  type AskQuestionsInput,
  type AnalyzeFeatureInput,
  type GenerateReportInput,
  type FeatureValidationInput,
  type FeatureValidationResult,
} from "./schemas";

import { createPipelineHooks } from "./hooks";

// ============================================================================
// Pipeline Definition
// ============================================================================

/**
 * Feature validation pipeline that composes all four agents.
 *
 * This pipeline demonstrates:
 * - Sequential agent execution
 * - Conditional execution with shouldRun (ask-questions only runs if needed)
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
      "Validate a feature request through context evaluation, optional questioning, analysis, and report generation",
    hooks: createPipelineHooks<FeatureValidationInput, GenerateReportResult>(),
  },
  [
    // Agent 1: Evaluate Context
    // Always runs - determines if we have enough context to proceed
    defineAgent<
      EvaluateContextInput,
      EvaluateContextResult,
      FeatureValidationInput,
      FeatureValidationInput,
      Record<string, unknown>
    >({
      name: "evaluate-context",
      description: "Evaluate if enough context exists to analyze the feature",
      inputSchema: EvaluateContextInputSchema,
      outputSchema: EvaluateContextResultSchema,
      mapInput: (_prev, ctx) => ({
        featureDescription: ctx.initialInput.featureDescription,
        existingContext: ctx.initialInput.existingContext || "",
      }),
      run: async (step, input, sessionId) => {
        return evaluateContextAgent(
          step,
          input.featureDescription,
          input.existingContext,
          sessionId,
        );
      },
    }),

    // Agent 2: Ask Questions (Conditional)
    // Only runs if evaluate-context determined we need more information
    defineAgent<
      AskQuestionsInput,
      AskQuestionsResult,
      EvaluateContextResult,
      FeatureValidationInput,
      { "evaluate-context": EvaluateContextResult }
    >({
      name: "ask-questions",
      description:
        "Ask clarifying questions if more context is needed (human-in-the-loop)",
      inputSchema: AskQuestionsInputSchema,
      outputSchema: AskQuestionsResultSchema,
      // Only run if we don't have enough context AND we have a sessionId for user interaction
      shouldRun: async (prevResult, ctx) => {
        const evalResult = prevResult as EvaluateContextResult;
        const hasSessionId = !!ctx.sessionId;
        const needsQuestions =
          !evalResult.hasEnoughContext &&
          Array.isArray(evalResult.questions) &&
          evalResult.questions.length > 0;
        return hasSessionId && needsQuestions;
      },
      // If skipped, return empty result
      skipResult: {
        enrichedContext: "",
        answersReceived: 0,
      } as AskQuestionsResult,
      mapInput: (_prev, ctx) => {
        const evalResult = ctx.results["evaluate-context"];
        return {
          featureDescription: ctx.initialInput.featureDescription,
          existingContext: ctx.initialInput.existingContext || "",
          questions: evalResult.questions || [],
        };
      },
      run: async (step, input, sessionId) => {
        return askQuestionsAgent(
          step,
          input.featureDescription,
          input.existingContext,
          input.questions,
          sessionId!, // sessionId is guaranteed by shouldRun
        );
      },
    }),

    // Agent 3: Analyze Feature
    // Always runs - uses context from either evaluate-context or ask-questions
    defineAgent<
      AnalyzeFeatureInput,
      AnalyzeFeatureResult,
      AskQuestionsResult,
      FeatureValidationInput,
      {
        "evaluate-context": EvaluateContextResult;
        "ask-questions": AskQuestionsResult;
      }
    >({
      name: "analyze-feature",
      description:
        "Analyze the feature for impact, value, and strategic alignment",
      inputSchema: AnalyzeFeatureInputSchema,
      outputSchema: AnalyzeFeatureResultSchema,
      mapInput: (_prev, ctx) => {
        const evalResult = ctx.results["evaluate-context"];
        const askResult = ctx.results["ask-questions"];

        // Use enriched context from ask-questions if available,
        // otherwise use context summary from evaluate-context
        let context: string;
        if (askResult && askResult.enrichedContext) {
          context = askResult.enrichedContext;
        } else if (evalResult.contextSummary) {
          context = evalResult.contextSummary;
        } else {
          context =
            ctx.initialInput.existingContext ||
            "No additional context available.";
        }

        return {
          featureDescription: ctx.initialInput.featureDescription,
          context,
        };
      },
      run: async (step, input, sessionId) => {
        return analyzeFeatureAgent(
          step,
          input.featureDescription,
          input.context,
          sessionId,
        );
      },
    }),

    // Agent 4: Generate Report
    // Always runs - creates final report from analysis
    defineAgent<
      GenerateReportInput,
      GenerateReportResult,
      AnalyzeFeatureResult,
      FeatureValidationInput,
      {
        "evaluate-context": EvaluateContextResult;
        "ask-questions": AskQuestionsResult;
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

// ============================================================================
// Inngest Functions
// ============================================================================

/**
 * Feature validation workflow function.
 *
 * Triggered by the "feature.validation.start" event, this function runs
 * the complete feature validation pipeline:
 * 1. Evaluate context (determine if enough info exists)
 * 2. Ask questions (only if needed - conditional execution)
 * 3. Analyze feature across multiple dimensions
 * 4. Generate comprehensive report
 *
 * @example
 * ```typescript
 * // Trigger the workflow
 * await inngest.send({
 *   name: "feature.validation.start",
 *   data: {
 *     featureDescription: "Add dark mode support to the application",
 *     existingContext: "B2B SaaS platform for project management",
 *     sessionId: "user-session-123",
 *   },
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Handle the answer event (human-in-the-loop)
 * await inngest.send({
 *   name: "feature.validation.answers.provided",
 *   data: {
 *     sessionId: "user-session-123",
 *     answers: {
 *       "What is the target audience?": "Enterprise customers",
 *       "What problem does this solve?": "Eye strain during night usage",
 *     },
 *   },
 * });
 * ```
 */
export const featureValidationFunction = inngest.createFunction(
  {
    id: "feature-validation",
    name: "Feature Validation Pipeline",
    retries: 3,
  },
  { event: "feature.validation.start" },
  async ({ event, step }): Promise<FeatureValidationResult> => {
    const {
      featureDescription,
      existingContext = "",
      sessionId,
    } = event.data as {
      featureDescription: string;
      existingContext?: string;
      sessionId?: string;
    };

    // Run the complete pipeline
    const report = await featureValidationPipeline.run(
      step,
      { featureDescription, existingContext },
      sessionId,
    );

    return {
      featureDescription,
      report,
      completedAt: new Date().toISOString(),
    };
  },
);

// ============================================================================
// Function Registry
// ============================================================================

/**
 * All Inngest functions for the feature validation example.
 * Export this array to register with Inngest.
 */
export const featureValidationFunctions = [featureValidationFunction];
