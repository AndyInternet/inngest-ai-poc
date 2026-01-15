# CLAUDE.md - AI Agent Library Reference

This document provides precise instructions for coding agents on how to use the Inngest AI library.

## Library Overview

This is an **Inngest-first AI agent library** that provides:
- Durable LLM execution with automatic retries and checkpointing
- Multi-provider support (OpenAI, Anthropic, Gemini, Grok, Azure OpenAI)
- Tool calling with pre-call and post-call hooks
- Agent pipelines for multi-step workflows with lifecycle hooks
- Human-in-the-loop with `askUser()`
- Real-time streaming via WebSocket
- Comprehensive validation and error recovery

## File Structure

```
src/ai/
├── agent.ts          # runAgent() - core agent execution
├── streaming.ts      # StreamingManager class + message types
├── metrics.ts        # AgentMetricsCollector class + utilities
├── pipeline.ts       # Pipeline orchestration + hooks + transitions
├── prompt.ts         # Mustache-based prompt templating + validation
├── questions.ts      # askUser() for human-in-the-loop
├── tools.ts          # Tool type guards, schema conversion, validation
├── types.ts          # All TypeScript types and interfaces
└── providers/
    ├── index.ts          # createLLMClient() factory
    ├── openai-base.ts    # OpenAI-compatible base class
    ├── openai.ts         # OpenAI provider
    ├── anthropic.ts      # Anthropic provider (with tool support)
    ├── gemini.ts         # Google Gemini provider (with function calling)
    ├── grok.ts           # xAI Grok provider
    └── azure-openai.ts   # Azure OpenAI provider
```

## Core API

### 1. Creating an LLM Provider

```typescript
import { createLLMClient } from "./ai/providers";
import type { ProviderConfig } from "./ai/types";

const provider = await createLLMClient({
  type: "anthropic", // "openai" | "anthropic" | "gemini" | "grok" | "azure-openai"
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseUrl: undefined, // optional override
});
```

All providers support tool/function calling with a consistent API.

### 2. Running an Agent (`runAgent`)

The `runAgent()` function is the core API. It wraps all LLM interactions in Inngest steps for durability.

```typescript
import { runAgent } from "./ai/agent";
import type { Prompt, Tool, AgentHooks } from "./ai/types";

const result = await runAgent<MyResultType>({
  // Required
  step,                    // Inngest step tools
  name: "my-agent",        // Agent name (used for step naming)
  provider,                // LLM provider from createLLMClient()
  prompt: myPrompt,        // Prompt object with messages and variables
  config: {
    model: "claude-haiku-4-5-20251001",
    temperature: 0.7,
    maxTokens: 2000,
  },
  fn: (response) => {      // Transform LLM response to result type
    return JSON.parse(response);
  },

  // Optional
  tools: [],               // Array of PreCallTool | PostCallTool
  streaming: {             // Enable real-time streaming
    sessionId: "session-123",
    onChunk: (chunk, full) => {},
    onComplete: (result) => {},
    interval: 50,
  },
  metadata: {              // Agent metadata for UI
    workflowStep: "analysis",
    displayName: "Feature Analysis",
    icon: "icon-name",
    description: "Analyzing the feature",
  },
  resultSchema: ZodSchema, // Optional Zod schema for result validation
  hooks: agentHooks,       // Optional lifecycle hooks
  maxIterations: 10,       // Max tool-calling loop iterations (default: 10)
  runId: "deterministic",  // Optional deterministic run ID for step naming
});
```

### 3. Defining Prompts

Prompts use Mustache templating with `{{variable}}` syntax.

```typescript
import type { Prompt } from "./ai/types";

const myPrompt: Prompt = {
  messages: [
    {
      role: "system",
      content: `You are a {{role}}. Today is {{currentDate}}.
      
Existing context:
{{context}}

Respond in JSON format.`,
    },
    {
      role: "user",
      content: "Analyze: {{userInput}}",
    },
  ],
  variables: {
    role: "data analyst",
    currentDate: "2024-01-15",
    context: "Previous analysis results...",
    userInput: "Q4 sales data",
  },
};
```

The `hydratePrompt()` function renders the template:

```typescript
import { hydratePrompt, validatePromptVariables } from "./ai/prompt";

// Validate variables before hydration
const validation = validatePromptVariables(myPrompt);
if (!validation.valid) {
  console.warn("Missing variables:", validation.missing);
}

// Hydrate with options
const messages = hydratePrompt(myPrompt, {
  warnOnMissingVars: true,   // Log warning for missing variables
  throwOnMissingVars: false, // Or throw an error
});
```

#### Prompt Utilities

```typescript
import {
  createSimplePrompt,
  extractVariablesFromTemplate,
  extractVariablesFromMessages,
} from "./ai/prompt";

// Quick prompt creation
const prompt = createSimplePrompt(
  "You are a {{role}}.",           // system message
  "Help me with: {{task}}",        // user message
  { role: "assistant", task: "coding" }
);

// Extract variables from templates
const vars = extractVariablesFromTemplate("Hello {{name}}, your score is {{score}}");
// Returns: ["name", "score"]
```

### 4. Defining Tools

#### Pre-Call Tools

Execute **before** the LLM call to populate prompt variables dynamically.

```typescript
import type { PreCallTool } from "./ai/types";

const getCurrentDateTool: PreCallTool = {
  type: "pre-call",
  name: "getCurrentDate",
  description: "Get the current date",
  execute: () => {
    return {
      currentDate: new Date().toISOString().split("T")[0],
    };
  },
};
```

The returned object keys become available as prompt variables.

#### Post-Call Tools

LLM can invoke these during execution (function calling).

```typescript
import type { PostCallTool, ToolExecutionContext } from "./ai/types";

const searchTool: PostCallTool = {
  type: "post-call",
  name: "searchDatabase",
  description: "Search the database for information",
  parameters: [
    {
      name: "query",
      type: "string",
      description: "The search query",
      required: true,
    },
    {
      name: "limit",
      type: "number",
      description: "Maximum results to return",
      required: false,
    },
  ],
  execute: async (args, context?: ToolExecutionContext) => {
    const { query, limit = 10 } = args;
    
    // Report progress to UI (if streaming enabled)
    if (context?.reportProgress) {
      await context.reportProgress(`Searching for: ${query}`);
    }
    
    // Perform the search
    const results = await db.search(query, limit);
    return { results, count: results.length };
  },
};
```

**Parameter types:** `"string" | "number" | "boolean" | "object" | "array"`

#### Tool Validation

```typescript
import { validateTools, getToolNames, findToolByName, ToolValidationError } from "./ai/tools";

// Validate tools before use
try {
  validateTools(myTools); // Throws ToolValidationError if invalid
} catch (e) {
  if (e instanceof ToolValidationError) {
    console.error("Validation errors:", e.details);
  }
}

// Or get validation result without throwing
const result = validateTools(myTools, { throwOnError: false });
if (!result.valid) {
  console.error("Errors:", result.errors);
}

// Utility helpers
const names = getToolNames(myTools); // ["searchDatabase", "getCurrentDate"]
const tool = findToolByName(myTools, "searchDatabase");
```

### 5. Agent Pipelines

Chain multiple agents sequentially with automatic context passing and lifecycle hooks.

```typescript
import { createAgentPipeline, defineAgent, validatePipeline } from "./ai/pipeline";
import type { PipelineContext, PipelineHooks, ErrorRecoveryResult } from "./ai/pipeline";

// Define pipeline hooks
const pipelineHooks: PipelineHooks<InputType, OutputType> = {
  onPipelineStart: async (input, sessionId) => {
    console.log("Pipeline started");
  },
  onAgentStart: async (agentName, index, input, context) => {
    console.log(`Agent ${agentName} starting`);
  },
  onAgentEnd: async (agentName, index, result, durationMs, context) => {
    console.log(`Agent ${agentName} completed in ${durationMs}ms`);
  },
  onAgentError: async (error, context): Promise<ErrorRecoveryResult> => {
    console.error(`Agent ${error.agentName} failed:`, error.error);
    // Return recovery action
    return { action: "skip", result: null }; // or "throw", "retry", "abort"
  },
  onPipelineEnd: async (result, totalDurationMs, context) => {
    console.log(`Pipeline completed in ${totalDurationMs}ms`);
  },
  onPipelineError: async (error, context) => {
    console.error("Pipeline failed:", error);
  },
};

const myPipeline = createAgentPipeline<InputType, OutputType>(
  {
    name: "my-pipeline",
    description: "A multi-step workflow",
    hooks: pipelineHooks,
  },
  [
    defineAgent({
      name: "step-1",
      description: "First step",
      inputSchema: Step1InputSchema,    // Optional Zod schema
      outputSchema: Step1OutputSchema,  // Optional Zod schema
      mapInput: (_prev, ctx: PipelineContext<InputType>) => ({
        data: ctx.initialInput.data,
      }),
      run: async (step, input, sessionId) => {
        return await myFirstAgent(step, input, sessionId);
      },
      // Optional: conditionally skip this agent
      shouldRun: async (previousOutput, context) => {
        return context.initialInput.shouldRunStep1;
      },
      skipResult: null, // Result to use when skipped
    }),
    defineAgent({
      name: "step-2",
      description: "Second step",
      mapInput: (_prev, ctx: PipelineContext<InputType>) => ({
        previousResult: ctx.results["step-1"],
        originalData: ctx.initialInput.data,
      }),
      run: async (step, input, sessionId) => {
        return await mySecondAgent(step, input, sessionId);
      },
    }),
  ],
);

// Validate pipeline before running
const validation = validatePipeline(myPipeline.config, myPipeline.agents);
if (!validation.valid) {
  console.error("Pipeline errors:", validation.errors);
}
if (validation.warnings.length > 0) {
  console.warn("Pipeline warnings:", validation.warnings);
}

// Execute the pipeline
const result = await myPipeline.run(step, initialInput, sessionId);
```

#### Pipeline Error Recovery

The `onAgentError` hook can return different recovery actions:

```typescript
onAgentError: async (error, context) => {
  // Re-throw the error (default)
  return { action: "throw" };
  
  // Skip this agent, optionally provide a result
  return { action: "skip", result: { fallback: true } };
  
  // Retry the agent (not yet implemented)
  return { action: "retry", maxRetries: 3 };
  
  // Abort pipeline and return immediately
  return { action: "abort", result: { aborted: true, reason: error.error.message } };
}
```

### 6. Human-in-the-Loop (`askUser`)

Pause execution to ask the user questions.

```typescript
import { askUser, askUserWithMetadata, formatAnswersAsContext, validateStepId } from "./ai/questions";

// Validate stepId before use
const stepIdCheck = validateStepId("my-step-id");
if (!stepIdCheck.valid) {
  console.warn(stepIdCheck.warning);
}

const answers = await askUser(step, {
  questions: [
    "What is the target audience?",
    "What problem does this solve?",
  ],
  sessionId: "session-123",
  stepId: "my-agent-wait-for-answers", // MUST be deterministic!
  timeout: "1h",
  eventName: "my.answers.event", // default: "user.answers.provided"
  // Callback when questions are ready for UI
  onQuestionsReady: async (questions, sessionId) => {
    await broadcastToSession(sessionId, { type: "questions", questions });
  },
  requireAllAnswers: false, // If true, throws on missing answers
});

// Or get detailed metadata about answers
const result = await askUserWithMetadata(step, options);
// result = { answers, complete: boolean, unanswered: string[], questions: string[] }

// Format answers for use in prompts
const context = formatAnswersAsContext(answers, {
  questionPrefix: "Q: ",
  answerPrefix: "A: ",
  separator: "\n\n",
  skipEmpty: true,
});
```

**CRITICAL:** The `stepId` must be a deterministic string. Never use `Math.random()` or `Date.now()`. Inngest replays functions from the beginning when resuming, so non-deterministic IDs break replay.

### 7. Parallel Agent Execution

Run multiple agents concurrently.

```typescript
import { runAgentsInParallel } from "./ai/pipeline";

const results = await runAgentsInParallel(
  step,
  [
    { name: "agent-a", run: agentA },
    { name: "agent-b", run: agentB },
    { name: "agent-c", run: agentC },
  ],
  sharedInput,
  sessionId,
);

// results = { "agent-a": resultA, "agent-b": resultB, "agent-c": resultC }
```

**Note:** While this uses `Promise.all()`, Inngest steps within each agent still execute sequentially. For true parallelism, use `step.invoke()` with separate Inngest functions.

### 8. Lifecycle Hooks

Monitor agent execution with hooks.

```typescript
import type { AgentHooks, AgentContext, AgentMetrics, LLMMessage } from "./ai/types";

const hooks: AgentHooks<MyResultType> = {
  onStart: async (ctx: AgentContext) => {
    console.log(`Agent ${ctx.name} started (runId: ${ctx.runId})`);
  },
  onLLMStart: async (ctx, messages: LLMMessage[]) => {
    console.log(`LLM call starting, ${messages.length} messages`);
  },
  onLLMEnd: async (ctx, response) => {
    console.log(`LLM call completed, hasToolCalls: ${response.hasToolCalls}`);
  },
  onToolStart: async (ctx, toolName, args) => {
    console.log(`Tool ${toolName} starting with args:`, args);
  },
  onToolEnd: async (ctx, toolName, result, durationMs) => {
    console.log(`Tool ${toolName} completed in ${durationMs}ms`);
  },
  onToolError: async (ctx, toolName, error) => {
    console.error(`Tool ${toolName} failed:`, error.message);
  },
  onComplete: async (ctx, result, metrics: AgentMetrics) => {
    console.log(`Agent completed`, metrics);
  },
  onError: async (ctx, error) => {
    console.error(`Agent failed:`, error.message);
  },
};
```

### 9. Streaming Manager

Manage streaming messages programmatically.

```typescript
import {
  StreamingManager,
  globalStreamingManager,
  createLLMResponseMessage,
  createToolStartMessage,
} from "./ai/streaming";

// Use the global instance
globalStreamingManager.setBroadcaster((sessionId, message) => {
  websocket.broadcast(sessionId, message);
});

// Or create your own instance
const streaming = new StreamingManager();

// Add messages
streaming.addMessage("session-123", createLLMResponseMessage(
  "my-agent",
  "Hello, world!",
  1,
  { streaming: true }
));

// Query messages
const messages = streaming.getMessages("session-123");
const count = streaming.getMessageCount("session-123");
const hasMessages = streaming.hasMessages("session-123");

// Clear messages
streaming.clearMessages("session-123");
```

### 10. Metrics Collection

Track agent execution metrics.

```typescript
import { AgentMetricsCollector, formatMetricsSummary, calculateAverageMetrics } from "./ai/metrics";

const collector = new AgentMetricsCollector();

// Record metrics
collector.recordLLMCall();
collector.recordToolCall("search", 150); // toolName, durationMs

// Get metrics
const metrics = collector.getMetrics();
// { totalDurationMs, llmCalls, toolCalls, toolDurations }

// Format for logging
const summary = formatMetricsSummary(metrics);
// "Duration: 1.50s | LLM calls: 2 | Tool calls: 3 (search: 150ms, fetch: 200ms)"

// Calculate averages across multiple runs
const avgMetrics = calculateAverageMetrics([metrics1, metrics2, metrics3]);
```

### 11. Pipeline Transitions (Advanced)

For complex workflows with conditional routing.

```typescript
import {
  linearTransition,
  branchTransition,
  conditionalTransition,
  executeTransition,
} from "./ai/pipeline";

// Linear: single next step
const linear = linearTransition("next-agent");

// Branch: multiple parallel steps
const branch = branchTransition(["agent-a", "agent-b", "agent-c"]);

// Conditional: route based on result
const conditional = conditionalTransition<MyResult>(
  [
    { condition: (result) => result.score > 80, to: "high-priority" },
    { condition: (result) => result.score > 50, to: "medium-priority" },
  ],
  "low-priority", // default
);

// Execute transition (use step.invoke or step.sendEvent)
await executeTransition(step, transition, result, functionRefs);
```

## Type Reference

### Core Types

```typescript
// Message types
type LLMMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCallResponse[];
  toolCallId?: string;
};

// LLM configuration
type LLMConfig = {
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
  tools?: FunctionDefinition[];
};

// Prompt with templating (variables accept any JSON-serializable value)
type Prompt = {
  messages: PromptMessage[];
  variables: Record<string, unknown>;
};

// Agent metadata for UI
type AgentMetadata = {
  workflowStep?: string;
  displayName?: string;
  icon?: string;
  description?: string;
};

// Metrics from agent execution
type AgentMetrics = {
  totalDurationMs: number;
  llmCalls: number;
  toolCalls: number;
  toolDurations: Record<string, number>;
  tokens?: { prompt: number; completion: number; total: number };
};

// Agent context provided to hooks
type AgentContext = {
  name: string;
  runId: string;
  iteration: number;
  metadata?: AgentMetadata;
  sessionId?: string;
};
```

### Tool Types

```typescript
type PreCallTool = {
  type: "pre-call";
  name: string;
  description: string;
  execute: () => Promise<Record<string, string>> | Record<string, string>;
};

type PostCallTool = {
  type: "post-call";
  name: string;
  description: string;
  parameters: PostCallToolParameter[];
  execute: (args: Record<string, any>, context?: ToolExecutionContext) => Promise<any> | any;
};

type PostCallToolParameter = {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required?: boolean;
};

type ToolExecutionContext = {
  reportProgress: (message: string) => void | Promise<void>;
  agentName: string;
  iteration: number;
};
```

### Pipeline Types

```typescript
type PipelineContext<TInput = unknown, TResults = Record<string, unknown>> = {
  initialInput: TInput;
  results: TResults;  // Results keyed by agent name
  sessionId?: string;
};

type AgentDefinition<TInput, TOutput, TPreviousOutput, TPipelineInput, TPipelineResults> = {
  name: string;
  description?: string;
  run: (step: StepTools, input: TInput, sessionId?: string) => Promise<TOutput>;
  inputSchema?: ZodType<TInput>;
  outputSchema?: ZodType<TOutput>;
  mapInput?: (previousOutput: TPreviousOutput, context: PipelineContext<TPipelineInput, TPipelineResults>) => TInput;
  shouldRun?: (previousOutput: unknown, context: PipelineContext) => boolean | Promise<boolean>;
  skipResult?: unknown;
};

type PipelineHooks<TInput, TOutput> = {
  onPipelineStart?: (input: TInput, sessionId?: string) => void | Promise<void>;
  onAgentStart?: (agentName: string, agentIndex: number, input: unknown, context: PipelineContext<TInput>) => void | Promise<void>;
  onAgentEnd?: (agentName: string, agentIndex: number, result: unknown, durationMs: number, context: PipelineContext<TInput>) => void | Promise<void>;
  onAgentError?: (error: PipelineError, context: PipelineContext<TInput>) => ErrorRecoveryResult | undefined | Promise<ErrorRecoveryResult | undefined>;
  onPipelineEnd?: (result: TOutput, totalDurationMs: number, context: PipelineContext<TInput>) => void | Promise<void>;
  onPipelineError?: (error: Error, context: PipelineContext<TInput>) => void | Promise<void>;
};

type ErrorRecoveryResult =
  | { action: "throw" }
  | { action: "skip"; result?: unknown }
  | { action: "retry"; maxRetries?: number }
  | { action: "abort"; result: unknown };
```

### Streaming Types

```typescript
type StreamMessage =
  | LLMResponseMessage
  | FinalResponseMessage
  | ToolStartMessage
  | ToolProgressMessage
  | ToolResultMessage
  | ToolErrorMessage;

type LLMResponseMessage = {
  type: "llm_response";
  content: string;
  agentName: string;
  iteration: number;
  streaming: boolean;
  hasToolCalls?: boolean;
  metadata?: AgentMetadata;
  timestamp: number;
};

// ... other message types follow similar pattern
```

## Common Patterns

### Pattern 1: Simple Agent

```typescript
export async function simpleAgent(
  step: StepTools,
  input: string,
  sessionId?: string,
): Promise<string> {
  const provider = await createLLMClient({
    type: "anthropic",
    apiKey: process.env.ANTHROPIC_API_KEY!,
  });

  return await runAgent<string>({
    step,
    name: "simple-agent",
    provider,
    prompt: {
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "{{input}}" },
      ],
      variables: { input },
    },
    config: {
      model: "claude-haiku-4-5-20251001",
      temperature: 0.7,
      maxTokens: 1000,
    },
    streaming: sessionId ? { sessionId } : undefined,
    fn: (response) => response,
  });
}
```

### Pattern 2: Agent with JSON Response and Validation

```typescript
import { z } from "zod";

const ResultSchema = z.object({
  recommendation: z.enum(["yes", "no"]),
  score: z.number().min(1).max(10),
  reasoning: z.string(),
});

type Result = z.infer<typeof ResultSchema>;

export async function analyzingAgent(
  step: StepTools,
  data: string,
  sessionId?: string,
): Promise<Result> {
  const provider = await createLLMClient({
    type: "anthropic",
    apiKey: process.env.ANTHROPIC_API_KEY!,
  });

  return await runAgent<Result>({
    step,
    name: "analyzing-agent",
    provider,
    prompt: {
      messages: [
        {
          role: "system",
          content: `Analyze the data and respond in JSON:
{
  "recommendation": "yes" or "no",
  "score": 1-10,
  "reasoning": "explanation"
}`,
        },
        { role: "user", content: "Analyze: {{data}}" },
      ],
      variables: { data },
    },
    config: {
      model: "claude-haiku-4-5-20251001",
      temperature: 0.5,
      maxTokens: 1000,
    },
    resultSchema: ResultSchema,
    fn: (response) => {
      // Handle markdown code blocks
      let clean = response.trim();
      if (clean.startsWith("```json")) {
        clean = clean.replace(/^```json\s*\n?/, "").replace(/\n?```\s*$/, "");
      }
      return JSON.parse(clean);
    },
  });
}
```

### Pattern 3: Agent with Tools

```typescript
import { validateTools } from "./ai/tools";

const tools: Tool[] = [
  {
    type: "pre-call",
    name: "getTimestamp",
    description: "Get current timestamp",
    execute: () => ({ timestamp: new Date().toISOString() }),
  },
  {
    type: "post-call",
    name: "lookupData",
    description: "Look up data by ID",
    parameters: [
      { name: "id", type: "string", description: "The ID to look up", required: true },
    ],
    execute: async (args, context) => {
      context?.reportProgress?.(`Looking up ID: ${args.id}`);
      return { found: true, data: { id: args.id, value: "example" } };
    },
  },
];

// Validate tools before use
validateTools(tools);

const result = await runAgent({
  step,
  name: "tool-agent",
  provider,
  prompt,
  config,
  tools,
  maxIterations: 5, // Limit tool-calling iterations
  fn: (response) => JSON.parse(response),
});
```

### Pattern 4: Inngest Function with Pipeline

```typescript
import { inngest } from "./inngest/client";
import { myPipeline } from "./pipelines";

export const myFunction = inngest.createFunction(
  { id: "my-workflow" },
  { event: "workflow.start" },
  async ({ event, step }) => {
    const { input, sessionId } = event.data;

    const result = await myPipeline.run(step, input, sessionId);

    return {
      success: true,
      result,
      completedAt: new Date().toISOString(),
    };
  },
);
```

### Pattern 5: Pipeline with Error Recovery

```typescript
const pipeline = createAgentPipeline(
  {
    name: "resilient-pipeline",
    hooks: {
      onAgentError: async (error, context) => {
        // Log the error
        console.error(`Agent ${error.agentName} failed:`, error.error);
        
        // Skip non-critical agents
        if (error.agentName === "optional-enrichment") {
          return { action: "skip", result: { enriched: false } };
        }
        
        // Abort on critical failures
        if (error.agentName === "validation") {
          return { 
            action: "abort", 
            result: { 
              success: false, 
              error: error.error.message 
            } 
          };
        }
        
        // Default: re-throw
        return { action: "throw" };
      },
    },
  },
  agents,
);
```

## Gotchas and Best Practices

1. **Always use deterministic step IDs for `askUser()`** - Non-deterministic IDs break Inngest replay.

2. **The `fn` parameter transforms the raw LLM response** - Handle markdown code blocks in JSON responses.

3. **Pre-call tools return variables for prompt hydration** - The returned object keys become `{{variables}}`.

4. **Post-call tool parameters must have valid types** - Only `"string" | "number" | "boolean" | "object" | "array"`.

5. **Pipeline `mapInput` has access to all previous results** - Use `ctx.results["agent-name"]` to access them.

6. **Default max 10 iterations in tool calling loop** - Configure via `maxIterations` parameter.

7. **Streaming requires a `sessionId`** - Without it, streaming is disabled.

8. **Each `runAgent` call generates unique step names** - Uses `${name}-${runId}` pattern internally.

9. **Agents in pipelines run sequentially** - Use `runAgentsInParallel()` for concurrent execution.

10. **Zod schemas are optional but recommended** - They provide runtime validation and better error messages.

11. **Validate tools before use** - Use `validateTools()` to catch configuration errors early.

12. **Use pipeline hooks for observability** - Track agent execution, handle errors, and log metrics.

13. **Prompt variables now accept any JSON-serializable value** - Objects and arrays are automatically stringified.

14. **All providers support tool calling** - OpenAI, Anthropic, Gemini, Grok, and Azure OpenAI all have consistent tool support.

15. **Use `shouldRun` for conditional agents** - Skip agents based on previous results or pipeline context.
