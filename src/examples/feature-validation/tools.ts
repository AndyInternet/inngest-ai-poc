import type {
  PreCallTool,
  PostCallTool,
  ToolExecutionContext,
} from "../../ai/types";

export const getCurrentDateTool: PreCallTool = {
  type: "pre-call",
  name: "getCurrentDate",
  description: "Get the current date and time for context",
  execute: () => {
    return {
      currentDate: new Date().toISOString().split("T")[0],
      currentTime: new Date().toLocaleTimeString(),
    };
  },
};

export const searchKnowledgeBaseTool: PostCallTool = {
  type: "post-call",
  name: "searchKnowledgeBase",
  description:
    "Search the company knowledge base for product information, strategy docs, or audience data",
  parameters: [
    {
      name: "query",
      type: "string",
      description: "The search query",
      required: true,
    },
    {
      name: "category",
      type: "string",
      description:
        "Category to search in: product, strategy, audience, technical",
      required: false,
    },
  ],
  execute: async (
    args: Record<string, any>,
    context?: ToolExecutionContext,
  ) => {
    const { query, category } = args as { query: string; category?: string };

    // Report progress if context is available
    if (context?.reportProgress) {
      await context.reportProgress(`Searching knowledge base for: ${query}`);
    }

    // Simulate search delay
    await new Promise((resolve) => setTimeout(resolve, 500));

    if (context?.reportProgress) {
      await context.reportProgress(
        `Analyzing results in category: ${category || "general"}`,
      );
    }

    // Mock implementation - in production this would query a real knowledge base
    const mockResults = {
      product:
        "This is a B2B SaaS platform for project management with focus on remote teams.",
      strategy:
        "Company strategy focuses on increasing user engagement and expanding into enterprise market.",
      audience:
        "Target audience is mid-size companies (50-500 employees) with distributed teams.",
      technical:
        "Current stack uses React, Node.js, PostgreSQL. Average sprint is 2 weeks.",
    };

    return {
      results:
        mockResults[category as keyof typeof mockResults] || "No results found",
      source: `Knowledge Base - ${category || "general"}`,
    };
  },
};

export const estimateComplexityTool: PostCallTool = {
  type: "post-call",
  name: "estimateComplexity",
  description: "Estimate development complexity and time for a feature",
  parameters: [
    {
      name: "featureDescription",
      type: "string",
      description: "Description of the feature to estimate",
      required: true,
    },
    {
      name: "components",
      type: "array",
      description: "List of components or systems affected",
      required: false,
    },
  ],
  execute: async (
    args: Record<string, any>,
    context?: ToolExecutionContext,
  ) => {
    const { featureDescription, components } = args as {
      featureDescription: string;
      components?: string[];
    };

    if (context?.reportProgress) {
      await context.reportProgress("Analyzing feature complexity...");
    }

    // Simulate analysis delay
    await new Promise((resolve) => setTimeout(resolve, 800));

    if (context?.reportProgress) {
      await context.reportProgress("Calculating time estimates...");
    }

    await new Promise((resolve) => setTimeout(resolve, 400));

    // Mock complexity estimation
    const complexity = Math.floor(Math.random() * 10) + 1;
    const timeEstimate = complexity * 2; // weeks

    if (context?.reportProgress) {
      await context.reportProgress(`Estimated complexity: ${complexity}/10`);
    }

    return {
      complexityScore: complexity,
      estimatedWeeks: timeEstimate,
      confidence: "medium",
      factors: [
        "Backend API changes required",
        "Frontend UI components",
        "Database schema updates",
        "Testing and QA",
      ],
    };
  },
};
