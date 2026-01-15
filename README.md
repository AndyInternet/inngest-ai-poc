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

An agent is a single LLM interaction wrapped in Inngest steps for durability:

```typescript
const result = await runAgent({
  step,              // Inngest step tools
  name: "analyzer",  // Agent name
  provider,          // LLM provider
  prompt,            // Templated prompt
  config,            // Model settings
  tools,             // Optional tools
  fn: (r) => r,      // Response transformer
  maxIterations: 10, // Max tool-calling iterations
  hooks: {           // Lifecycle hooks
    onStart: (ctx) => console.log("Started"),
    onComplete: (ctx, result, metrics) => console.log("Done"),
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

#### Pipeline Transitions (Advanced)

Transitions are for triggering *separate Inngest functions* at the end of a workflow. Unlike `runAgentsInParallel`, transitions are fire-and-forget - the current workflow exits and new independent workflows begin. Use this for event-driven architectures where workflows chain together.

```typescript
import {
  linearTransition,
  fanOutTransition,
  conditionalTransition,
  executeTransition,
} from "./ai/pipeline";

// Linear: trigger a single follow-up workflow
const linear = linearTransition("send-notification");

// Fan-out: trigger multiple independent workflows (fire-and-forget)
// Each runs as its own Inngest function - we don't wait for results
const fanOut = fanOutTransition([
  "notify-slack",    // Runs independently
  "send-email",      // Runs independently  
  "update-analytics" // Runs independently
]);

// Conditional: route to different workflows based on result
const conditional = conditionalTransition<AnalysisResult>(
  [
    { condition: (r) => r.priority === "critical", to: "escalate-to-oncall" },
    { condition: (r) => r.priority === "high", to: "create-ticket" },
    { condition: (r) => r.needsReview, to: "queue-for-review" },
  ],
  "archive", // default if no conditions match
);

// Execute at the end of an Inngest function to trigger next workflow(s)
await executeTransition(step, conditional, result, functionRefs);
```

**When to use each:**
| Use Case | Solution |
|----------|----------|
| Run agents in parallel, wait for all results, continue | `runAgentsInParallel` |
| Trigger separate workflow(s) and exit | Transitions (`linearTransition`, `fanOutTransition`, `conditionalTransition`) |

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

- Multi-agent pipeline (gather context -> analyze -> report)
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
│   ├── pipeline.ts     # Pipelines, hooks, transitions
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

### `createAgentPipeline(config, agents): AgentPipeline`

Create a sequential agent pipeline with hooks.

### `defineAgent(config): AgentDefinition`

Define an agent for use in pipelines.

### `validatePipeline(config, agents): PipelineValidationResult`

Validate pipeline configuration.

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
