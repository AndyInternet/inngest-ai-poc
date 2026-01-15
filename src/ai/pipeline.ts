import type {
  StepTools,
  AgentDefinition,
  PipelineContext,
  PipelineConfig,
  AgentPipeline,
  PipelineError,
  ErrorRecoveryResult,
  PipelineConfigWithHooks,
  PipelineValidationResult,
  BranchDefinition,
  PipelineStep,
} from "./types";
import { isBranchDefinition } from "./types";

// Re-export types for backwards compatibility
export type {
  PipelineError,
  ErrorRecoveryResult,
  PipelineHooks,
  PipelineConfigWithHooks,
  PipelineValidationResult,
  BranchDefinition,
  PipelineStep,
} from "./types";

// Re-export type guards
export { isBranchDefinition, isAgentDefinition } from "./types";

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
// Branch Definition
// =============================================================================

/**
 * Create a branch definition for conditional forking in pipelines.
 *
 * Branches allow you to route pipeline execution to different agent sequences
 * based on the output of previous steps. This is useful for:
 * - Different processing paths based on classification results
 * - A/B testing different agent strategies
 * - Handling different input types with specialized agents
 *
 * @typeParam TBranchKey - String literal union of branch names
 * @typeParam TPreviousOutput - Output type from the previous step
 * @typeParam TBranchOutput - Output type produced by branches
 * @typeParam TPipelineInput - Initial pipeline input type
 * @typeParam TPipelineResults - Accumulated results type
 *
 * @example
 * ```typescript
 * const pipeline = createAgentPipeline(
 *   { name: "classification-pipeline" },
 *   [
 *     defineAgent({ name: "classifier", run: classifierAgent }),
 *
 *     defineBranch({
 *       name: "processing-branch",
 *       condition: (prev) => prev.category, // "technical" | "business" | "general"
 *       branches: {
 *         technical: [
 *           defineAgent({ name: "tech-analyzer", run: techAgent }),
 *           defineAgent({ name: "tech-reporter", run: techReportAgent }),
 *         ],
 *         business: [
 *           defineAgent({ name: "biz-analyzer", run: bizAgent }),
 *           defineAgent({ name: "biz-reporter", run: bizReportAgent }),
 *         ],
 *         general: [
 *           defineAgent({ name: "general-handler", run: generalAgent }),
 *         ],
 *       },
 *       defaultBranch: "general",
 *     }),
 *
 *     defineAgent({ name: "finalizer", run: finalizeAgent }),
 *   ],
 * );
 * ```
 */
export function defineBranch<
  TBranchKey extends string,
  TPreviousOutput = unknown,
  TBranchOutput = unknown,
  TPipelineInput = unknown,
  TPipelineResults extends Record<string, unknown> = Record<string, unknown>,
>(
  config: Omit<
    BranchDefinition<
      TBranchKey,
      TPreviousOutput,
      TBranchOutput,
      TPipelineInput,
      TPipelineResults
    >,
    "__type"
  >,
): BranchDefinition<
  TBranchKey,
  TPreviousOutput,
  TBranchOutput,
  TPipelineInput,
  TPipelineResults
> {
  if (!config.name) {
    throw new Error("Branch name is required");
  }
  if (!config.condition) {
    throw new Error("Branch condition function is required");
  }
  if (!config.branches || Object.keys(config.branches).length === 0) {
    throw new Error("Branch must have at least one branch defined");
  }

  // Validate that each branch has at least one step
  for (const [key, steps] of Object.entries(config.branches)) {
    if (!steps || (steps as unknown[]).length === 0) {
      throw new Error(`Branch "${key}" must have at least one step`);
    }
  }

  return {
    __type: "branch",
    ...config,
  };
}

// =============================================================================
// Pipeline Validation
// =============================================================================

/**
 * Validate a pipeline configuration for common issues.
 *
 * Checks for:
 * - Empty step list
 * - Duplicate agent/branch names
 * - Missing required fields
 * - Agents without mapInput (except first step)
 * - Branch validation (condition, branches, agents within branches)
 *
 * @param config - Pipeline configuration
 * @param steps - Array of agent and branch definitions
 * @returns Validation result with errors and warnings
 *
 * @example
 * ```typescript
 * const result = validatePipeline(config, steps);
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
  steps: readonly PipelineStep<any>[],
): PipelineValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check pipeline config
  if (!config.name || config.name.trim() === "") {
    errors.push("Pipeline name is required");
  }

  // Check steps array
  if (!steps || steps.length === 0) {
    errors.push("Pipeline must have at least one step");
    return { valid: false, errors, warnings };
  }

  // Check for duplicate names (including branch names and agents within branches)
  const names = new Set<string>();

  function validateAgent(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    agent: AgentDefinition<any, any, any, any, any>,
    path: string,
    isFirstInSequence: boolean,
  ): void {
    if (!agent.name || agent.name.trim() === "") {
      errors.push(`${path}: Agent name is required`);
      return;
    }

    if (names.has(agent.name)) {
      errors.push(`${path}: Duplicate name "${agent.name}"`);
    } else {
      names.add(agent.name);
    }

    if (!agent.run) {
      errors.push(`${path} ("${agent.name}"): Agent run function is required`);
    }

    // Warning: agent without mapInput (except first in sequence)
    if (!isFirstInSequence && !agent.mapInput) {
      warnings.push(
        `${path} ("${agent.name}"): No mapInput defined. ` +
          `Previous output will be passed directly as input.`,
      );
    }
  }

  function validateStep(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pipelineStep: PipelineStep<any>,
    path: string,
    isFirstInSequence: boolean,
  ): void {
    if (isBranchDefinition(pipelineStep)) {
      validateBranch(pipelineStep, path);
    } else {
      validateAgent(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pipelineStep as AgentDefinition<any, any, any, any, any>,
        path,
        isFirstInSequence,
      );
    }
  }

  function validateBranch(branch: BranchDefinition, path: string): void {
    if (!branch.name || branch.name.trim() === "") {
      errors.push(`${path}: Branch name is required`);
      return;
    }

    if (names.has(branch.name)) {
      errors.push(`${path}: Duplicate name "${branch.name}"`);
    } else {
      names.add(branch.name);
    }

    if (!branch.condition) {
      errors.push(
        `${path} ("${branch.name}"): Branch condition function is required`,
      );
    }

    if (!branch.branches || Object.keys(branch.branches).length === 0) {
      errors.push(
        `${path} ("${branch.name}"): Branch must have at least one branch defined`,
      );
      return;
    }

    // Validate each branch's steps (which may include nested branches)
    for (const [branchKey, branchSteps] of Object.entries(branch.branches)) {
      if (!branchSteps || (branchSteps as unknown[]).length === 0) {
        errors.push(
          `${path} ("${branch.name}").branches["${branchKey}"]: Branch must have at least one step`,
        );
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (branchSteps as PipelineStep<any>[]).forEach((branchStep, j) => {
        validateStep(
          branchStep,
          `${path} ("${branch.name}").branches["${branchKey}"][${j}]`,
          j === 0,
        );
      });
    }

    // Validate defaultBranch if provided
    if (branch.defaultBranch && !branch.branches[branch.defaultBranch]) {
      errors.push(
        `${path} ("${branch.name}"): defaultBranch "${branch.defaultBranch}" ` +
          `is not a valid branch key. Available: ${Object.keys(branch.branches).join(", ")}`,
      );
    }
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    if (isBranchDefinition(step)) {
      validateBranch(step, `steps[${i}]`);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      validateAgent(
        step as AgentDefinition<any, any, any, any, any>,
        `steps[${i}]`,
        i === 0,
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
 * Execute a single agent within a pipeline.
 * Internal helper function to reduce code duplication.
 */
async function executeAgent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent: AgentDefinition<any, any, any, any, any>,
  step: StepTools,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agentInput: any,
  sessionId: string | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: PipelineContext<any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  hooks: PipelineConfigWithHooks<any, any>["hooks"],
  pipelineName: string,
  stepIndex: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lastResult: any,
): Promise<{ result: unknown; shouldContinue: boolean }> {
  const agentStartTime = Date.now();

  // Call agent start hook
  if (hooks?.onAgentStart) {
    await hooks.onAgentStart(agent.name, stepIndex, agentInput, context);
  }

  // Validate input if schema is provided
  if (agent.inputSchema) {
    const parseResult = agent.inputSchema.safeParse(agentInput);
    if (!parseResult.success) {
      const errorDetails = parseResult.error.issues
        .map(
          (issue: { path: (string | number)[]; message: string }) =>
            `  - ${issue.path.join(".")}: ${issue.message}`,
        )
        .join("\n");
      throw new Error(
        `Pipeline "${pipelineName}" - Agent "${agent.name}" input validation failed:\n${errorDetails}`,
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
            (issue: { path: (string | number)[]; message: string }) =>
              `  - ${issue.path.join(".")}: ${issue.message}`,
          )
          .join("\n");
        throw new Error(
          `Pipeline "${pipelineName}" - Agent "${agent.name}" output validation failed:\n${errorDetails}`,
        );
      }
    }

    const agentDuration = Date.now() - agentStartTime;

    // Call agent end hook
    if (hooks?.onAgentEnd) {
      await hooks.onAgentEnd(
        agent.name,
        stepIndex,
        result,
        agentDuration,
        context,
      );
    }

    // Store result in context
    context.results[agent.name] = result;

    return { result, shouldContinue: true };
  } catch (error) {
    // Handle agent error
    const pipelineError: PipelineError = {
      error: error as Error,
      agentName: agent.name,
      agentIndex: stepIndex,
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
      return { result: skipResult, shouldContinue: true };
    }

    if (recovery.action === "abort") {
      return { result: recovery.result, shouldContinue: false };
    }

    // 'retry' action not yet implemented
    throw error;
  }
}

/**
 * Execute a branch within a pipeline.
 * Internal helper function for branch execution.
 * Supports nested branches through recursive calls.
 */
async function executeBranch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  branch: BranchDefinition<any, any, any, any, any>,
  step: StepTools,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  previousOutput: any,
  sessionId: string | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: PipelineContext<any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  hooks: PipelineConfigWithHooks<any, any>["hooks"],
  pipelineName: string,
  stepIndex: number,
): Promise<{ result: unknown; shouldContinue: boolean }> {
  // Determine which branch to execute
  const branchKey = await branch.condition(previousOutput, context);

  // Get the steps for this branch
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let branchSteps = branch.branches[branchKey] as
    | readonly PipelineStep<any>[]
    | undefined;

  // Use default branch if key not found
  if (!branchSteps && branch.defaultBranch) {
    branchSteps = branch.branches[branch.defaultBranch];
  }

  if (!branchSteps) {
    throw new Error(
      `Pipeline "${pipelineName}" - Branch "${branch.name}" returned unknown key "${branchKey}" ` +
        `and no defaultBranch is defined. Available branches: ${Object.keys(branch.branches).join(", ")}`,
    );
  }

  // Transform input if mapInput is provided
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let branchInput: any = previousOutput;
  if (branch.mapInput) {
    branchInput = branch.mapInput(previousOutput, context);
  }

  // Execute the branch steps in sequence
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lastBranchResult: any = branchInput;

  for (let j = 0; j < branchSteps.length; j++) {
    const branchStep = branchSteps[j];

    if (isBranchDefinition(branchStep)) {
      // Recursively execute nested branch
      const { result, shouldContinue } = await executeBranch(
        branchStep,
        step,
        lastBranchResult,
        sessionId,
        context,
        hooks,
        pipelineName,
        stepIndex,
      );

      if (!shouldContinue) {
        return { result, shouldContinue: false };
      }

      lastBranchResult = result;
    } else {
      // Execute agent
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const agent = branchStep as AgentDefinition<any, any, any, any, any>;

      // Check if agent should run
      if (agent.shouldRun) {
        const shouldExecute = await agent.shouldRun(lastBranchResult, context);
        if (!shouldExecute) {
          const skipResult = agent.skipResult ?? lastBranchResult;
          context.results[agent.name] = skipResult;
          lastBranchResult = skipResult;
          continue;
        }
      }

      // Determine input for this agent
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let agentInput: any;
      if (agent.mapInput) {
        agentInput = agent.mapInput(lastBranchResult, context);
      } else {
        agentInput = lastBranchResult;
      }

      const { result, shouldContinue } = await executeAgent(
        agent,
        step,
        agentInput,
        sessionId,
        context,
        hooks,
        pipelineName,
        stepIndex,
        lastBranchResult,
      );

      if (!shouldContinue) {
        return { result, shouldContinue: false };
      }

      lastBranchResult = result;
    }
  }

  // Store the branch result with the branch name
  context.results[branch.name] = lastBranchResult;

  return { result: lastBranchResult, shouldContinue: true };
}

/**
 * Create a pipeline that executes agents and branches in sequence.
 * Each step's output is passed to the next step via the mapInput function.
 *
 * ## Features
 *
 * - **Sequential execution**: Steps run one after another
 * - **Conditional branching**: Route to different agent sequences based on results
 * - **Context accumulation**: Each step can access results from all previous steps
 * - **Schema validation**: Optional Zod schemas for input/output validation
 * - **Lifecycle hooks**: Monitor pipeline execution with callbacks
 * - **Error recovery**: Handle agent failures gracefully
 *
 * ## Execution Flow
 *
 * 1. `onPipelineStart` hook is called
 * 2. For each step (agent or branch):
 *    - **Agent**: Executes the agent function
 *    - **Branch**: Evaluates condition, executes selected branch's agents
 * 3. `onPipelineEnd` hook is called with final result
 *
 * @example
 * ```typescript
 * // Simple sequential pipeline
 * const pipeline = createAgentPipeline(
 *   { name: "feature-validation" },
 *   [
 *     defineAgent({ name: "gather-context", run: gatherContextAgent }),
 *     defineAgent({ name: "analyze-feature", run: analyzeFeatureAgent }),
 *     defineAgent({ name: "generate-report", run: generateReportAgent }),
 *   ],
 * );
 *
 * // Pipeline with conditional branching
 * const branchingPipeline = createAgentPipeline(
 *   { name: "classification-pipeline" },
 *   [
 *     defineAgent({ name: "classifier", run: classifierAgent }),
 *
 *     defineBranch({
 *       name: "processing",
 *       condition: (prev) => prev.category,
 *       branches: {
 *         technical: [defineAgent({ name: "tech-handler", run: techAgent })],
 *         business: [defineAgent({ name: "biz-handler", run: bizAgent })],
 *       },
 *       defaultBranch: "technical",
 *     }),
 *
 *     defineAgent({ name: "finalizer", run: finalizeAgent }),
 *   ],
 * );
 * ```
 */
export function createAgentPipeline<TInput, TOutput>(
  config: PipelineConfigWithHooks<TInput, TOutput>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  steps: readonly PipelineStep<TInput>[],
): AgentPipeline<TInput, TOutput> {
  // Extract just agents for backwards compatibility with the agents property
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agents: AgentDefinition<any, any, any, TInput, any>[] = [];
  for (const s of steps) {
    if (!isBranchDefinition(s)) {
      agents.push(s);
    }
  }

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
        for (let i = 0; i < steps.length; i++) {
          const pipelineStep = steps[i];

          if (isBranchDefinition(pipelineStep)) {
            // Execute branch
            const { result, shouldContinue } = await executeBranch(
              pipelineStep,
              step,
              lastResult,
              sessionId,
              context,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              hooks as any,
              config.name,
              i,
            );

            if (!shouldContinue) {
              return result as TOutput;
            }

            lastResult = result;
          } else {
            // Execute agent - cast to proper type after type guard check
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const agent = pipelineStep as AgentDefinition<
              any,
              any,
              any,
              TInput,
              any
            >;

            // Check if agent should run
            if (agent.shouldRun) {
              const shouldExecute = await agent.shouldRun(lastResult, context);
              if (!shouldExecute) {
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

            const { result, shouldContinue } = await executeAgent(
              agent,
              step,
              agentInput,
              sessionId,
              context,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              hooks as any,
              config.name,
              i,
              lastResult,
            );

            if (!shouldContinue) {
              return result as TOutput;
            }

            lastResult = result;
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
