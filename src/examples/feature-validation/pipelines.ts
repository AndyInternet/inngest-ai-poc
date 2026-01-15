/**
 * Inngest Functions and Pipeline for Feature Validation
 *
 * This file defines:
 * 1. The feature validation pipeline that composes all agents
 * 2. Inngest functions that expose the pipeline as event-triggered workflows
 *
 * @module feature-validation/pipelines
 */

import { inngest } from "../../inngest/client";
import { createAgentPipeline, defineAgent } from "../../ai/pipeline";

import {
  gatherContextAgent,
  analyzeFeatureAgent,
  generateReportAgent,
} from "./agents";

import {
  GatherContextResultSchema,
  AnalyzeFeatureResultSchema,
  GenerateReportResultSchema,
  GatherContextInputSchema,
  AnalyzeFeatureInputSchema,
  GenerateReportInputSchema,
  type GatherContextResult,
  type AnalyzeFeatureResult,
  type GenerateReportResult,
  type GatherContextInput,
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

// ============================================================================
// Inngest Functions
// ============================================================================

/**
 * Feature validation workflow function.
 *
 * Triggered by the "feature.validation.start" event, this function runs
 * the complete feature validation pipeline:
 * 1. Gather context (may ask clarifying questions)
 * 2. Analyze feature across multiple dimensions
 * 3. Generate comprehensive report
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
