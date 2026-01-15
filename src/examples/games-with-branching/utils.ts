/**
 * Utility Functions for Games with Branching
 *
 * @module games-with-branching/utils
 */

/**
 * Parse JSON from LLM response, handling markdown code blocks.
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

/**
 * Input types for user interaction.
 */
export type InputType =
  | { type: "none" }  // No input needed, just display message
  | { type: "text"; placeholder: string; questionKey: string }  // Free text input
  | { type: "boolean"; questionKey: string }  // True/False buttons
  | { type: "choice"; choices: string[]; questionKey: string };  // Multiple choice buttons

/**
 * Unified game message that controls what the user sees.
 */
export interface GameMessage {
  type: "game_message";
  /** The message to display to the user */
  content: string;
  /** What kind of input to show (if any) */
  input: InputType;
  /** Additional context data */
  data?: Record<string, unknown>;
  /** Loading indicator label to show while processing */
  loadingLabel?: string;
  /** Whether this is the final message (game over) */
  isGameOver?: boolean;
  timestamp: number;
}

/**
 * Broadcast a game message to the user.
 */
export async function broadcastToUser(
  sessionId: string,
  content: string,
  input: InputType = { type: "none" },
  options: {
    data?: Record<string, unknown>;
    loadingLabel?: string;
    isGameOver?: boolean;
  } = {},
): Promise<void> {
  const message: GameMessage = {
    type: "game_message",
    content,
    input,
    data: options.data,
    loadingLabel: options.loadingLabel,
    isGameOver: options.isGameOver,
    timestamp: Date.now(),
  };

  // Broadcast directly to WebSocket
  try {
    console.log(`[Broadcast] Importing index module...`);
    const module = await import("../../index");
    console.log(`[Broadcast] Module imported, broadcastToSession exists: ${!!module.broadcastToSession}`);
    if (module.broadcastToSession) {
      module.broadcastToSession(sessionId, message);
      console.log(`[Broadcast] Sent game_message to ${sessionId}:`, message.content.substring(0, 50));
    } else {
      console.error(`[Broadcast] broadcastToSession not found in module`);
    }
  } catch (err) {
    console.error(`[Broadcast] Failed to send to ${sessionId}:`, err);
  }
}

/**
 * Broadcast a loading state update.
 */
export async function broadcastLoading(
  sessionId: string,
  label: string,
): Promise<void> {
  const message = {
    type: "loading",
    label,
    timestamp: Date.now(),
  };

  try {
    const module = await import("../../index");
    if (module.broadcastToSession) {
      module.broadcastToSession(sessionId, message);
      console.log(`[Broadcast] Sent loading to ${sessionId}: ${label}`);
    } else {
      console.error(`[Broadcast] broadcastToSession not found for loading`);
    }
  } catch (err) {
    console.error(`[Broadcast] Failed to send loading to ${sessionId}:`, err);
  }
}
