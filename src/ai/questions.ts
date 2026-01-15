import type { StepTools, AskUserExtendedOptions, AskUserResult } from "./types";

// Re-export types for backwards compatibility
export type { AskUserExtendedOptions, AskUserResult } from "./types";

/**
 * Helper function to ask user questions and wait for answers.
 * This wraps the step.waitForEvent pattern in a simple API.
 *
 * ## How it works
 *
 * 1. If `onQuestionsReady` callback is provided, it's called first to notify
 *    your UI that questions need to be displayed
 * 2. The function then waits for an Inngest event with the user's answers
 * 3. Once the event is received (or timeout occurs), answers are returned
 *
 * ## Important: Deterministic stepId
 *
 * The `stepId` MUST be a stable, deterministic string. Inngest functions are
 * durable and replay from the beginning when resuming. If the stepId changes
 * between replays, Inngest cannot match completed steps with their results,
 * causing the function to hang indefinitely.
 *
 * **Good stepId examples:**
 * - `"gather-context-wait-for-answers"`
 * - `"validate-input-questions"`
 * - `` `${agentName}-user-questions` ``
 *
 * **Bad stepId examples (will break replay):**
 * - `` `step-${Math.random()}` `` - Different on each replay!
 * - `` `step-${Date.now()}` `` - Different on each replay!
 *
 * ## Event Format
 *
 * The function waits for an event with this structure:
 * ```typescript
 * {
 *   name: "user.answers.provided", // or custom eventName
 *   data: {
 *     sessionId: "session-123",
 *     answers: {
 *       "What is the target audience?": "Enterprise customers",
 *       "What problem does this solve?": "Data integration"
 *     }
 *   }
 * }
 * ```
 *
 * @param step - Inngest step tools
 * @param options - Configuration for the question/answer flow
 * @returns Promise resolving to the user's answers
 *
 * @example
 * ```typescript
 * // Basic usage
 * const answers = await askUser(step, {
 *   questions: ["What is the target audience?", "What problem does this solve?"],
 *   sessionId: "session-123",
 *   stepId: "my-agent-wait-for-answers",
 *   timeout: "1h",
 * });
 *
 * console.log(answers["What is the target audience?"]);
 * ```
 *
 * @example
 * ```typescript
 * // With UI notification callback
 * const answers = await askUser(step, {
 *   questions: ["What is your budget?", "What's the timeline?"],
 *   sessionId: "session-123",
 *   stepId: "budget-questions",
 *   onQuestionsReady: async (questions, sessionId) => {
 *     // Notify your UI to display questions
 *     await sendWebSocketMessage(sessionId, {
 *       type: "show_questions",
 *       questions,
 *     });
 *   },
 * });
 * ```
 */
export async function askUser(
  step: StepTools,
  options: AskUserExtendedOptions,
): Promise<Record<string, string>> {
  const {
    questions,
    sessionId,
    stepId,
    timeout = "1h",
    eventName = "user.answers.provided",
    onQuestionsReady,
    requireAllAnswers = false,
  } = options;

  // Notify UI that questions are ready (if callback provided)
  if (onQuestionsReady) {
    await step.run(`${stepId}-notify-questions`, async () => {
      await onQuestionsReady(questions, sessionId);
    });
  }

  // Wait for user answers event
  // Filter by sessionId only - the question key check was causing issues with CEL syntax
  console.log(`[askUser] Waiting for event "${eventName}" with sessionId="${sessionId}", stepId="${stepId}"`);
  const answersEvent = await step.waitForEvent(stepId, {
    event: eventName,
    timeout,
    if: `event.data.sessionId == "${sessionId}"`,
  });
  console.log(`[askUser] Received event:`, JSON.stringify(answersEvent?.data || null));

  // Extract answers from event, defaulting to empty object
  const rawAnswers = answersEvent?.data?.answers || {};

  // Build answers object ensuring all questions have entries
  const answers: Record<string, string> = {};
  for (const question of questions) {
    answers[question] = rawAnswers[question] ?? "";
  }

  // Validate all answers if required
  if (requireAllAnswers) {
    const unanswered = questions.filter(
      (q) => !answers[q] || answers[q].trim() === "",
    );
    if (unanswered.length > 0) {
      throw new Error(
        `Missing answers for questions: ${unanswered.map((q) => `"${q}"`).join(", ")}`,
      );
    }
  }

  return answers;
}

/**
 * Ask user questions and return detailed result with metadata.
 * This is an extended version of `askUser` that provides more information
 * about which questions were answered.
 *
 * @param step - Inngest step tools
 * @param options - Configuration for the question/answer flow
 * @returns Promise resolving to detailed result with answers and metadata
 *
 * @example
 * ```typescript
 * const result = await askUserWithMetadata(step, {
 *   questions: ["Question 1?", "Question 2?", "Question 3?"],
 *   sessionId: "session-123",
 *   stepId: "my-questions",
 * });
 *
 * if (!result.complete) {
 *   console.log("Unanswered questions:", result.unanswered);
 * }
 *
 * // Access answers
 * for (const [question, answer] of Object.entries(result.answers)) {
 *   console.log(`${question} -> ${answer}`);
 * }
 * ```
 */
export async function askUserWithMetadata(
  step: StepTools,
  options: AskUserExtendedOptions,
): Promise<AskUserResult> {
  const { questions } = options;

  // Get answers using the base function (without requireAllAnswers to get partial results)
  const answers = await askUser(step, {
    ...options,
    requireAllAnswers: false,
  });

  // Determine which questions weren't answered
  const unanswered = questions.filter(
    (q) => !answers[q] || answers[q].trim() === "",
  );

  return {
    answers,
    complete: unanswered.length === 0,
    unanswered,
    questions,
  };
}

/**
 * Create a formatted context string from question/answer pairs.
 * Useful for including user answers in subsequent prompts.
 *
 * @param answers - The answers object from askUser
 * @param options - Formatting options
 * @returns Formatted string with Q&A pairs
 *
 * @example
 * ```typescript
 * const answers = await askUser(step, { ... });
 * const context = formatAnswersAsContext(answers);
 * // Returns:
 * // "Q: What is the target audience?
 * // A: Enterprise customers
 * //
 * // Q: What problem does this solve?
 * // A: Data integration"
 *
 * // Use in next prompt
 * const prompt = {
 *   messages: [...],
 *   variables: { userContext: context },
 * };
 * ```
 */
export function formatAnswersAsContext(
  answers: Record<string, string>,
  options: {
    /**
     * Prefix for questions. @default "Q: "
     */
    questionPrefix?: string;
    /**
     * Prefix for answers. @default "A: "
     */
    answerPrefix?: string;
    /**
     * Separator between Q&A pairs. @default "\n\n"
     */
    separator?: string;
    /**
     * If true, skip questions with empty answers. @default true
     */
    skipEmpty?: boolean;
  } = {},
): string {
  const {
    questionPrefix = "Q: ",
    answerPrefix = "A: ",
    separator = "\n\n",
    skipEmpty = true,
  } = options;

  const pairs: string[] = [];

  for (const [question, answer] of Object.entries(answers)) {
    if (skipEmpty && (!answer || answer.trim() === "")) {
      continue;
    }
    pairs.push(`${questionPrefix}${question}\n${answerPrefix}${answer}`);
  }

  return pairs.join(separator);
}

/**
 * Validate that a stepId is likely deterministic.
 * This is a heuristic check that warns about common mistakes.
 *
 * @param stepId - The stepId to validate
 * @returns Object with valid flag and warning message if invalid
 *
 * @example
 * ```typescript
 * const check = validateStepId(stepId);
 * if (!check.valid) {
 *   console.warn(check.warning);
 * }
 * ```
 */
export function validateStepId(stepId: string): {
  valid: boolean;
  warning?: string;
} {
  // Check for common non-deterministic patterns
  const suspiciousPatterns = [
    {
      pattern: /\d{13,}/,
      reason: "contains timestamp-like number (13+ digits)",
    },
    {
      pattern: /[a-f0-9]{8,}$/i,
      reason: "ends with hex string (possible random ID)",
    },
    {
      pattern: /random|uuid|unique/i,
      reason: "contains 'random', 'uuid', or 'unique'",
    },
  ];

  for (const { pattern, reason } of suspiciousPatterns) {
    if (pattern.test(stepId)) {
      return {
        valid: false,
        warning:
          `stepId "${stepId}" may not be deterministic: ${reason}. ` +
          `This could cause issues with Inngest replay. Use a stable, predictable ID.`,
      };
    }
  }

  // Check for empty or whitespace-only
  if (!stepId || stepId.trim() === "") {
    return {
      valid: false,
      warning: "stepId cannot be empty",
    };
  }

  return { valid: true };
}
