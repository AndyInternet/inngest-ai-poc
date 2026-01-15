# Inngest AI Library

A TypeScript library for building **durable AI agent workflows** with [Inngest](https://inngest.com). Build multi-step AI pipelines that automatically retry, checkpoint, and scale.

## Why This Library?

Building production AI agents is hard. You need:
- **Durability** - What happens when your LLM call fails mid-workflow?
- **Observability** - How do you debug a 5-step agent pipeline?
- **Streaming** - How do you show real-time progress to users?
- **Tool Calling** - How do you let agents use external tools reliably?

This library solves all of these by building on Inngest's durable execution model.

## Features

- **Multi-Provider LLM Support** - OpenAI, Anthropic, Gemini, Grok, Azure OpenAI (all with tool calling)
- **Automatic Retries** - Failed LLM calls retry automatically
- **Tool Calling** - Pre-call and post-call tools with progress reporting
- **Agent Pipelines** - Chain agents with lifecycle hooks and error recovery
- **Human-in-the-Loop** - Pause workflows to ask users questions
- **Real-time Streaming** - Stream LLM responses via WebSocket
- **Type Safety** - Full TypeScript support with Zod validation
- **Comprehensive Validation** - Validate tools, prompts, and pipelines

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Environment Variables

```env
ANTHROPIC_API_KEY=sk-ant-...
# Or use other providers:
# OPENAI_API_KEY=sk-...
# GOOGLE_API_KEY=...
```

### 3. Start Development Servers

```bash
# Terminal 1: Start Inngest dev server
npx inngest-cli@latest dev

# Terminal 2: Start your app
npm run dev
```

### 4. Build Your First Agent

```typescript
import { runAgent } from "./ai/agent";
import { createLLMClient } from "./ai/providers";

export async function myAgent(step, userInput, sessionId) {
  const provider = await createLLMClient({
    type: "anthropic",
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  return await runAgent({
    step,
    name: "my-agent",
    provider,
    prompt: {
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "{{input}}" },
      ],
      variables: { input: userInput },
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

### 5. Create an Inngest Function

```typescript
import { inngest } from "./inngest/client";
import { myAgent } from "./agents";

export const myFunction = inngest.createFunction(
  { id: "my-ai-workflow" },
  { event: "ai.workflow.start" },
  async ({ event, step }) => {
    const result = await myAgent(step, event.data.input, event.data.sessionId);
    return { success: true, result };
  },
);
```

### 6. Trigger the Workflow

```typescript
await inngest.send({
  name: "ai.workflow.start",
  data: { input: "Hello, world!", sessionId: "user-123" },
});
```

## Core Concepts

### Agents

An agent is a single LLM interaction wrapped in Inngest steps for durability. The `runAgent()` function handles retries, tool calling loops, streaming, and validation automatically.

```typescript
const result = await runAgent({
  // Required parameters
  step,                    // Inngest step tools for durability
  name: "analyzer",        // Unique agent name (used for step naming)
  provider,                // LLM provider instance
  prompt,                  // Templated prompt with variables
  config,                  // Model configuration
  fn: (response) => response, // Transform raw LLM response to result type

  // Optional parameters
  tools,                   // Pre-call and post-call tools
  streaming,               // Real-time streaming configuration
  metadata,                // UI display metadata
  resultSchema,            // Zod schema for result validation
  hooks,                   // Lifecycle hooks for observability
  maxIterations,           // Max tool-calling loop iterations (default: 10)
  runId,                   // Deterministic run ID for step naming
});
```

#### Agent Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `step` | `StepTools` | Yes | Inngest step tools that provide durability. Each LLM call and tool execution is wrapped in a step for automatic retries and checkpointing. |
| `name` | `string` | Yes | Unique identifier for the agent. Used for step naming, logging, and streaming messages. |
| `provider` | `LLMProvider` | Yes | LLM provider instance created via `createLLMClient()`. Supports OpenAI, Anthropic, Gemini, Grok, and Azure OpenAI. |
| `prompt` | `Prompt` | Yes | Prompt object containing `messages` array and `variables` object. Uses Mustache templating (`{{variable}}`). |
| `config` | `LLMConfig` | Yes | Model configuration including `model`, `temperature`, `maxTokens`, and `topP`. |
| `fn` | `(response: string) => T` | Yes | Transform function that converts the raw LLM string response into your desired result type. Handle JSON parsing and markdown code blocks here. |
| `tools` | `Tool[]` | No | Array of pre-call and post-call tools. Pre-call tools run before the LLM call to populate prompt variables. Post-call tools can be invoked by the LLM during execution. |
| `streaming` | `StreamingConfig` | No | Enable real-time streaming. Requires `sessionId`. Optional `onChunk`, `onComplete` callbacks and `interval` (ms). |
| `metadata` | `AgentMetadata` | No | UI display metadata including `workflowStep`, `displayName`, `icon`, and `description`. Passed to streaming messages and hooks. |
| `resultSchema` | `ZodType<T>` | No | Zod schema to validate the transformed result. Throws if validation fails. |
| `hooks` | `AgentHooks<T>` | No | Lifecycle hooks for observability: `onStart`, `onLLMStart`, `onLLMEnd`, `onToolStart`, `onToolEnd`, `onToolError`, `onComplete`, `onError`. |
| `maxIterations` | `number` | No | Maximum iterations for tool-calling loops (default: 10). Prevents infinite loops when LLM keeps calling tools. |
| `runId` | `string` | No | Deterministic run ID for step naming. If not provided, a unique ID is generated. Use this when you need reproducible step names. |

#### Metadata

The `metadata` parameter provides context for UI display and tracking:

```typescript
const result = await runAgent({
  // ...required params
  metadata: {
    workflowStep: "analysis",      // Pipeline stage identifier
    displayName: "Feature Analysis", // Human-readable name for UI
    icon: "chart",                 // Icon identifier for UI
    description: "Evaluating feasibility and impact", // Status description
  },
});
```

Metadata is included in streaming messages and passed to lifecycle hooks, making it useful for building real-time dashboards and progress indicators.

#### Streaming Configuration

Enable real-time streaming to send LLM responses to clients as they're generated:

```typescript
const result = await runAgent({
  // ...required params
  streaming: {
    sessionId: "user-123",         // Required: identifies the client session
    onChunk: (chunk, full) => {},  // Optional: called for each chunk
    onComplete: (result) => {},    // Optional: called when complete
    interval: 50,                  // Optional: broadcast interval in ms
  },
});
```

#### Complete Example

```typescript
import { runAgent } from "./ai/agent";
import { createLLMClient } from "./ai/providers";
import { z } from "zod";

const ResultSchema = z.object({
  score: z.number(),
  recommendation: z.string(),
});

const provider = await createLLMClient({
  type: "anthropic",
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const result = await runAgent({
  step,
  name: "feature-scorer",
  provider,
  prompt: {
    messages: [
      { role: "system", content: "Score features from 1-10. Respond in JSON." },
      { role: "user", content: "Evaluate: {{feature}}" },
    ],
    variables: { feature: "Dark mode support" },
  },
  config: {
    model: "claude-haiku-4-5-20251001",
    temperature: 0.7,
    maxTokens: 1000,
  },
  metadata: {
    workflowStep: "scoring",
    displayName: "Feature Scoring",
    icon: "star",
    description: "Scoring the feature request",
  },
  resultSchema: ResultSchema,
  streaming: sessionId ? { sessionId } : undefined,
  hooks: {
    onComplete: (ctx, result, metrics) => {
      console.log(`${ctx.name} completed in ${metrics.totalDurationMs}ms`);
    },
  },
  fn: (response) => {
    // Handle markdown code blocks in JSON responses
    let clean = response.trim();
    if (clean.startsWith("```json")) {
      clean = clean.replace(/^```json\s*\n?/, "").replace(/\n?```\s*$/, "");
    }
    return JSON.parse(clean);
  },
});
```

### Prompts

Use Mustache templating for dynamic prompts:

```typescript
import { hydratePrompt, validatePromptVariables } from "./ai/prompt";

const prompt = {
  messages: [
    { role: "system", content: "You are a {{role}}." },
    { role: "user", content: "Analyze: {{data}}" },
  ],
  variables: {
    role: "data analyst",
    data: "Q4 sales figures",
  },
};

// Validate before use
const validation = validatePromptVariables(prompt);
if (!validation.valid) {
  console.warn("Missing:", validation.missing);
}

// Hydrate with warnings enabled
const messages = hydratePrompt(prompt, { warnOnMissingVars: true });
```

### Tools

**Pre-call tools** run before the LLM call to populate prompt variables:

```typescript
const dateTool = {
  type: "pre-call",
  name: "getDate",
  description: "Get current date",
  execute: () => ({ today: new Date().toISOString().split("T")[0] }),
};
```

**Post-call tools** let the LLM call external functions:

```typescript
const searchTool = {
  type: "post-call",
  name: "search",
  description: "Search the database",
  parameters: [
    { name: "query", type: "string", description: "Search query", required: true },
  ],
  execute: async (args, context) => {
    context?.reportProgress?.("Searching...");
    return await db.search(args.query);
  },
};
```

**Validate tools** before use:

```typescript
import { validateTools, ToolValidationError } from "./ai/tools";

try {
  validateTools(myTools);
} catch (e) {
  if (e instanceof ToolValidationError) {
    console.error("Tool errors:", e.details);
  }
}
```

### Pipelines

Chain multiple agents with lifecycle hooks and error recovery:

```typescript
import { createAgentPipeline, defineAgent } from "./ai/pipeline";

const pipeline = createAgentPipeline(
  {
    name: "analysis-pipeline",
    hooks: {
      onAgentStart: (name, index) => console.log(`Starting ${name}`),
      onAgentEnd: (name, index, result, ms) => console.log(`${name} done in ${ms}ms`),
      onAgentError: (error, context) => {
        console.error(`${error.agentName} failed:`, error.error);
        // Skip failed agent with fallback result
        return { action: "skip", result: null };
      },
    },
  },
  [
    defineAgent({
      name: "gather-data",
      mapInput: (_, ctx) => ({ query: ctx.initialInput.query }),
      run: gatherDataAgent,
    }),
    defineAgent({
      name: "analyze",
      mapInput: (_, ctx) => ({
        data: ctx.results["gather-data"],
        query: ctx.initialInput.query,
      }),
      run: analyzeAgent,
      // Conditionally skip this agent
      shouldRun: (prev, ctx) => ctx.initialInput.needsAnalysis,
      skipResult: { skipped: true },
    }),
    defineAgent({
      name: "report",
      mapInput: (_, ctx) => ({ analysis: ctx.results["analyze"] }),
      run: reportAgent,
    }),
  ],
);

// Run the entire pipeline
const result = await pipeline.run(step, { query: "user request" }, sessionId);
```

#### Parallel Agent Execution

Run multiple agents concurrently *within the same workflow* when they don't depend on each other. All agents execute in parallel, and execution waits for all to complete before continuing. Use this when you need combined results from multiple agents.

```typescript
import { runAgentsInParallel } from "./ai/pipeline";

// Example: Analyze a document from multiple angles simultaneously
const results = await runAgentsInParallel(
  step,
  [
    { name: "sentiment-analysis", run: sentimentAgent },
    { name: "keyword-extraction", run: keywordAgent },
    { name: "summarization", run: summaryAgent },
  ],
  { text: documentText },
  sessionId,
);

// All agents have completed - access results by agent name
const report = {
  sentiment: results["sentiment-analysis"],  // { score: 0.8, label: "positive" }
  keywords: results["keyword-extraction"],   // ["AI", "agents", "pipelines"]
  summary: results["summarization"],         // "This document discusses..."
};
```

#### Conditional Branching

Route pipeline execution to different agent sequences based on results. Use `defineBranch` to create fork points where different paths can be taken:

```typescript
import { createAgentPipeline, defineAgent, defineBranch } from "./ai/pipeline";

const pipeline = createAgentPipeline(
  { name: "support-routing" },
  [
    // First, classify the request
    defineAgent({
      name: "classifier",
      run: classifierAgent,
    }),

    // Branch based on classification result
    defineBranch({
      name: "handler-branch",
      condition: (prev) => prev.category, // Returns "technical" | "billing" | "general"
      branches: {
        technical: [
          defineAgent({ name: "tech-lookup", run: techLookupAgent }),
          defineAgent({ name: "tech-response", run: techResponseAgent }),
        ],
        billing: [
          defineAgent({ name: "billing-lookup", run: billingLookupAgent }),
          defineAgent({ name: "billing-response", run: billingResponseAgent }),
        ],
        general: [
          defineAgent({ name: "general-response", run: generalResponseAgent }),
        ],
      },
      defaultBranch: "general", // Fallback if condition returns unknown key
    }),

    // Continue after branch converges
    defineAgent({
      name: "finalizer",
      run: finalizerAgent,
    }),
  ],
);

const result = await pipeline.run(step, { userMessage }, sessionId);
```

**Key points:**
- Each branch contains its own sequence of agents (or nested branches)
- Results from branch agents are stored in `context.results` by agent name
- The branch result (last agent's output) is passed to the next step
- Use `defaultBranch` to handle unexpected condition values

#### Nested Branching

Branches can be nested inside other branches for complex routing logic:

```typescript
const pipeline = createAgentPipeline(
  { name: "nested-routing" },
  [
    defineAgent({ name: "initial-classifier", run: classifierAgent }),

    defineBranch({
      name: "primary-branch",
      condition: (prev) => prev.mainCategory,
      branches: {
        support: [
          defineAgent({ name: "support-classifier", run: supportClassifier }),
          // Nested branch within the "support" branch
          defineBranch({
            name: "support-type-branch",
            condition: (prev) => prev.supportType,
            branches: {
              technical: [
                defineAgent({ name: "tech-agent", run: techAgent }),
              ],
              billing: [
                defineAgent({ name: "billing-agent", run: billingAgent }),
              ],
            },
            defaultBranch: "technical",
          }),
        ],
        sales: [
          defineAgent({ name: "sales-agent", run: salesAgent }),
        ],
      },
      defaultBranch: "support",
    }),

    defineAgent({ name: "finalizer", run: finalizerAgent }),
  ],
);
```

Nested branches allow you to model complex decision trees where the routing logic depends on multiple classification steps.

### Human-in-the-Loop

Pause execution to ask users questions:

```typescript
import { askUser, askUserWithMetadata } from "./ai/questions";

const answers = await askUser(step, {
  questions: ["What is your budget?", "What's the timeline?"],
  sessionId: "user-123",
  stepId: "budget-questions", // Must be deterministic!
  timeout: "1h",
  // Notify UI when questions are ready
  onQuestionsReady: async (questions, sessionId) => {
    await broadcast(sessionId, { type: "questions", questions });
  },
});

// Or get detailed metadata
const result = await askUserWithMetadata(step, options);
// result = { answers, complete, unanswered, questions }
```

### Schema Validation

Validate LLM responses with Zod:

```typescript
import { z } from "zod";

const ResultSchema = z.object({
  recommendation: z.enum(["approve", "reject"]),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

const result = await runAgent({
  // ...other options
  resultSchema: ResultSchema,
  fn: (response) => JSON.parse(response),
});
// Result is typed and validated
```

### Lifecycle Hooks

Monitor agent execution:

```typescript
const hooks = {
  onStart: (ctx) => console.log(`${ctx.name} started (run: ${ctx.runId})`),
  onLLMStart: (ctx, messages) => console.log("LLM call starting"),
  onLLMEnd: (ctx, response) => console.log("LLM call completed"),
  onToolStart: (ctx, tool, args) => console.log(`Tool ${tool} starting`),
  onToolEnd: (ctx, tool, result, ms) => console.log(`Tool ${tool} done in ${ms}ms`),
  onToolError: (ctx, tool, error) => console.error(`Tool ${tool} failed`),
  onComplete: (ctx, result, metrics) => console.log("Agent completed", metrics),
  onError: (ctx, error) => console.error("Agent failed", error),
};
```

### Metrics Collection

Track performance metrics:

```typescript
import { AgentMetricsCollector, formatMetricsSummary } from "./ai/metrics";

// Metrics are automatically collected and passed to onComplete hook
const hooks = {
  onComplete: (ctx, result, metrics) => {
    console.log(formatMetricsSummary(metrics));
    // "Duration: 1.50s | LLM calls: 2 | Tool calls: 3 (search: 150ms)"
  },
};
```

### Streaming

Manage real-time streaming:

```typescript
import { globalStreamingManager } from "./ai/streaming";

// Set up broadcaster
globalStreamingManager.setBroadcaster((sessionId, message) => {
  websocket.send(sessionId, message);
});

// Query messages
const messages = globalStreamingManager.getMessages("session-123");
```

## LLM Providers

### Supported Providers

| Provider | Type | Tool Calling |
|----------|------|--------------|
| OpenAI | `openai` | Full support |
| Anthropic | `anthropic` | Full support |
| Google | `gemini` | Full support |
| xAI | `grok` | Full support |
| Azure OpenAI | `azure-openai` | Full support |

### Configuration

```typescript
// OpenAI
const provider = await createLLMClient({
  type: "openai",
  apiKey: process.env.OPENAI_API_KEY,
});

// Anthropic
const provider = await createLLMClient({
  type: "anthropic",
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Gemini
const provider = await createLLMClient({
  type: "gemini",
  apiKey: process.env.GOOGLE_API_KEY,
});

// Azure OpenAI
const provider = await createLLMClient({
  type: "azure-openai",
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  baseUrl: process.env.AZURE_OPENAI_ENDPOINT,
});
```

## Complete Example

See `src/examples/feature-validation/` for a full working example that demonstrates:

- Multi-agent pipeline (evaluate context -> ask questions -> analyze -> report)
- Conditional agent execution with `shouldRun`
- Pre-call and post-call tools
- Human-in-the-loop questions
- Zod schema validation
- Real-time streaming
- Lifecycle hooks
- Error recovery

```typescript
// Run the feature validation pipeline
const report = await featureValidationPipeline.run(
  step,
  {
    featureDescription: "Add dark mode support",
    existingContext: "B2B SaaS platform for project management",
  },
  sessionId,
);
```

## Project Structure

```
src/
├── ai/
│   ├── agent.ts        # runAgent() - core execution
│   ├── streaming.ts    # StreamingManager class
│   ├── metrics.ts      # AgentMetricsCollector class
│   ├── pipeline.ts     # Pipelines, hooks, parallel execution
│   ├── prompt.ts       # Mustache templating + validation
│   ├── questions.ts    # Human-in-the-loop
│   ├── tools.ts        # Tool utilities + validation
│   ├── types.ts        # TypeScript types
│   └── providers/
│       ├── index.ts        # Factory function
│       ├── openai-base.ts  # Base class for OpenAI-compatible
│       ├── openai.ts       # OpenAI provider
│       ├── anthropic.ts    # Anthropic provider
│       ├── gemini.ts       # Google Gemini provider
│       ├── grok.ts         # xAI Grok provider
│       └── azure-openai.ts # Azure OpenAI provider
├── examples/
│   └── feature-validation/
│       ├── agents.ts       # Individual agent functions
│       ├── hooks.ts        # Agent and pipeline lifecycle hooks
│       ├── pipelines.ts    # Pipeline definition + Inngest functions
│       ├── prompts.ts      # Prompt templates
│       ├── providers.ts    # LLM provider configuration
│       ├── schemas.ts      # Zod validation schemas
│       ├── tools.ts        # Pre-call and post-call tools
│       ├── utils.ts        # Utility functions
│       └── index.html      # Demo UI
└── inngest/
    ├── client.ts       # Inngest client
    └── functions.ts    # Function registry
```

## API Reference

### `runAgent<T>(params): Promise<T>`

Execute an LLM call with full durability.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `step` | `StepTools` | Yes | Inngest step tools |
| `name` | `string` | Yes | Agent name |
| `provider` | `LLMProvider` | Yes | LLM provider instance |
| `prompt` | `Prompt` | Yes | Templated prompt |
| `config` | `LLMConfig` | Yes | Model configuration |
| `fn` | `(response: string) => T` | Yes | Response transformer |
| `tools` | `Tool[]` | No | Pre-call and post-call tools |
| `streaming` | `StreamingConfig` | No | Streaming configuration |
| `metadata` | `AgentMetadata` | No | UI metadata |
| `resultSchema` | `ZodType<T>` | No | Result validation schema |
| `hooks` | `AgentHooks<T>` | No | Lifecycle hooks |
| `maxIterations` | `number` | No | Max tool loop iterations (default: 10) |
| `runId` | `string` | No | Deterministic run ID |

### `createLLMClient(config): Promise<LLMProvider>`

Create an LLM provider instance.

### `createAgentPipeline(config, steps): AgentPipeline`

Create a pipeline with agents and optional branches.

### `defineAgent(config): AgentDefinition`

Define an agent for use in pipelines.

### `defineBranch(config): BranchDefinition`

Define a conditional branch point in a pipeline. Routes execution to different agent sequences based on the condition function result.

### `validatePipeline(config, steps): PipelineValidationResult`

Validate pipeline configuration including branches.

### `askUser(step, options): Promise<Record<string, string>>`

Pause workflow to ask user questions.

### `askUserWithMetadata(step, options): Promise<AskUserResult>`

Ask questions with detailed result metadata.

### `runAgentsInParallel(step, agents, input, sessionId): Promise<Results>`

Execute multiple agents concurrently.

### `validateTools(tools, options): ValidateToolsResult`

Validate tool array for common issues.

### `hydratePrompt(prompt, options): LLMMessage[]`

Render prompt template with variables.

### `validatePromptVariables(prompt): ValidationResult`

Check for missing prompt variables.

## Development

```bash
# Start dev server with hot reload
npm run dev

# Type check
npx tsc --noEmit

# Build for production
npm run build

# Start production server
npm start
```

## License

ISC
