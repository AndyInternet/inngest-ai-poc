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
  /**
   * Optional predicate to determine if this agent should run.
   * If returns false, the agent is skipped and skipResult (or previous output) is used.
   *
   * @param previousOutput - Output from the previous agent
   * @param context - Current pipeline context
   * @returns True to run the agent, false to skip
   */
  shouldRun?: (
    previousOutput: TPreviousOutput,
    context: PipelineContext<TPipelineInput, TPipelineResults>,
  ) => boolean | Promise<boolean>;
  /**
   * Default result to use when the agent is skipped via shouldRun.
   * If not provided and agent is skipped, the previous output is passed through.
   */
  skipResult?: TOutput;
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
 * Error information passed to pipeline error handlers.
 */
export type PipelineError = {
  /** The error that was thrown */
  error: Error;
  /** Name of the agent that failed */
  agentName: string;
  /** Index of the agent in the pipeline */
  agentIndex: number;
  /** Input that was passed to the agent */
  input: unknown;
  /** Results from previous agents (before the failure) */
  previousResults: Record<string, unknown>;
};

/**
 * Result of error recovery, determining how the pipeline should proceed.
 */
export type ErrorRecoveryResult =
  | { action: "throw" } // Re-throw the error (default behavior)
  | { action: "skip"; result?: unknown } // Skip this agent, optionally provide a default result
  | { action: "retry"; maxRetries?: number } // Retry the agent (not yet implemented)
  | { action: "abort"; result: unknown }; // Abort pipeline and return this result

/**
 * Lifecycle hooks for pipeline execution.
 */
export type PipelineHooks<TInput = unknown, TOutput = unknown> = {
  /**
   * Called when the pipeline starts execution.
   */
  onPipelineStart?: (input: TInput, sessionId?: string) => void | Promise<void>;

  /**
   * Called before each agent runs.
   */
  onAgentStart?: (
    agentName: string,
    agentIndex: number,
    input: unknown,
    context: PipelineContext<TInput>,
  ) => void | Promise<void>;

  /**
   * Called after each agent completes successfully.
   */
  onAgentEnd?: (
    agentName: string,
    agentIndex: number,
    result: unknown,
    durationMs: number,
    context: PipelineContext<TInput>,
  ) => void | Promise<void>;

  /**
   * Called when an agent throws an error.
   * Return an ErrorRecoveryResult to control how the pipeline handles the error.
   * If not provided or returns undefined, the error is re-thrown.
   */
  onAgentError?: (
    error: PipelineError,
    context: PipelineContext<TInput>,
  ) =>
    | ErrorRecoveryResult
    | undefined
    | Promise<ErrorRecoveryResult | undefined>;

  /**
   * Called when the pipeline completes successfully.
   */
  onPipelineEnd?: (
    result: TOutput,
    totalDurationMs: number,
    context: PipelineContext<TInput>,
  ) => void | Promise<void>;

  /**
   * Called when the pipeline fails (after error recovery, if any).
   */
  onPipelineError?: (
    error: Error,
    context: PipelineContext<TInput>,
  ) => void | Promise<void>;
};

/**
 * Extended pipeline configuration with hooks.
 */
export type PipelineConfigWithHooks<
  TInput = unknown,
  TOutput = unknown,
> = PipelineConfig & {
  hooks?: PipelineHooks<TInput, TOutput>;
};

/**
 * Validation result for a pipeline configuration.
 */
export type PipelineValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
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

// =============================================================================
// Pipeline Branching Types
// =============================================================================

/**
 * A branch definition for conditional forking in pipelines.
 * Allows routing to different agent sequences based on previous output.
 *
 * @typeParam TBranchKey - String literal union of branch names
 * @typeParam TPreviousOutput - Output type from the previous step
 * @typeParam TBranchOutput - Output type produced by branches (union of all branch outputs)
 * @typeParam TPipelineInput - Initial pipeline input type
 * @typeParam TPipelineResults - Accumulated results type
 */
export type BranchDefinition<
  TBranchKey extends string = string,
  TPreviousOutput = unknown,
  TBranchOutput = unknown,
  TPipelineInput = unknown,
  TPipelineResults extends Record<string, unknown> = Record<string, unknown>,
> = {
  /** Marker to identify this as a branch definition */
  __type: "branch";
  /** Unique name for this branch point */
  name: string;
  /** Human-readable description */
  description?: string;
  /**
   * Function that determines which branch to execute.
   * Returns the key of the branch to run.
   *
   * @param previousOutput - Output from the previous agent/branch
   * @param context - Current pipeline context
   * @returns The branch key to execute
   */
  condition: (
    previousOutput: TPreviousOutput,
    context: PipelineContext<TPipelineInput, TPipelineResults>,
  ) => TBranchKey | Promise<TBranchKey>;
  /**
   * Map of branch keys to step sequences.
   * Each branch is an array of steps (agents or nested branches) that execute in sequence.
   * This allows for arbitrary nesting of branches within branches.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  branches: Record<TBranchKey, readonly PipelineStep<TPipelineInput>[]>;
  /**
   * Optional default branch if condition returns an unknown key.
   * If not provided and an unknown key is returned, an error is thrown.
   */
  defaultBranch?: TBranchKey;
  /**
   * Optional function to transform the previous output before passing to branches.
   * If not provided, the previous output is passed directly.
   */
  mapInput?: (
    previousOutput: TPreviousOutput,
    context: PipelineContext<TPipelineInput, TPipelineResults>,
  ) => unknown;
};

/**
 * Union type for pipeline steps - can be either an agent or a branch.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PipelineStep<TPipelineInput = unknown> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | AgentDefinition<any, any, any, TPipelineInput, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | BranchDefinition<any, any, any, TPipelineInput, any>;

/**
 * Type guard to check if a pipeline step is a branch definition.
 */
export function isBranchDefinition<TPipelineInput = unknown>(
  step: PipelineStep<TPipelineInput>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): step is BranchDefinition<any, any, any, TPipelineInput, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (step as any).__type === "branch";
}

/**
 * Type guard to check if a pipeline step is an agent definition.
 */
export function isAgentDefinition<TPipelineInput = unknown>(
  step: PipelineStep<TPipelineInput>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): step is AgentDefinition<any, any, any, TPipelineInput, any> {
  return !isBranchDefinition(step);
}

// =============================================================================
// Streaming Types
// =============================================================================

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

// =============================================================================
// Tool Validation Types
// =============================================================================

/**
 * Validation options for validateTools.
 */
export type ValidateToolsOptions = {
  /**
   * If true, throws an error when validation fails.
   * If false, returns validation result without throwing.
   * @default true
   */
  throwOnError?: boolean;
};

/**
 * Result of tool validation.
 */
export type ValidateToolsResult = {
  valid: boolean;
  errors: string[];
};

// =============================================================================
// Questions Types
// =============================================================================

/**
 * Extended options for askUser with callbacks.
 */
export type AskUserExtendedOptions = AskUserOptions & {
  /**
   * Callback invoked when questions are ready to be displayed to the user.
   * Use this to notify your UI layer that questions need to be shown.
   *
   * This is called BEFORE waiting for the answer event, allowing you to
   * trigger UI updates, send WebSocket messages, etc.
   *
   * @param questions - The array of questions to display
   * @param sessionId - The session ID for this interaction
   *
   * @example
   * ```typescript
   * onQuestionsReady: async (questions, sessionId) => {
   *   await broadcastToSession(sessionId, {
   *     type: "questions",
   *     questions,
   *   });
   * }
   * ```
   */
  onQuestionsReady?: (
    questions: string[],
    sessionId: string,
  ) => void | Promise<void>;

  /**
   * If true, validates that answers were provided for all questions.
   * Missing answers will be set to empty strings in the result.
   * @default false
   */
  requireAllAnswers?: boolean;
};

/**
 * Result from askUser with metadata about the answers.
 */
export type AskUserResult = {
  /**
   * The answers keyed by question text.
   * Questions without answers will have empty string values.
   */
  answers: Record<string, string>;

  /**
   * Whether all questions received answers.
   */
  complete: boolean;

  /**
   * Questions that did not receive answers (empty or missing).
   */
  unanswered: string[];

  /**
   * The original questions that were asked.
   */
  questions: string[];
};

// =============================================================================
// Agent Params Types
// =============================================================================

/**
 * Parameters for running an agent.
 */
export type RunAgentParams<TResult> = {
  /** Inngest step tools for durable execution */
  step: StepTools;
  /** Unique name for the agent */
  name: string;
  /** LLM provider to use */
  provider: LLMProvider;
  /** Prompt configuration with messages and variables */
  prompt: Prompt;
  /** LLM configuration (model, temperature, etc.) */
  config: LLMConfig;
  /** Optional tools the agent can use */
  tools?: Tool[];
  /** Function to process the LLM response into the result type */
  fn: (response: string) => TResult | Promise<TResult>;
  /** Optional streaming configuration */
  streaming?: StreamingConfig;
  /** Optional metadata to include in streaming messages */
  metadata?: AgentMetadata;
  /**
   * Optional Zod schema for validating and typing the result.
   * When provided, the result from `fn` will be validated against this schema.
   * If validation fails, an error will be thrown with details about what failed.
   */
  resultSchema?: ZodType<TResult>;
  /**
   * Lifecycle hooks for monitoring, logging, and custom behavior.
   */
  hooks?: AgentHooks<TResult>;
  /**
   * Maximum number of tool-calling iterations before throwing an error.
   * @default 10
   */
  maxIterations?: number;
  /**
   * Optional run ID for deterministic step naming.
   * If not provided, a random ID will be generated.
   */
  runId?: string;
};

// =============================================================================
// Prompt Types
// =============================================================================

/**
 * Options for hydrating prompts.
 */
export type HydratePromptOptions = {
  /**
   * If true, logs a warning when variables referenced in the template
   * are not provided in the variables object.
   * @default false
   */
  warnOnMissingVars?: boolean;

  /**
   * If true, throws an error when variables referenced in the template
   * are not provided in the variables object.
   * @default false
   */
  throwOnMissingVars?: boolean;

  /**
   * Custom logger function for warnings. Defaults to console.warn.
   */
  logger?: (message: string) => void;
};

// =============================================================================
// Provider Types
// =============================================================================

/**
 * Extended provider configuration for Azure OpenAI.
 */
export type AzureOpenAIProviderConfig = ProviderConfig & {
  /**
   * Azure OpenAI deployment name.
   * This is the name you gave your model deployment in Azure.
   */
  deployment?: string;

  /**
   * Azure OpenAI API version.
   * @default "2024-02-15-preview"
   */
  apiVersion?: string;
};
