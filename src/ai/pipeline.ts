import type {
  StepTools,
  AgentDefinition,
  PipelineContext,
  PipelineConfig,
  AgentPipeline,
  PipelineTransition,
} from "./types";

// =============================================================================
// Pipeline Types
// =============================================================================

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
 * Options for conditional agent execution.
 */
export type AgentExecutionOptions = {
  /**
   * Predicate to determine if this agent should run.
   * If returns false, the agent is skipped and the previous result is passed through.
   *
   * @param previousOutput - Output from the previous agent
   * @param context - Current pipeline context
   * @returns True to run the agent, false to skip
   */
  shouldRun?: (
    previousOutput: unknown,
    context: PipelineContext<unknown>,
  ) => boolean | Promise<boolean>;

  /**
   * Default result to use when the agent is skipped.
   * If not provided and agent is skipped, the previous output is passed through.
   */
  skipResult?: unknown;
};

// =============================================================================
// Agent Definition
// =============================================================================

/**
 * Create an agent definition from an agent function.
 * This helper makes it easy to wrap existing agent functions with type safety.
 *
 * @typeParam TInput - The input type this agent expects
 * @typeParam TOutput - The output type this agent produces
 * @typeParam TPreviousOutput - The output type from the previous agent (for mapInput)
 * @typeParam TPipelineInput - The initial input type to the pipeline
 * @typeParam TPipelineResults - Record of all previous agent results in the pipeline
 *
 * @example
 * ```typescript
 * const myAgent = defineAgent<MyInput, MyOutput>({
 *   name: "my-agent",
 *   description: "Does something useful",
 *   run: async (step, input, sessionId) => {
 *     // ... implementation
 *     return output;
 *   },
 *   mapInput: (prev, ctx) => ({
 *     data: ctx.results["previous-agent"].data,
 *   }),
 * });
 * ```
 */
export function defineAgent<
  TInput,
  TOutput,
  TPreviousOutput = unknown,
  TPipelineInput = unknown,
  TPipelineResults extends Record<string, unknown> = Record<string, unknown>,
>(
  config: AgentDefinition<
    TInput,
    TOutput,
    TPreviousOutput,
    TPipelineInput,
    TPipelineResults
  >,
): AgentDefinition<
  TInput,
  TOutput,
  TPreviousOutput,
  TPipelineInput,
  TPipelineResults
> {
  if (!config.name) {
    throw new Error("Agent name is required");
  }
  if (!config.run) {
    throw new Error("Agent run function is required");
  }
  return config;
}

// =============================================================================
// Pipeline Validation
// =============================================================================

/**
 * Validation result for a pipeline configuration.
 */
export type PipelineValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

/**
 * Validate a pipeline configuration for common issues.
 *
 * Checks for:
 * - Empty agent list
 * - Duplicate agent names
 * - Missing required fields
 * - Agents without mapInput (except first agent)
 *
 * @param config - Pipeline configuration
 * @param agents - Array of agent definitions
 * @returns Validation result with errors and warnings
 *
 * @example
 * ```typescript
 * const result = validatePipeline(config, agents);
 * if (!result.valid) {
 *   console.error("Pipeline validation failed:", result.errors);
 * }
 * if (result.warnings.length > 0) {
 *   console.warn("Pipeline warnings:", result.warnings);
 * }
 * ```
 */
export function validatePipeline(
  config: PipelineConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agents: readonly AgentDefinition<any, any, any, any, any>[],
): PipelineValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check pipeline config
  if (!config.name || config.name.trim() === "") {
    errors.push("Pipeline name is required");
  }

  // Check agents array
  if (!agents || agents.length === 0) {
    errors.push("Pipeline must have at least one agent");
    return { valid: false, errors, warnings };
  }

  // Check for duplicate names
  const names = new Set<string>();
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];

    if (!agent.name || agent.name.trim() === "") {
      errors.push(`agents[${i}]: Agent name is required`);
      continue;
    }

    if (names.has(agent.name)) {
      errors.push(`agents[${i}]: Duplicate agent name "${agent.name}"`);
    } else {
      names.add(agent.name);
    }

    if (!agent.run) {
      errors.push(
        `agents[${i}] ("${agent.name}"): Agent run function is required`,
      );
    }

    // Warning: agent without mapInput (except first)
    if (i > 0 && !agent.mapInput) {
      warnings.push(
        `agents[${i}] ("${agent.name}"): No mapInput defined. ` +
          `Previous agent's output will be passed directly as input.`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// =============================================================================
// Pipeline Creation and Execution
// =============================================================================

/**
 * Create a pipeline that executes agents in sequence.
 * Each agent's output is passed to the next agent via the mapInput function.
 *
 * ## Features
 *
 * - **Sequential execution**: Agents run one after another
 * - **Context accumulation**: Each agent can access results from all previous agents
 * - **Schema validation**: Optional Zod schemas for input/output validation
 * - **Lifecycle hooks**: Monitor pipeline execution with callbacks
 * - **Error recovery**: Handle agent failures gracefully
 *
 * ## Execution Flow
 *
 * 1. `onPipelineStart` hook is called
 * 2. For each agent:
 *    a. `shouldRun` predicate is checked (if provided)
 *    b. `onAgentStart` hook is called
 *    c. `mapInput` transforms previous output to agent input
 *    d. Input schema validation (if provided)
 *    e. Agent `run` function executes
 *    f. Output schema validation (if provided)
 *    g. `onAgentEnd` hook is called
 *    h. Result is stored in context
 * 3. `onPipelineEnd` hook is called with final result
 *
 * @example
 * ```typescript
 * const pipeline = createAgentPipeline(
 *   {
 *     name: "feature-validation",
 *     description: "Validate a feature request",
 *     hooks: {
 *       onAgentStart: (name, index) => console.log(`Starting ${name}`),
 *       onAgentEnd: (name, index, result, ms) => console.log(`${name} done in ${ms}ms`),
 *       onAgentError: (error) => {
 *         console.error(`Agent ${error.agentName} failed:`, error.error);
 *         return { action: "skip", result: null }; // Skip failed agent
 *       },
 *     },
 *   },
 *   [
 *     defineAgent({ name: "gather-context", run: gatherContextAgent, ... }),
 *     defineAgent({ name: "analyze-feature", run: analyzeFeatureAgent, ... }),
 *     defineAgent({ name: "generate-report", run: generateReportAgent, ... }),
 *   ],
 * );
 *
 * const result = await pipeline.run(step, { featureDescription }, sessionId);
 * ```
 */
export function createAgentPipeline<TInput, TOutput>(
  config: PipelineConfigWithHooks<TInput, TOutput>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agents: readonly (AgentDefinition<any, any, any, TInput, any> &
    AgentExecutionOptions)[],
): AgentPipeline<TInput, TOutput> {
  return {
    config,
    agents,
    run: async (
      step: StepTools,
      input: TInput,
      sessionId?: string,
    ): Promise<TOutput> => {
      const pipelineStartTime = Date.now();
      const context: PipelineContext<TInput> = {
        initialInput: input,
        results: {},
        sessionId,
      };

      const hooks = config.hooks;

      // Call pipeline start hook
      if (hooks?.onPipelineStart) {
        await hooks.onPipelineStart(input, sessionId);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let lastResult: any = input;

      try {
        for (let i = 0; i < agents.length; i++) {
          const agent = agents[i];
          const agentStartTime = Date.now();

          // Check if agent should run
          if (agent.shouldRun) {
            const shouldExecute = await agent.shouldRun(lastResult, context);
            if (!shouldExecute) {
              // Skip this agent
              const skipResult = agent.skipResult ?? lastResult;
              context.results[agent.name] = skipResult;
              lastResult = skipResult;
              continue;
            }
          }

          // Determine input for this agent
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let agentInput: any;
          if (agent.mapInput) {
            agentInput = agent.mapInput(lastResult, context);
          } else {
            agentInput = lastResult;
          }

          // Call agent start hook
          if (hooks?.onAgentStart) {
            await hooks.onAgentStart(agent.name, i, agentInput, context);
          }

          // Validate input if schema is provided
          if (agent.inputSchema) {
            const parseResult = agent.inputSchema.safeParse(agentInput);
            if (!parseResult.success) {
              const errorDetails = parseResult.error.issues
                .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
                .join("\n");
              throw new Error(
                `Pipeline "${config.name}" - Agent "${agent.name}" input validation failed:\n${errorDetails}`,
              );
            }
            agentInput = parseResult.data;
          }

          try {
            // Execute the agent
            const result = await agent.run(step, agentInput, sessionId);

            // Validate output if schema is provided
            if (agent.outputSchema) {
              const parseResult = agent.outputSchema.safeParse(result);
              if (!parseResult.success) {
                const errorDetails = parseResult.error.issues
                  .map(
                    (issue) => `  - ${issue.path.join(".")}: ${issue.message}`,
                  )
                  .join("\n");
                throw new Error(
                  `Pipeline "${config.name}" - Agent "${agent.name}" output validation failed:\n${errorDetails}`,
                );
              }
            }

            const agentDuration = Date.now() - agentStartTime;

            // Call agent end hook
            if (hooks?.onAgentEnd) {
              await hooks.onAgentEnd(
                agent.name,
                i,
                result,
                agentDuration,
                context,
              );
            }

            // Store result in context
            context.results[agent.name] = result;
            lastResult = result;
          } catch (error) {
            // Handle agent error
            const pipelineError: PipelineError = {
              error: error as Error,
              agentName: agent.name,
              agentIndex: i,
              input: agentInput,
              previousResults: { ...context.results },
            };

            // Check for error recovery
            let recovery: ErrorRecoveryResult | undefined;
            if (hooks?.onAgentError) {
              recovery = await hooks.onAgentError(pipelineError, context);
            }

            if (!recovery || recovery.action === "throw") {
              throw error;
            }

            if (recovery.action === "skip") {
              const skipResult = recovery.result ?? lastResult;
              context.results[agent.name] = skipResult;
              lastResult = skipResult;
              continue;
            }

            if (recovery.action === "abort") {
              return recovery.result as TOutput;
            }

            // 'retry' action not yet implemented
            throw error;
          }
        }

        const totalDuration = Date.now() - pipelineStartTime;

        // Call pipeline end hook
        if (hooks?.onPipelineEnd) {
          await hooks.onPipelineEnd(
            lastResult as TOutput,
            totalDuration,
            context,
          );
        }

        return lastResult as TOutput;
      } catch (error) {
        // Call pipeline error hook
        if (hooks?.onPipelineError) {
          await hooks.onPipelineError(error as Error, context);
        }
        throw error;
      }
    },
  };
}

// =============================================================================
// Parallel Execution
// =============================================================================

/**
 * Helper to run multiple agents in parallel and combine their results.
 * Useful for fan-out patterns where multiple analyses can happen concurrently.
 *
 * ## Important Limitation
 *
 * While this uses `Promise.all()` for concurrent JavaScript execution,
 * **Inngest steps within each agent still execute sequentially** due to
 * how Inngest's step orchestration works.
 *
 * For true parallel execution where steps run independently:
 * 1. Create separate Inngest functions for each parallel branch
 * 2. Use `step.invoke()` to call them, which schedules independent executions
 *
 * This function is still useful when:
 * - Agents perform I/O-bound operations (API calls, database queries)
 * - You want to simplify the code for conceptually parallel operations
 * - The sequential step execution is acceptable for your use case
 *
 * @typeParam TInput - The input type shared by all agents
 * @typeParam TResults - A record type mapping agent names to their output types
 *
 * @example
 * ```typescript
 * // Run multiple analyses concurrently
 * const results = await runAgentsInParallel(
 *   step,
 *   [
 *     { name: "sentiment", run: sentimentAgent },
 *     { name: "keywords", run: keywordAgent },
 *     { name: "summary", run: summaryAgent },
 *   ],
 *   { text: documentText },
 *   sessionId,
 * );
 *
 * // Access results
 * console.log(results.sentiment, results.keywords, results.summary);
 * ```
 *
 * @example
 * ```typescript
 * // For true parallel execution, use separate functions:
 * const [sentimentResult, keywordResult] = await Promise.all([
 *   step.invoke("sentiment-analysis", { function: sentimentFn, data: input }),
 *   step.invoke("keyword-extraction", { function: keywordFn, data: input }),
 * ]);
 * ```
 */
export async function runAgentsInParallel<
  TInput,
  TResults extends Record<string, unknown> = Record<string, unknown>,
>(
  step: StepTools,
  agents: Array<{
    name: string;
    run: (
      step: StepTools,
      input: TInput,
      sessionId?: string,
    ) => Promise<unknown>;
  }>,
  input: TInput,
  sessionId?: string,
): Promise<TResults> {
  const results: Record<string, unknown> = {};

  // Execute all agents - agents manage their own steps internally
  await Promise.all(
    agents.map(async (agent) => {
      const result = await agent.run(step, input, sessionId);
      results[agent.name] = result;
    }),
  );

  return results as TResults;
}

// =============================================================================
// Pipeline Transition Helpers
// =============================================================================

/**
 * Create a linear transition to a single target.
 * The result is passed to the target function/event.
 *
 * @param to - The target agent/function name
 *
 * @example
 * ```typescript
 * const transition = linearTransition("process-results");
 * await executeTransition(step, transition, result, functionRefs);
 * ```
 */
export function linearTransition(to: string): PipelineTransition<unknown> {
  return { type: "linear", to };
}

/**
 * Create a fan-out transition to multiple targets in parallel.
 * The same result is passed to all target functions/events.
 *
 * @param to - Array of target agent/function names
 *
 * @example
 * ```typescript
 * const transition = fanOutTransition([
 *   "send-notification",
 *   "update-database",
 *   "log-analytics",
 * ]);
 * await executeTransition(step, transition, result, functionRefs);
 * ```
 */
export function fanOutTransition(to: string[]): PipelineTransition<unknown> {
  return { type: "branch", to };
}

/**
 * Create a conditional transition that routes based on the result.
 * Conditions are evaluated in order; first matching condition wins.
 *
 * @typeParam TResult - The type of result to evaluate conditions against
 * @param branches - Array of condition/target pairs, evaluated in order
 * @param defaultTo - Optional default target if no conditions match
 *
 * @example
 * ```typescript
 * const transition = conditionalTransition<AnalysisResult>(
 *   [
 *     { condition: (r) => r.score > 80, to: "high-priority-handler" },
 *     { condition: (r) => r.score > 50, to: "medium-priority-handler" },
 *     { condition: (r) => r.needsReview, to: "manual-review" },
 *   ],
 *   "low-priority-handler", // default if no conditions match
 * );
 * ```
 */
export function conditionalTransition<TResult = unknown>(
  branches: Array<{ condition: (result: TResult) => boolean; to: string }>,
  defaultTo?: string,
): PipelineTransition<TResult> {
  return {
    type: "conditional",
    branches,
    default: defaultTo,
  };
}

/**
 * Execute a pipeline transition by invoking Inngest functions or sending events.
 * This should be called at the end of an Inngest function to continue the pipeline.
 *
 * ## Behavior
 *
 * - If the target is found in `functionRefs`, uses `step.invoke()` for direct invocation
 * - If the target is not found, uses `step.sendEvent()` to emit an event
 * - For branch transitions, all targets are executed (sequentially for invokes)
 * - For conditional transitions, first matching condition determines the target
 *
 * @typeParam TResult - The type of result being passed to the next step
 * @param step - Inngest step tools
 * @param transition - The transition to execute (or undefined to skip)
 * @param result - The result to pass to the next step
 * @param functionRefs - Map of function names to Inngest function references
 * @returns The result from the invoked function, or null for events
 *
 * @example
 * ```typescript
 * // At the end of an Inngest function:
 * const functionRefs = new Map([
 *   ["process-results", processResultsFn],
 *   ["send-notification", sendNotificationFn],
 * ]);
 *
 * const transition = conditionalTransition<MyResult>([
 *   { condition: (r) => r.success, to: "process-results" },
 *   { condition: (r) => !r.success, to: "handle-failure" },
 * ]);
 *
 * await executeTransition(step, transition, result, functionRefs);
 * ```
 */
export async function executeTransition<TResult = unknown>(
  step: StepTools,
  transition: PipelineTransition<TResult> | undefined,
  result: TResult,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  functionRefs: Map<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  if (!transition) return null;

  switch (transition.type) {
    case "linear": {
      const targetRef = functionRefs.get(transition.to);
      if (targetRef) {
        return await step.invoke(`invoke-${transition.to}`, {
          function: targetRef,
          data: result,
        });
      } else {
        await step.sendEvent(`send-event-${transition.to}`, {
          name: transition.to,
          data: result,
        });
        return null;
      }
    }
    case "branch": {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const results: any[] = [];
      for (const target of transition.to) {
        const targetRef = functionRefs.get(target);
        if (targetRef) {
          const branchResult = await step.invoke(`invoke-${target}`, {
            function: targetRef,
            data: result,
          });
          results.push(branchResult);
        } else {
          await step.sendEvent(`send-event-${target}`, {
            name: target,
            data: result,
          });
        }
      }
      return results.length > 0 ? results : null;
    }
    case "conditional": {
      for (const branch of transition.branches) {
        if (branch.condition(result)) {
          const targetRef = functionRefs.get(branch.to);
          if (targetRef) {
            return await step.invoke(`invoke-${branch.to}`, {
              function: targetRef,
              data: result,
            });
          } else {
            await step.sendEvent(`send-event-${branch.to}`, {
              name: branch.to,
              data: result,
            });
            return null;
          }
        }
      }
      if (transition.default) {
        const targetRef = functionRefs.get(transition.default);
        if (targetRef) {
          return await step.invoke(`invoke-${transition.default}`, {
            function: targetRef,
            data: result,
          });
        } else {
          await step.sendEvent(`send-event-${transition.default}`, {
            name: transition.default,
            data: result,
          });
        }
      }
      return null;
    }
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Get all agent names from a pipeline.
 *
 * @param pipeline - The pipeline to inspect
 * @returns Array of agent names in execution order
 */
export function getPipelineAgentNames<TInput, TOutput>(
  pipeline: AgentPipeline<TInput, TOutput>,
): string[] {
  return pipeline.agents.map((agent) => agent.name);
}

/**
 * Create a simple pipeline from an array of agent run functions.
 * Useful for quick prototyping when you don't need mapInput transformations.
 *
 * @param name - Pipeline name
 * @param agents - Array of { name, run } objects
 * @returns A simple pipeline where each agent receives the previous agent's output
 *
 * @example
 * ```typescript
 * const pipeline = createSimplePipeline("my-pipeline", [
 *   { name: "step1", run: step1Agent },
 *   { name: "step2", run: step2Agent },
 *   { name: "step3", run: step3Agent },
 * ]);
 * ```
 */
export function createSimplePipeline<TInput, TOutput>(
  name: string,
  agents: Array<{
    name: string;
    run: (
      step: StepTools,
      input: unknown,
      sessionId?: string,
    ) => Promise<unknown>;
  }>,
): AgentPipeline<TInput, TOutput> {
  return createAgentPipeline<TInput, TOutput>(
    { name },
    agents.map((agent) =>
      defineAgent({
        name: agent.name,
        run: agent.run,
      }),
    ),
  );
}
