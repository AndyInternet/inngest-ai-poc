/**
 * Utility Functions for Feature Validation
 *
 * This file contains shared utility functions used by the feature
 * validation agents.
 *
 * @module feature-validation/utils
 */

import type { AgentMetadata } from "../../ai/types";
import {
  globalStreamingManager,
  createQuestionsMessage,
} from "../../ai/streaming";

// ============================================================================
// JSON Parsing
// ============================================================================

/**
 * Parse JSON from LLM response, handling markdown code blocks.
 *
 * LLMs often wrap JSON in markdown code blocks. This function
 * handles that and provides helpful error messages on failure.
 */
export function parseJsonResponse<T>(response: string): T {
  let cleanResponse = response.trim();

  // Strip markdown code blocks
  if (cleanResponse.startsWith("```json")) {
    cleanResponse = cleanResponse.replace(/^```json\s*\n?/, "");
  }
  if (cleanResponse.startsWith("```")) {
    cleanResponse = cleanResponse.replace(/^```\s*\n?/, "");
  }
  if (cleanResponse.endsWith("```")) {
    cleanResponse = cleanResponse.replace(/\n?```\s*$/, "");
  }

  // Try direct parse
  try {
    return JSON.parse(cleanResponse);
  } catch {
    // Try to extract JSON from response
    const jsonMatch = cleanResponse.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch {
        // Fall through to error
      }
    }
    throw new Error(
      `Failed to parse JSON from response. Content: ${cleanResponse.substring(0, 200)}...`,
    );
  }
}

// ============================================================================
// Streaming
// ============================================================================

/**
 * Broadcast a questions message to the streaming session.
 *
 * Sends a questions message to the UI for human-in-the-loop interactions.
 * The UI listens for messages with type="questions" to display
 * question prompts to the user.
 */
export function broadcastQuestionsToSession(
  sessionId: string,
  questions: string[],
  agentName: string,
  metadata?: AgentMetadata,
): void {
  globalStreamingManager.addMessage(
    sessionId,
    createQuestionsMessage(
      agentName,
      questions,
      "The AI needs more information to continue.",
      metadata,
    ),
  );
}
