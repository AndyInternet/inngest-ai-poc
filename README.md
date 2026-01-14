# Inngest AI POC

An Express.js application with TypeScript and Inngest that provides a comprehensive framework for building AI-powered workflows with multi-provider LLM support, function calling, and declarative flow orchestration.

## Features

- **Express.js + TypeScript** - Type-safe REST API server
- **Inngest Integration** - Durable workflow execution with built-in retries
- **Multi-Provider LLM Support** - Unified interface for OpenAI, Anthropic, Gemini, Grok, and Azure OpenAI
- **Streaming Support** - Real-time LLM response streaming across all providers
- **Function Calling** - Built-in tool execution with pre-call and post-call hooks
- **Prompt Templating** - Mustache-based prompt hydration with variables
- **Declarative Flows** - Chain Inngest functions with linear, branching, and conditional transitions

## Installation

```bash
npm install
```

## Project Structure

```
src/
├── index.ts                    # Express server entry point
├── inngest/
│   ├── client.ts              # Inngest client instance
│   └── functions.ts           # Inngest functions array
└── ai/
    ├── agent.ts               # AI agent wrapper with step.run integration
    ├── prompt.ts              # Prompt templating system
    ├── tools.ts               # Pre-call and post-call tool definitions
    ├── flow.ts                # Flow orchestration for chaining functions
    └── providers/
        ├── index.ts           # LLM provider interface and factory
        ├── openai.ts          # OpenAI provider implementation
        ├── anthropic.ts       # Anthropic provider implementation
        ├── gemini.ts          # Google Gemini provider implementation
        ├── grok.ts            # Grok (xAI) provider implementation
        └── azure-openai.ts    # Azure OpenAI provider implementation
```

## Quick Start

### 1. Start the Development Server

```bash
npm run dev
```

The server runs on `http://localhost:3000` with the Inngest endpoint at `/api/inngest`.

### 2. Production Build

```bash
npm run build
npm start
```

## Core Components

### LLM Providers

Unified interface for multiple LLM providers with streaming and function calling support.

#### Creating a Provider

```typescript
import { createLLMClient } from './ai/providers';

const provider = await createLLMClient({
  type: 'openai',
  apiKey: process.env.OPENAI_API_KEY,
});
```

#### Supported Providers

- **OpenAI** - GPT-4, GPT-3.5, etc.
- **Anthropic** - Claude models
- **Gemini** - Google's Gemini models
- **Grok** - xAI's Grok models
- **Azure OpenAI** - Azure-hosted OpenAI models

#### Provider Interface

```typescript
interface LLMProvider {
  complete(messages: LLMMessage[], config: LLMConfig): Promise<LLMResponse>;
  stream(messages: LLMMessage[], config: LLMConfig): AsyncIterableIterator<LLMStreamChunk>;
}
```

### Prompt Templating

Create templated prompts with Mustache variables that get hydrated at runtime.

```typescript
import { hydratePrompt, Prompt } from './ai/prompt';

const prompt: Prompt = {
  messages: [
    { role: 'system', content: 'You are a {{role}}' },
    { role: 'user', content: 'Analyze {{data}}' }
  ],
  variables: {
    role: 'data analyst',
    data: 'sales figures for Q4'
  }
};

const messages = hydratePrompt(prompt);
// Results in:
// [
//   { role: 'system', content: 'You are a data analyst' },
//   { role: 'user', content: 'Analyze sales figures for Q4' }
// ]
```

### AI Agent with Tools

Wrap LLM calls in Inngest steps with support for pre-call and post-call tools.

```typescript
import { runAgent } from './ai/agent';
import { createLLMClient } from './ai/providers';

const result = await runAgent({
  step,
  name: 'analyze-data',
  provider: await createLLMClient({ type: 'openai', apiKey: '...' }),
  prompt: {
    messages: [
      { role: 'system', content: 'You are a data analyst' },
      { role: 'user', content: 'Analyze {{data}}' }
    ],
    variables: {
      data: 'Q4 sales data',
      currentTime: '2024-01-15' // Can be populated by pre-call tools
    }
  },
  config: {
    model: 'gpt-4',
    temperature: 0.7,
    maxTokens: 1000
  },
  tools: [
    // Pre-call tool: runs before LLM call to hydrate prompt variables
    {
      type: 'pre-call',
      name: 'getCurrentTime',
      description: 'Gets the current time',
      execute: async () => ({ currentTime: new Date().toISOString() })
    },
    // Post-call tool: LLM can call this during execution
    {
      type: 'post-call',
      name: 'queryDatabase',
      description: 'Query the database for information',
      parameters: [
        { name: 'query', type: 'string', description: 'SQL query', required: true }
      ],
      execute: async (args) => {
        // Execute database query
        return { rows: [] };
      }
    }
  ],
  fn: (response) => {
    // Process the LLM response
    return JSON.parse(response);
  }
});
```

### Tools System

#### Pre-Call Tools

Execute before the LLM call to populate prompt variables dynamically.

```typescript
const preCallTool: PreCallTool = {
  type: 'pre-call',
  name: 'fetchUserData',
  description: 'Fetch user data from database',
  execute: async () => {
    const user = await db.getUser();
    return {
      userName: user.name,
      userEmail: user.email
    };
  }
};
```

#### Post-Call Tools

LLM can invoke these tools during execution (function calling).

```typescript
const postCallTool: PostCallTool = {
  type: 'post-call',
  name: 'sendEmail',
  description: 'Send an email to a recipient',
  parameters: [
    { name: 'to', type: 'string', description: 'Email recipient', required: true },
    { name: 'subject', type: 'string', description: 'Email subject', required: true },
    { name: 'body', type: 'string', description: 'Email body', required: true }
  ],
  execute: async (args) => {
    await emailService.send(args.to, args.subject, args.body);
    return { success: true, messageId: '123' };
  }
};
```

The agent automatically handles the function calling loop:
1. LLM requests a tool call
2. Tool is executed with provided arguments
3. Result is sent back to LLM
4. Loop continues until LLM provides final response (max 10 iterations)

### Flow Orchestration

Chain Inngest functions together with declarative flows supporting linear, branching, and conditional transitions.

#### Defining a Flow

```typescript
import {
  defineFlow,
  createFlowNode,
  eventTrigger,
  invokeTrigger,
  linearTransition,
  branchTransition,
  conditionalTransition
} from './ai/flow';

const flow = defineFlow({
  id: 'order-processing-flow',
  nodes: [
    // Entry point: triggered by event
    createFlowNode({
      id: 'validate-order',
      trigger: eventTrigger('order.received'),
      handler: async (input, step) => {
        const isValid = validateOrder(input.order);
        return { valid: isValid, order: input.order };
      },
      transition: conditionalTransition(
        [
          { condition: (result) => !result.valid, to: 'handle-invalid-order' },
          { condition: (result) => result.order.total > 1000, to: 'vip-processing' }
        ],
        'standard-processing' // default
      )
    }),

    // Linear transition: 1 -> 1
    createFlowNode({
      id: 'standard-processing',
      trigger: invokeTrigger('validate-order'),
      handler: async (input, step) => {
        const processed = await processOrder(input.order);
        return { orderId: processed.id, ...processed };
      },
      transition: linearTransition('send-confirmation')
    }),

    // Branch transition: 1 -> many
    createFlowNode({
      id: 'vip-processing',
      trigger: invokeTrigger('validate-order'),
      handler: async (input, step) => {
        const processed = await processVIPOrder(input.order);
        return { orderId: processed.id, ...processed };
      },
      transition: branchTransition(['send-confirmation', 'notify-account-manager', 'update-crm'])
    }),

    // Terminal nodes
    createFlowNode({
      id: 'send-confirmation',
      trigger: invokeTrigger('standard-processing'),
      handler: async (input, step) => {
        await sendEmail(input.order.email, 'Order Confirmed');
        return { sent: true };
      }
    }),

    createFlowNode({
      id: 'handle-invalid-order',
      trigger: invokeTrigger('validate-order'),
      handler: async (input, step) => {
        await logError('Invalid order', input.order);
        return { handled: true };
      }
    })
  ]
});
```

#### Flow Triggers

**Event Trigger** - Listen for Inngest events:
```typescript
trigger: eventTrigger('order.received')
```

**Invoke Trigger** - Called directly from another function:
```typescript
trigger: invokeTrigger('validate-order')
```

#### Flow Transitions

**Linear (1:1)** - Move to single next node:
```typescript
transition: linearTransition('next-step')
```

**Branch (1:many)** - Trigger multiple nodes:
```typescript
transition: branchTransition(['step-a', 'step-b', 'step-c'])
```

**Conditional** - Route based on result:
```typescript
transition: conditionalTransition(
  [
    { condition: (result) => result.score >= 90, to: 'handle-excellent' },
    { condition: (result) => result.score >= 70, to: 'handle-good' },
    { condition: (result) => result.score >= 50, to: 'handle-passing' }
  ],
  'handle-failing' // default if no conditions match
)
```

Conditions are evaluated in order, and the first matching condition determines the next step.

## API Reference

### `runAgent<TResult>(params: RunAgentParams<TResult>): Promise<TResult>`

Execute an LLM call within an Inngest step with tool support.

**Parameters:**
- `step` - Inngest step tools
- `name` - Step name for Inngest logs
- `provider` - LLM provider instance
- `prompt` - Prompt with messages and variables
- `config` - LLM configuration (model, temperature, etc.)
- `tools` - Optional array of pre-call and post-call tools
- `fn` - Function to process the LLM response and return result

### `createLLMClient(config: ProviderConfig): Promise<LLMProvider>`

Create an LLM provider instance.

**Config:**
- `type` - Provider type: 'openai' | 'anthropic' | 'gemini' | 'grok' | 'azure-openai'
- `apiKey` - API key for the provider
- `baseUrl` - Optional base URL override
- `organizationId` - Optional organization ID (OpenAI)

### `hydratePrompt(prompt: Prompt): LLMMessage[]`

Hydrate a prompt template with variables using Mustache.

### `defineFlow(config): Flow`

Create a flow definition with multiple nodes.

### `createFlowNode<TInput, TOutput>(config): FlowNode`

Define a single node in a flow.

### `executeTransition(step, transition, result, functionRefs): Promise<void>`

Execute a flow transition based on type (linear, branch, conditional).

## Environment Variables

```env
PORT=3000

# LLM Provider API Keys
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...
XAI_API_KEY=...
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=https://...

# Inngest
INNGEST_EVENT_KEY=...
INNGEST_SIGNING_KEY=...
```

## Development

### Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Run production build

### Type Checking

```bash
npx tsc --noEmit
```

## Architecture

### Inngest Integration

The application uses Inngest for durable workflow execution. The `/api/inngest` endpoint serves the Inngest functions and handles event-driven execution with built-in retries and observability.

### Step Tools

All AI operations are wrapped in Inngest steps (`step.run`, `step.invoke`, `step.sendEvent`) to ensure durability and proper retry handling.

### Provider Architecture

The provider system uses a unified interface allowing you to swap LLM providers without changing application code. Each provider handles its own message format conversion and function calling protocol.

### Tool Execution Loop

The agent implements an agentic loop where:
1. Pre-call tools execute and populate prompt variables
2. Prompt is hydrated with all variables
3. LLM is called with tool definitions
4. If LLM requests tools, they execute and results return to LLM
5. Loop continues until LLM provides final response

### Flow Execution

Flows use `step.invoke()` for direct function calls (when function references are available) or fall back to events for loose coupling between services.

## Examples

See the `examples/` directory for complete examples:
- Basic LLM usage
- Tool calling examples
- Flow orchestration patterns
- Multi-step agent workflows

## License

ISC
