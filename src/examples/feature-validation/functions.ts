/**
 * Inngest Functions for Feature Validation
 *
 * This file defines Inngest functions that expose the feature validation
 * pipeline as event-triggered workflows.
 *
 * @module feature-validation/functions
 */

import { inngest } from "../../inngest/client";
import { featureValidationPipeline } from "./agents";
import type { FeatureValidationResult } from "./schemas";

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
