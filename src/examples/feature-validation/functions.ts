import { inngest } from "../../inngest/client";
import { featureValidationPipeline } from "./agents";

/**
 * Feature validation using the pipeline API.
 * Runs all three agents (gather-context, analyze-feature, generate-report)
 * in sequence with automatic context passing.
 *
 * @example
 * Send event: { name: "feature.validation.start", data: { featureDescription, sessionId } }
 */
export const featureValidationFunction = inngest.createFunction(
  { id: "feature-validation" },
  { event: "feature.validation.start" },
  async ({ event, step }) => {
    const { featureDescription, existingContext = "", sessionId } = event.data;

    // Run the entire pipeline with a single call
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

// Export all functions for registration
export const featureValidationFunctions = [featureValidationFunction];
