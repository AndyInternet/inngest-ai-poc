import type { AgentMetadata } from "./types";

/**
 * Types for streaming messages sent during agent execution.
 */

/** Base type for all streaming messages */
export type StreamMessageBase = {
  timestamp: number;
};

/** LLM response streaming message */
export type LLMResponseMessage = StreamMessageBase & {
  type: "llm_response";
  content: string;
  agentName: string;
  iteration: number;
  streaming: boolean;
  hasToolCalls?: boolean;
  metadata?: AgentMetadata;
};

/** Final response message when agent completes */
export type FinalResponseMessage = StreamMessageBase & {
  type: "final_response";
  content: string;
  agentName: string;
  iteration: number;
  completed: boolean;
  metadata?: AgentMetadata;
};

/** Tool execution start message */
export type ToolStartMessage = StreamMessageBase & {
  type: "tool_start";
  toolName: string;
  agentName: string;
  iteration: number;
  args: Record<string, unknown>;
};

/** Tool execution progress message */
export type ToolProgressMessage = StreamMessageBase & {
  type: "tool_progress";
  toolName: string;
  agentName: string;
  iteration: number;
  message: string;
};

/** Tool execution result message */
export type ToolResultMessage = StreamMessageBase & {
  type: "tool_result";
  toolName: string;
  agentName: string;
  iteration: number;
  result: unknown;
  success: true;
};

/** Tool execution error message */
export type ToolErrorMessage = StreamMessageBase & {
  type: "tool_error";
  toolName: string;
  agentName: string;
  iteration: number;
  error: string;
  success: false;
};

/** Questions message for human-in-the-loop interactions */
export type QuestionsMessage = StreamMessageBase & {
  type: "questions";
  content: string;
  questions: string[];
  agentName: string;
  metadata?: AgentMetadata;
};

/** Union of all streaming message types */
export type StreamMessage =
  | LLMResponseMessage
  | FinalResponseMessage
  | ToolStartMessage
  | ToolProgressMessage
  | ToolResultMessage
  | ToolErrorMessage
  | QuestionsMessage;

/** Wrapper for messages with data property */
export type StreamMessageWrapper = {
  data: Omit<StreamMessage, "timestamp">;
};

/**
 * Broadcaster function type for sending messages to clients.
 */
export type StreamBroadcaster = (
  sessionId: string,
  message: StreamMessage,
) => void | Promise<void>;

/**
 * Manages streaming messages for agent execution.
 *
 * This class handles:
 * - Storing messages in memory for later retrieval
 * - Broadcasting messages to connected clients via an optional broadcaster
 * - Adding timestamps to all messages
 *
 * @example
 * ```typescript
 * const streaming = new StreamingManager();
 *
 * // Set up broadcaster for WebSocket
 * streaming.setBroadcaster((sessionId, message) => {
 *   wsServer.broadcast(sessionId, message);
 * });
 *
 * // Add a message
 * streaming.addMessage("session-123", {
 *   type: "llm_response",
 *   content: "Hello!",
 *   agentName: "assistant",
 *   iteration: 1,
 *   streaming: true,
 * });
 *
 * // Retrieve messages
 * const messages = streaming.getMessages("session-123");
 * ```
 */
export class StreamingManager {
  private messages = new Map<string, StreamMessage[]>();
  private broadcaster?: StreamBroadcaster;

  /**
   * Set the broadcaster function for sending messages to clients.
   *
   * @param fn - Function that receives sessionId and message to broadcast
   */
  setBroadcaster(fn: StreamBroadcaster): void {
    this.broadcaster = fn;
  }

  /**
   * Add a message to the store and optionally broadcast it.
   *
   * @param sessionId - Session identifier
   * @param message - Message to add (timestamp will be added automatically)
   */
  addMessage(
    sessionId: string,
    message: Omit<StreamMessage, "timestamp">,
  ): void {
    const messageWithTimestamp: StreamMessage = {
      ...message,
      timestamp: Date.now(),
    } as StreamMessage;

    // Store in memory
    if (!this.messages.has(sessionId)) {
      this.messages.set(sessionId, []);
    }
    this.messages.get(sessionId)!.push(messageWithTimestamp);

    // Broadcast if broadcaster is set
    if (this.broadcaster) {
      try {
        this.broadcaster(sessionId, messageWithTimestamp);
      } catch {
        // Ignore broadcast errors - messages are still stored
      }
    }
  }

  /**
   * Get all messages for a session.
   *
   * @param sessionId - Session identifier
   * @returns Array of messages for the session, or empty array if none
   */
  getMessages(sessionId: string): StreamMessage[] {
    return this.messages.get(sessionId) || [];
  }

  /**
   * Clear all messages for a session.
   *
   * @param sessionId - Session identifier
   */
  clearMessages(sessionId: string): void {
    this.messages.delete(sessionId);
  }

  /**
   * Check if a session has any messages.
   *
   * @param sessionId - Session identifier
   * @returns True if the session has messages
   */
  hasMessages(sessionId: string): boolean {
    return (
      this.messages.has(sessionId) && this.messages.get(sessionId)!.length > 0
    );
  }

  /**
   * Get the count of messages for a session.
   *
   * @param sessionId - Session identifier
   * @returns Number of messages for the session
   */
  getMessageCount(sessionId: string): number {
    return this.messages.get(sessionId)?.length || 0;
  }
}

/**
 * Global streaming manager instance.
 *
 * This singleton instance is used by the agent module for backward compatibility.
 * For new code, prefer creating your own StreamingManager instance.
 */
export const globalStreamingManager = new StreamingManager();

/**
 * Get all streaming messages for a session.
 *
 * @deprecated Use `globalStreamingManager.getMessages()` instead
 * @param sessionId - Session identifier
 * @returns Array of messages for the session
 */
export function getStreamingMessages(sessionId: string): StreamMessage[] {
  return globalStreamingManager.getMessages(sessionId);
}

/**
 * Helper to create an LLM response message.
 */
export function createLLMResponseMessage(
  agentName: string,
  content: string,
  iteration: number,
  options: {
    streaming?: boolean;
    hasToolCalls?: boolean;
    metadata?: AgentMetadata;
  } = {},
): Omit<LLMResponseMessage, "timestamp"> {
  return {
    type: "llm_response",
    content,
    agentName,
    iteration,
    streaming: options.streaming ?? false,
    hasToolCalls: options.hasToolCalls,
    metadata: options.metadata,
  };
}

/**
 * Helper to create a final response message.
 */
export function createFinalResponseMessage(
  agentName: string,
  content: string,
  iteration: number,
  metadata?: AgentMetadata,
): Omit<FinalResponseMessage, "timestamp"> {
  return {
    type: "final_response",
    content,
    agentName,
    iteration,
    completed: true,
    metadata,
  };
}

/**
 * Helper to create a tool start message.
 */
export function createToolStartMessage(
  toolName: string,
  agentName: string,
  iteration: number,
  args: Record<string, unknown>,
): Omit<ToolStartMessage, "timestamp"> {
  return {
    type: "tool_start",
    toolName,
    agentName,
    iteration,
    args,
  };
}

/**
 * Helper to create a tool progress message.
 */
export function createToolProgressMessage(
  toolName: string,
  agentName: string,
  iteration: number,
  message: string,
): Omit<ToolProgressMessage, "timestamp"> {
  return {
    type: "tool_progress",
    toolName,
    agentName,
    iteration,
    message,
  };
}

/**
 * Helper to create a tool result message.
 */
export function createToolResultMessage(
  toolName: string,
  agentName: string,
  iteration: number,
  result: unknown,
): Omit<ToolResultMessage, "timestamp"> {
  return {
    type: "tool_result",
    toolName,
    agentName,
    iteration,
    result,
    success: true,
  };
}

/**
 * Helper to create a tool error message.
 */
export function createToolErrorMessage(
  toolName: string,
  agentName: string,
  iteration: number,
  error: string,
): Omit<ToolErrorMessage, "timestamp"> {
  return {
    type: "tool_error",
    toolName,
    agentName,
    iteration,
    error,
    success: false,
  };
}

/**
 * Helper to create a questions message for human-in-the-loop interactions.
 */
export function createQuestionsMessage(
  agentName: string,
  questions: string[],
  content: string = "The AI needs more information to continue.",
  metadata?: AgentMetadata,
): Omit<QuestionsMessage, "timestamp"> {
  return {
    type: "questions",
    content,
    questions,
    agentName,
    metadata,
  };
}
