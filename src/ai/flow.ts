import type { StepTools } from './agent';

export type FlowTrigger = {
  type: 'event';
  event: string;
} | {
  type: 'invoke';
  from: string;
};

export type FlowTransition = {
  type: 'linear';
  to: string;
} | {
  type: 'branch';
  to: string[];
} | {
  type: 'conditional';
  branches: Array<{
    condition: (result: any) => boolean;
    to: string;
  }>;
  default?: string;
};

export type FlowNode<TInput = any, TOutput = any> = {
  id: string;
  trigger: FlowTrigger;
  handler: (input: TInput, step: StepTools) => Promise<TOutput> | TOutput;
  transition?: FlowTransition;
};

export type Flow = {
  id: string;
  nodes: FlowNode[];
};

export function defineFlow(config: { id: string; nodes: FlowNode[] }): Flow {
  return {
    id: config.id,
    nodes: config.nodes,
  };
}

export function createFlowNode<TInput = any, TOutput = any>(
  config: {
    id: string;
    trigger: FlowTrigger;
    handler: (input: TInput, step: StepTools) => Promise<TOutput> | TOutput;
    transition?: FlowTransition;
  }
): FlowNode<TInput, TOutput> {
  return config;
}

export function linearTransition(to: string): FlowTransition {
  return { type: 'linear', to };
}

export function branchTransition(to: string[]): FlowTransition {
  return { type: 'branch', to };
}

export function conditionalTransition(
  branches: Array<{ condition: (result: any) => boolean; to: string }>,
  defaultTo?: string
): FlowTransition {
  return {
    type: 'conditional',
    branches,
    default: defaultTo
  };
}

export function eventTrigger(event: string): FlowTrigger {
  return { type: 'event', event };
}

export function invokeTrigger(from: string): FlowTrigger {
  return { type: 'invoke', from };
}

export type FlowFunctionReference = {
  __type: 'flow-function';
  id: string;
  invoke: (data: any) => Promise<any>;
};

export async function invokeFlowNode(
  step: StepTools,
  nodeId: string,
  functionRef: FlowFunctionReference,
  data: any
): Promise<any> {
  return await step.invoke(`invoke-${nodeId}`, {
    function: functionRef,
    data,
  });
}

export async function sendFlowEvent(
  step: StepTools,
  eventName: string,
  data: any
): Promise<void> {
  await step.sendEvent(`send-${eventName}`, {
    name: eventName,
    data,
  });
}

export async function executeTransition(
  step: StepTools,
  transition: FlowTransition | undefined,
  result: any,
  functionRefs: Map<string, FlowFunctionReference>
): Promise<void> {
  if (!transition) return;

  switch (transition.type) {
    case 'linear': {
      const targetRef = functionRefs.get(transition.to);
      if (targetRef) {
        await invokeFlowNode(step, transition.to, targetRef, result);
      } else {
        await sendFlowEvent(step, `flow.${transition.to}`, result);
      }
      break;
    }
    case 'branch': {
      for (const target of transition.to) {
        const targetRef = functionRefs.get(target);
        if (targetRef) {
          await invokeFlowNode(step, target, targetRef, result);
        } else {
          await sendFlowEvent(step, `flow.${target}`, result);
        }
      }
      break;
    }
    case 'conditional': {
      for (const branch of transition.branches) {
        if (branch.condition(result)) {
          const targetRef = functionRefs.get(branch.to);
          if (targetRef) {
            await invokeFlowNode(step, branch.to, targetRef, result);
          } else {
            await sendFlowEvent(step, `flow.${branch.to}`, result);
          }
          return;
        }
      }
      if (transition.default) {
        const targetRef = functionRefs.get(transition.default);
        if (targetRef) {
          await invokeFlowNode(step, transition.default, targetRef, result);
        } else {
          await sendFlowEvent(step, `flow.${transition.default}`, result);
        }
      }
      break;
    }
  }
}
