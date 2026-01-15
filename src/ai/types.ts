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

/**
 * A prompt template with messages and variables for hydration.
 *
 * Variables are substituted into message content using Mustache syntax ({{variableName}}).
 * Values are coerced to strings during hydration - objects will be JSON.stringify'd.
 */
export type Prompt = {
  messages: PromptMessage[];
  /**
   * Variables to substitute into the prompt messages.
   * Accepts any JSON-serializable value - objects and arrays will be stringified.
   */
  variables: Record<string, unknown>;
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
// Pipeline Types
// =============================================================================

/**
 * Agent definition for use in pipelines.
 * Wraps an agent function with metadata for orchestration.
 *
 * @typeParam TInput - The input type this agent expects
 * @typeParam TOutput - The output type this agent produces
 * @typeParam TPreviousOutput - The output type from the previous agent (for mapInput)
 * @typeParam TPipelineInput - The initial input type to the pipeline
 * @typeParam TPipelineResults - Record of all previous agent results in the pipeline
 */
export type AgentDefinition<
  TInput = unknown,
  TOutput = unknown,
  TPreviousOutput = unknown,
  TPipelineInput = unknown,
  TPipelineResults extends Record<string, unknown> = Record<string, unknown>,
> = {
  /** Unique name for this agent within the pipeline */
  name: string;
  /** Human-readable description of what this agent does */
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
   *
   * @param previousOutput - The output from the previous agent in the pipeline
   * @param context - Pipeline context with initial input and all previous results
   * @returns The input for this agent
   */
  mapInput?: (
    previousOutput: TPreviousOutput,
    context: PipelineContext<TPipelineInput, TPipelineResults>,
  ) => TInput;
};

/**
 * Context passed through the pipeline, accumulating results from each agent.
 *
 * @typeParam TInput - The type of the initial input to the pipeline
 * @typeParam TResults - A record type mapping agent names to their output types
 */
export type PipelineContext<
  TInput = unknown,
  TResults extends Record<string, unknown> = Record<string, unknown>,
> = {
  /** Original input to the pipeline */
  initialInput: TInput;
  /** Results from each agent, keyed by agent name */
  results: TResults;
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
 *
 * @typeParam TInput - The input type for the pipeline (first agent's input)
 * @typeParam TOutput - The output type from the pipeline (last agent's output)
 */
export type AgentPipeline<TInput, TOutput> = {
  /** Pipeline configuration */
  config: PipelineConfig;
  /**
   * Ordered list of agents in the pipeline.
   * Each agent can have its own input/output types - the pipeline handles
   * type transformations via each agent's mapInput function.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agents: readonly AgentDefinition<any, any, any, TInput, any>[];
  /**
   * Execute the pipeline with the given input.
   * Each agent runs in sequence, with results passed to the next agent.
   */
  run: (step: StepTools, input: TInput, sessionId?: string) => Promise<TOutput>;
};

/**
 * Defines how to transition between agents/functions in a pipeline.
 *
 * @typeParam TResult - The type of result passed to conditional branch functions
 */
export type PipelineTransition<TResult = unknown> =
  | {
      type: "linear";
      /** The target agent/function name to transition to */
      to: string;
    }
  | {
      type: "branch";
      /** Array of target agent/function names to transition to in parallel */
      to: string[];
    }
  | {
      type: "conditional";
      /** Branches evaluated in order - first matching condition wins */
      branches: Array<{
        /** Predicate function to determine if this branch should be taken */
        condition: (result: TResult) => boolean;
        /** The target agent/function name if condition returns true */
        to: string;
      }>;
      /** Default target if no conditions match */
      default?: string;
    };
