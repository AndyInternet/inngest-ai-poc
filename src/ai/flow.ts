import type {
  StepTools,
  AgentDefinition,
  PipelineContext,
  PipelineConfig,
  AgentPipeline,
  FlowTransition,
} from "./types";

/**
 * Create an agent definition from an agent function.
 * This helper makes it easy to wrap existing agent functions.
 */
export function defineAgent<TInput, TOutput>(
  config: AgentDefinition<TInput, TOutput>,
): AgentDefinition<TInput, TOutput> {
  return config;
}

/**
 * Create a pipeline that executes agents in sequence.
 * Each agent's output is passed to the next agent via the mapInput function.
 *
 * @example
 * ```typescript
 * const pipeline = createAgentPipeline({
 *   name: "feature-validation",
 *   description: "Validate a feature request"
 * }, [
 *   defineAgent({
 *     name: "gather-context",
 *     run: gatherContextAgent,
 *     mapInput: (_, ctx) => ({
 *       featureDescription: ctx.initialInput.featureDescription,
 *       existingContext: ctx.initialInput.existingContext
 *     })
 *   }),
 *   defineAgent({
 *     name: "analyze-feature",
 *     run: analyzeFeatureAgent,
 *     mapInput: (_, ctx) => ({
 *       featureDescription: ctx.initialInput.featureDescription,
 *       context: JSON.stringify(ctx.results["gather-context"])
 *     })
 *   }),
 *   defineAgent({
 *     name: "generate-report",
 *     run: generateReportAgent,
 *     mapInput: (_, ctx) => ({
 *       analysisResult: ctx.results["analyze-feature"]
 *     })
 *   })
 * ]);
 *
 * // Run the entire pipeline
 * const result = await pipeline.run(step, { featureDescription, existingContext }, sessionId);
 * ```
 */
export function createAgentPipeline<TInput, TOutput>(
  config: PipelineConfig,
  agents: AgentDefinition[],
): AgentPipeline<TInput, TOutput> {
  return {
    config,
    agents,
    run: async (
      step: StepTools,
      input: TInput,
      sessionId?: string,
    ): Promise<TOutput> => {
      const context: PipelineContext = {
        initialInput: input,
        results: {},
        sessionId,
      };

      let lastResult: any = input;

      for (const agent of agents) {
        // Determine input for this agent
        let agentInput: any;
        if (agent.mapInput) {
          agentInput = agent.mapInput(lastResult, context);
        } else {
          // Default: pass the previous result directly
          agentInput = lastResult;
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

        // Execute the agent directly - agents manage their own steps internally
        // We don't wrap in step.run() because agents use step.run() internally
        // and Inngest doesn't support nested steps
        const result = await agent.run(step, agentInput, sessionId);

        // Validate output if schema is provided
        if (agent.outputSchema) {
          const parseResult = agent.outputSchema.safeParse(result);
          if (!parseResult.success) {
            const errorDetails = parseResult.error.issues
              .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
              .join("\n");
            throw new Error(
              `Pipeline "${config.name}" - Agent "${agent.name}" output validation failed:\n${errorDetails}`,
            );
          }
        }

        // Store result in context
        context.results[agent.name] = result;
        lastResult = result;
      }

      return lastResult as TOutput;
    },
  };
}

/**
 * Helper to run multiple agents in parallel and combine their results.
 * Useful for fan-out patterns where multiple analyses can happen concurrently.
 *
 * Note: Agents manage their own steps internally, so we don't wrap them
 * in step.run() here. The parallelization comes from Promise.all().
 */
export async function runAgentsInParallel<
  TInput,
  TResults extends Record<string, any>,
>(
  step: StepTools,
  agents: Array<{
    name: string;
    run: (step: StepTools, input: TInput, sessionId?: string) => Promise<any>;
  }>,
  input: TInput,
  sessionId?: string,
): Promise<TResults> {
  const results: Record<string, any> = {};

  // Execute all agents - agents manage their own steps internally
  await Promise.all(
    agents.map(async (agent) => {
      const result = await agent.run(step, input, sessionId);
      results[agent.name] = result;
    }),
  );

  return results as TResults;
}

// FlowTransition helper functions

export function linearTransition(to: string): FlowTransition {
  return { type: "linear", to };
}

export function branchTransition(to: string[]): FlowTransition {
  return { type: "branch", to };
}

export function conditionalTransition(
  branches: Array<{ condition: (result: any) => boolean; to: string }>,
  defaultTo?: string,
): FlowTransition {
  return {
    type: "conditional",
    branches,
    default: defaultTo,
  };
}

/**
 * Execute a flow transition by invoking Inngest functions or sending events
 * This should be called at the end of an Inngest function to continue the flow
 */
export async function executeTransition(
  step: StepTools,
  transition: FlowTransition | undefined,
  result: any,
  functionRefs: Map<string, any>,
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
