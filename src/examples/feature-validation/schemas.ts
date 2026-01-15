import { z } from "zod";

// ============================================================================
// Input Schemas - Define what each agent expects as input
// ============================================================================

/**
 * Input schema for the gather-context agent.
 */
export const GatherContextInputSchema = z.object({
  featureDescription: z.string().describe("The feature to be validated"),
  existingContext: z
    .string()
    .describe("Any existing context about the feature"),
});

export type GatherContextInput = z.infer<typeof GatherContextInputSchema>;

/**
 * Input schema for the analyze-feature agent.
 */
export const AnalyzeFeatureInputSchema = z.object({
  featureDescription: z.string().describe("The feature to be analyzed"),
  context: z.string().describe("Context gathered from the previous agent"),
});

export type AnalyzeFeatureInput = z.infer<typeof AnalyzeFeatureInputSchema>;

/**
 * Input schema for the generate-report agent.
 */
export const GenerateReportInputSchema = z.object({
  analysisResult: z
    .any()
    .describe("The analysis result from the previous agent"),
});

export type GenerateReportInput = z.infer<typeof GenerateReportInputSchema>;

/**
 * Input schema for the entire feature validation pipeline.
 */
export const FeatureValidationInputSchema = z.object({
  featureDescription: z.string().describe("The feature to be validated"),
  existingContext: z.string().describe("Any existing context"),
});

export type FeatureValidationInput = z.infer<
  typeof FeatureValidationInputSchema
>;

// ============================================================================
// Output Schemas - Define what each agent returns
// ============================================================================

/**
 * Schema for the gather-context agent result.
 * This agent determines if there's enough context to evaluate a feature,
 * and generates questions if more information is needed.
 */
export const GatherContextResultSchema = z.object({
  reasoning: z
    .string()
    .describe("Chain-of-thought analysis of available context"),
  hasEnoughContext: z
    .boolean()
    .describe("Whether enough context exists to proceed"),
  questions: z
    .array(z.string())
    .optional()
    .describe("Questions to ask if more context is needed"),
});

export type GatherContextResult = z.infer<typeof GatherContextResultSchema>;

/**
 * Schema for the analyze-feature agent result.
 * This agent evaluates a feature across multiple dimensions and provides
 * a recommendation with scores.
 */
export const AnalyzeFeatureResultSchema = z.object({
  reasoning: z.string().describe("Detailed chain-of-thought analysis"),
  recommendation: z
    .enum(["yes", "no"])
    .describe("Whether the feature should be built"),
  impactScore: z.number().min(1).max(10).describe("Impact score from 1-10"),
  valueScore: z
    .number()
    .min(1)
    .max(10)
    .describe("Value to users score from 1-10"),
  strategicAlignmentScore: z
    .number()
    .min(1)
    .max(10)
    .describe("Strategic alignment score from 1-10"),
  developmentCostScore: z
    .number()
    .min(1)
    .max(10)
    .describe("Development cost score from 1-10 (higher = more expensive)"),
  overallScore: z
    .number()
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
 * This agent produces a markdown report, so it's just a string.
 */
export const GenerateReportResultSchema = z
  .string()
  .describe("Markdown formatted report");

export type GenerateReportResult = z.infer<typeof GenerateReportResultSchema>;
