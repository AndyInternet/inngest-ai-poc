import type { StepTools } from "./agent";

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
