/**
 * Zod Schemas for the Feature Validation Pipeline
 *
 * This file defines all input and output schemas used by the feature
 * validation agents. Using Zod provides:
 * - Runtime type validation
 * - Automatic TypeScript type inference
 * - Clear documentation of data structures
 *
 * @module feature-validation/schemas
 */

import { z } from "zod";

// ============================================================================
// Input Schemas
// ============================================================================

/**
 * Input schema for the evaluate-context agent.
 */
export const EvaluateContextInputSchema = z.object({
  featureDescription: z.string().min(1).describe("The feature to be validated"),
  existingContext: z
    .string()
    .describe("Any existing context about the feature"),
});

export type EvaluateContextInput = z.infer<typeof EvaluateContextInputSchema>;

/**
 * Input schema for the ask-questions agent.
 */
export const AskQuestionsInputSchema = z.object({
  featureDescription: z.string().min(1).describe("The feature to be validated"),
  existingContext: z
    .string()
    .describe("Any existing context about the feature"),
  questions: z.array(z.string()).describe("Questions to ask the user"),
});

export type AskQuestionsInput = z.infer<typeof AskQuestionsInputSchema>;

/**
 * Input schema for the analyze-feature agent.
 */
export const AnalyzeFeatureInputSchema = z.object({
  featureDescription: z.string().min(1).describe("The feature to be analyzed"),
  context: z.string().describe("Context gathered from the previous agents"),
});

export type AnalyzeFeatureInput = z.infer<typeof AnalyzeFeatureInputSchema>;

/**
 * Input schema for the generate-report agent.
 * Uses a lazy reference to AnalyzeFeatureResultSchema to avoid circular dependency.
 */
export const GenerateReportInputSchema = z.object({
  analysisResult: z.lazy(() => AnalyzeFeatureResultSchema),
});

export type GenerateReportInput = z.infer<typeof GenerateReportInputSchema>;

/**
 * Input schema for the entire feature validation pipeline.
 */
export const FeatureValidationInputSchema = z.object({
  featureDescription: z.string().min(1).describe("The feature to be validated"),
  existingContext: z
    .string()
    .default("")
    .describe("Any existing context about the product or company"),
});

export type FeatureValidationInput = z.infer<
  typeof FeatureValidationInputSchema
>;

// ============================================================================
// Output Schemas
// ============================================================================

/**
 * Schema for the evaluate-context agent result.
 *
 * This agent determines if there's enough context to evaluate a feature
 * and generates questions if more information is needed.
 */
export const EvaluateContextResultSchema = z.object({
  reasoning: z
    .string()
    .describe("Chain-of-thought analysis of available context"),
  hasEnoughContext: z
    .boolean()
    .describe("Whether enough context exists to proceed"),
  questions: z
    .array(z.string())
    .nullish()
    .describe("Questions to ask if more context is needed"),
  contextSummary: z
    .string()
    .nullish()
    .describe("Brief summary of the context gathered"),
});

export type EvaluateContextResult = z.infer<typeof EvaluateContextResultSchema>;

/**
 * Schema for the ask-questions agent result.
 *
 * This agent handles human-in-the-loop questioning and returns
 * the enriched context with user answers.
 */
export const AskQuestionsResultSchema = z.object({
  enrichedContext: z
    .string()
    .describe("The context enriched with user answers"),
  answersReceived: z
    .number()
    .int()
    .describe("Number of answers received from the user"),
});

export type AskQuestionsResult = z.infer<typeof AskQuestionsResultSchema>;

/**
 * Schema for the analyze-feature agent result.
 *
 * This agent evaluates a feature across multiple dimensions and provides
 * a recommendation with scores.
 */
export const AnalyzeFeatureResultSchema = z.object({
  reasoning: z.string().describe("Detailed chain-of-thought analysis"),
  recommendation: z
    .enum(["yes", "no", "conditional"])
    .describe("Whether the feature should be built (yes, no, or conditional)"),
  impactScore: z
    .number()
    .int()
    .min(1)
    .max(10)
    .describe("Impact score from 1-10"),
  valueScore: z
    .number()
    .int()
    .min(1)
    .max(10)
    .describe("Value to users score from 1-10"),
  strategicAlignmentScore: z
    .number()
    .int()
    .min(1)
    .max(10)
    .describe("Strategic alignment score from 1-10"),
  developmentCostScore: z
    .number()
    .int()
    .min(1)
    .max(10)
    .describe("Development cost score from 1-10 (higher = more expensive)"),
  overallScore: z
    .number()
    .int()
    .min(1)
    .max(10)
    .describe("Overall recommendation score from 1-10"),
  pros: z.array(z.string()).describe("List of pros/benefits"),
  cons: z.array(z.string()).describe("List of cons/drawbacks"),
  summary: z.string().describe("Brief summary of the recommendation"),
});

export type AnalyzeFeatureResult = z.infer<typeof AnalyzeFeatureResultSchema>;

/**
 * Schema for the generate-report agent result.
 *
 * This agent produces a markdown-formatted report summarizing the analysis.
 */
export const GenerateReportResultSchema = z
  .string()
  .min(1)
  .describe("Markdown formatted validation report");

export type GenerateReportResult = z.infer<typeof GenerateReportResultSchema>;

// ============================================================================
// Pipeline Result Schema
// ============================================================================

/**
 * Complete result from the feature validation pipeline.
 * Includes the final report and metadata about the validation process.
 */
export const FeatureValidationResultSchema = z.object({
  featureDescription: z.string(),
  report: GenerateReportResultSchema,
  completedAt: z.string().datetime(),
});

export type FeatureValidationResult = z.infer<
  typeof FeatureValidationResultSchema
>;
