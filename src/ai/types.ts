import type { GetStepTools } from "inngest";
import type { ZodType } from "zod";

// =============================================================================
// Core Types
// =============================================================================

/**
 * Inngest step tools type alias for use throughout the library.
 */
export type StepTools = GetStepTools<any>;

// =============================================================================
// LLM Provider Types
// =============================================================================

export type LLMMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCallResponse[];
  toolCallId?: string;
};

export type ToolCallResponse = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type FunctionDefinition = {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, any>;
    required: string[];
  };
};

export type LLMConfig = {
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
  tools?: FunctionDefinition[];
};

export type LLMResponse = {
  content: string;
  finishReason?: string;
  toolCalls?: ToolCallResponse[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
};

export type LLMStreamChunk = {
  content: string;
  finishReason?: string;
};

export interface LLMProvider {
  complete(messages: LLMMessage[], config: LLMConfig): Promise<LLMResponse>;
  stream(
    messages: LLMMessage[],
    config: LLMConfig,
  ): AsyncIterableIterator<LLMStreamChunk>;
}

export type ProviderType =
  | "openai"
  | "anthropic"
  | "gemini"
  | "grok"
  | "azure-openai";

export type ProviderConfig = {
  type: ProviderType;
  apiKey: string;
  baseUrl?: string;
  organizationId?: string;
};

// =============================================================================
// Prompt Types
// =============================================================================

export type PromptMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type Prompt = {
  messages: PromptMessage[];
  variables: Record<string, string>;
};

// =============================================================================
// Tool Types
// =============================================================================

export type ToolExecutionContext = {
  reportProgress: (message: string) => void | Promise<void>;
  agentName: string;
  iteration: number;
};

export type PreCallTool = {
  type: "pre-call";
  name: string;
  description: string;
  execute: () => Promise<Record<string, string>> | Record<string, string>;
};

export type PostCallToolParameter = {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required?: boolean;
};

export type PostCallTool = {
  type: "post-call";
  name: string;
  description: string;
  parameters: PostCallToolParameter[];
  execute: (
    args: Record<string, any>,
    context?: ToolExecutionContext,
  ) => Promise<any> | any;
};

export type Tool = PreCallTool | PostCallTool;

export type ToolCall = {
  name: string;
  arguments: Record<string, any>;
};

// =============================================================================
// Agent Types
// =============================================================================

export type StreamingConfig = {
  sessionId: string;
  onChunk?: (chunk: string, fullContent: string) => void | Promise<void>;
  onComplete?: (result: string) => void | Promise<void>;
  interval?: number; // Broadcast interval in ms (default: 50)
};

export type AgentMetadata = {
  workflowStep?: string;
  displayName?: string;
  icon?: string;
  description?: string;
};

/**
 * Context provided to lifecycle hooks
 */
export type AgentContext = {
  /** Name of the agent */
  name: string;
  /** Unique run ID for this execution */
  runId: string;
  /** Current iteration in the tool-calling loop */
  iteration: number;
  /** Agent metadata if provided */
  metadata?: AgentMetadata;
  /** Session ID for streaming */
  sessionId?: string;
};

/**
 * Metrics collected during agent execution
 */
export type AgentMetrics = {
  /** Total duration in milliseconds */
  totalDurationMs: number;
  /** Number of LLM calls made */
  llmCalls: number;
  /** Number of tool calls made */
  toolCalls: number;
  /** Duration of each tool call */
  toolDurations: Record<string, number>;
  /** Token counts if available */
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
};

/**
 * Lifecycle hooks for agent execution.
 * All hooks are optional and async.
 */
export type AgentHooks<TResult = unknown> = {
  /** Called when the agent starts execution */
  onStart?: (context: AgentContext) => void | Promise<void>;

  /** Called before each LLM call */
  onLLMStart?: (
    context: AgentContext,
    messages: LLMMessage[],
  ) => void | Promise<void>;

  /** Called after each LLM call completes */
  onLLMEnd?: (
    context: AgentContext,
    response: { content: string; hasToolCalls: boolean },
  ) => void | Promise<void>;

  /** Called before a tool is executed */
  onToolStart?: (
    context: AgentContext,
    tool: string,
    args: Record<string, unknown>,
  ) => void | Promise<void>;

  /** Called after a tool completes */
  onToolEnd?: (
    context: AgentContext,
    tool: string,
    result: unknown,
    durationMs: number,
  ) => void | Promise<void>;

  /** Called if a tool throws an error */
  onToolError?: (
    context: AgentContext,
    tool: string,
    error: Error,
  ) => void | Promise<void>;

  /** Called when the agent completes successfully */
  onComplete?: (
    context: AgentContext,
    result: TResult,
    metrics: AgentMetrics,
  ) => void | Promise<void>;

  /** Called if the agent throws an error */
  onError?: (context: AgentContext, error: Error) => void | Promise<void>;
};

// =============================================================================
// Questions/Human-in-the-Loop Types
// =============================================================================

export type AskUserOptions = {
  questions: string[];
  sessionId: string;
  /**
   * REQUIRED: A deterministic, unique identifier for this wait step.
   *
   * IMPORTANT: This MUST be a stable, deterministic string - never use Math.random()
   * or Date.now() to generate this value. Inngest functions are durable and replay
   * from the beginning when resuming. If the stepId changes between replays,
   * Inngest cannot match completed steps with their results, causing the function
   * to hang indefinitely.
   *
   * Good examples:
   *   - "gather-context-wait-for-answers"
   *   - "validate-input-questions"
   *   - `${agentName}-user-questions`
   *
   * Bad examples (will break replay):
   *   - `step-${Math.random()}` // Different on each replay!
   *   - `step-${Date.now()}` // Different on each replay!
   */
  stepId: string;
  timeout?: string; // e.g., "1h", "30m"
  eventName?: string; // Custom event name, defaults to "user.answers.provided"
};

// =============================================================================
// Flow/Pipeline Types
// =============================================================================

/**
 * Agent definition for use in pipelines.
 * Wraps an agent function with metadata for orchestration.
 */
export type AgentDefinition<TInput = any, TOutput = any> = {
  name: string;
  description?: string;
  /**
   * The agent function to execute.
   * Receives step tools, input data, and optional sessionId.
   */
  run: (step: StepTools, input: TInput, sessionId?: string) => Promise<TOutput>;
  /**
   * Optional schema for validating input to this agent.
   */
  inputSchema?: ZodType<TInput>;
  /**
   * Optional schema for validating output from this agent.
   */
  outputSchema?: ZodType<TOutput>;
  /**
   * Optional function to transform the previous agent's output
   * into this agent's input format.
   */
  mapInput?: (previousOutput: any, context: PipelineContext) => TInput;
};

/**
 * Context passed through the pipeline, accumulating results from each agent.
 */
export type PipelineContext = {
  /** Original input to the pipeline */
  initialInput: any;
  /** Results from each agent, keyed by agent name */
  results: Record<string, any>;
  /** Session ID for streaming */
  sessionId?: string;
};

/**
 * Configuration for creating an agent pipeline.
 */
export type PipelineConfig = {
  /** Name of the pipeline for logging/debugging */
  name: string;
  /** Description of what this pipeline does */
  description?: string;
};

/**
 * An executable pipeline of agents.
 */
export type AgentPipeline<TInput, TOutput> = {
  /** Pipeline configuration */
  config: PipelineConfig;
  /** Ordered list of agents in the pipeline */
  agents: AgentDefinition[];
  /**
   * Execute the pipeline with the given input.
   * Each agent runs in sequence, with results passed to the next agent.
   */
  run: (step: StepTools, input: TInput, sessionId?: string) => Promise<TOutput>;
};

export type FlowTransition =
  | {
      type: "linear";
      to: string;
    }
  | {
      type: "branch";
      to: string[];
    }
  | {
      type: "conditional";
      branches: Array<{
        condition: (result: any) => boolean;
        to: string;
      }>;
      default?: string;
    };
