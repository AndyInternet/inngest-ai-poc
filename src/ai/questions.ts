import type { StepTools, AskUserOptions } from "./types";

/**
 * Helper function to ask user questions and wait for answers.
 * This wraps the step.waitForEvent pattern in a simple API.
 *
 * IMPORTANT: The stepId must be deterministic. See AskUserOptions.stepId for details.
 *
 * @example
 * ```typescript
 * const answers = await askUser(step, {
 *   questions: ["What is the target audience?", "What problem does this solve?"],
 *   sessionId: "session-123",
 *   stepId: "my-agent-wait-for-answers", // Must be deterministic!
 *   timeout: "1h",
 *   eventName: "my.answers.event",
 * });
 * ```
 */
export async function askUser(
  step: StepTools,
  options: AskUserOptions,
): Promise<Record<string, string>> {
  const {
    questions,
    sessionId,
    stepId,
    timeout = "1h",
    eventName = "user.answers.provided",
  } = options;

  // Wait for user answers event
  const answersEvent = await step.waitForEvent(stepId, {
    event: eventName,
    timeout,
    if: `event.data.sessionId == "${sessionId}"`,
  });

  // Extract answers from event
  const answers = answersEvent?.data?.answers || {};

  return answers;
}
