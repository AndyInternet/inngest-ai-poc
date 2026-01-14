import { inngest } from "../../src/inngest/client";
import {
  gatherContextAgent,
  analyzeFeatureAgent,
  generateReportAgent,
} from "./agents";
import {
  executeTransition,
  conditionalTransition,
  linearTransition,
} from "../../src/ai/flow";

// Step 1: Gather context - determines if we have enough information
export const gatherContextFunction = inngest.createFunction(
  { id: "feature-validation-gather-context" },
  { event: "feature.validation.start" },
  async ({ event, step, publish }) => {
    const { featureDescription, existingContext = "", sessionId } = event.data;

    const result = await gatherContextAgent(
      step,
      featureDescription,
      existingContext,
      publish,
      sessionId,
    );

    // If questions are needed, send them via WebSocket
    if (
      result.hasEnoughContext === false &&
      result.questions &&
      result.questions.length > 0
    ) {
      // Stream questions message to UI via WebSocket
      if (sessionId) {
        await step.run("send-questions-to-ui", async () => {
          const { streamingMessages } = await import("../../src/ai/agent");
          const messageWithTimestamp = {
            data: {
              type: "questions",
              content:
                "The AI needs more information to properly validate your feature.",
              questions: result.questions,
              agentName: "gather-context",
            },
            timestamp: Date.now(),
          };

          if (!streamingMessages.has(sessionId)) {
            streamingMessages.set(sessionId, []);
          }
          streamingMessages.get(sessionId)!.push(messageWithTimestamp);

          // Broadcast via WebSocket
          const { broadcastToSession } = await import("../../src/index");
          broadcastToSession(sessionId, messageWithTimestamp);
        });
      }
    }

    // Store state for potential follow-up
    await step.run("store-context-state", async () => {
      return {
        featureDescription,
        existingContext,
        contextResult: result,
      };
    });

    // Conditional transition based on whether we have enough context
    const transition = conditionalTransition(
      [
        {
          condition: (r) =>
            r.hasEnoughContext === false &&
            r.questions &&
            r.questions.length > 0,
          to: "feature.validation.ask.questions",
        },
      ],
      "feature.validation.analyze",
    );

    // Check if we need to ask questions
    if (
      result.hasEnoughContext === false &&
      result.questions &&
      result.questions.length > 0
    ) {
      // Wait for user answers - this pauses the workflow
      const answersEvent = await step.waitForEvent("wait-for-answers", {
        event: "feature.validation.answers.provided",
        timeout: "1h", // Wait up to 1 hour for answers
        if: `async.data.sessionId == "${sessionId}"`,
      });

      if (answersEvent) {
        // Re-run gather context with updated context instead of recursing
        const updatedContext = [
          existingContext,
          ...Object.entries(answersEvent.data.answers || {}).map(
            ([q, a]) => `Q: ${q}\nA: ${a}`,
          ),
        ]
          .filter(Boolean)
          .join("\n\n");

        // Re-run context gathering with answers
        const updatedResult = await gatherContextAgent(
          step,
          featureDescription,
          updatedContext,
          publish,
          sessionId,
        );

        // Now proceed to analysis with updated result
        const functionRefs = new Map([
          ["feature.validation.analyze", analyzeFeatureFunction],
        ]);

        await executeTransition(
          step,
          linearTransition("feature.validation.analyze"),
          {
            ...updatedResult,
            featureDescription,
            existingContext: updatedContext,
            sessionId,
          },
          functionRefs,
        );
      }
    } else {
      // Execute the transition directly to analysis
      const functionRefs = new Map([
        ["feature.validation.analyze", analyzeFeatureFunction],
      ]);

      await executeTransition(
        step,
        transition,
        {
          ...result,
          featureDescription,
          existingContext,
          sessionId,
        },
        functionRefs,
      );
    }

    return result;
  },
);

// Step 2: Analyze the feature
export const analyzeFeatureFunction = inngest.createFunction(
  { id: "feature-validation-analyze" },
  { event: "feature.validation.analyze" },
  async ({ event, step, publish }) => {
    const { featureDescription, existingContext, sessionId } = event.data;

    const analysis = await analyzeFeatureAgent(
      step,
      featureDescription,
      existingContext || "",
      publish,
      sessionId,
    );

    // Linear transition to report generation
    const transition = linearTransition("feature.validation.report");

    const functionRefs = new Map([
      ["feature.validation.report", generateReportFunction],
    ]);

    const report = await executeTransition(
      step,
      transition,
      {
        featureDescription,
        analysisResult: analysis,
        sessionId,
      },
      functionRefs,
    );

    return { analysis, report };
  },
);

// Step 3: Generate final report
export const generateReportFunction = inngest.createFunction(
  { id: "feature-validation-report" },
  { event: "feature.validation.report" },
  async ({ event, step, publish }) => {
    const { analysisResult, featureDescription, sessionId } = event.data;

    const report = await generateReportAgent(
      step,
      analysisResult,
      publish,
      sessionId,
    );

    // Final step - no transitions
    return {
      featureDescription,
      analysis: analysisResult,
      report,
      completedAt: new Date().toISOString(),
    };
  },
);

// Export all functions for registration
export const featureValidationFunctions = [
  gatherContextFunction,
  analyzeFeatureFunction,
  generateReportFunction,
];
