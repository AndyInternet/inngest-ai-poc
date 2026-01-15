/**
 * Tools for the Feature Validation Pipeline
 *
 * This file defines all tools used by the feature validation agents:
 * - Pre-call tools: Execute before LLM call to populate prompt variables
 * - Post-call tools: Can be invoked by the LLM during execution
 *
 * @module feature-validation/tools
 */

import type {
  PreCallTool,
  PostCallTool,
  ToolExecutionContext,
} from "../../ai/types";

// ============================================================================
// Pre-Call Tools
// ============================================================================

/**
 * Pre-call tool that provides the current date and time.
 * The returned values are automatically available as prompt variables.
 *
 * @example
 * // In prompt template:
 * // "Today is {{currentDate}} at {{currentTime}}"
 */
export const getCurrentDateTool: PreCallTool = {
  type: "pre-call",
  name: "getCurrentDate",
  description: "Get the current date and time for context",
  execute: () => ({
    currentDate: new Date().toISOString().split("T")[0],
    currentTime: new Date().toLocaleTimeString(),
  }),
};

// ============================================================================
// Post-Call Tools
// ============================================================================

/**
 * Mock knowledge base data for demonstration.
 * In production, this would be replaced with actual database/API queries.
 */
const MOCK_KNOWLEDGE_BASE: Record<string, string> = {
  product:
    "This is a B2B SaaS platform for project management with focus on remote teams. " +
    "Key features include task tracking, team collaboration, and reporting dashboards.",
  strategy:
    "Company strategy focuses on increasing user engagement and expanding into the enterprise market. " +
    "Q1 priorities include improving onboarding and reducing churn.",
  audience:
    "Target audience is mid-size companies (50-500 employees) with distributed teams. " +
    "Primary users are project managers and team leads.",
  technical:
    "Current stack uses React, Node.js, PostgreSQL. Average sprint is 2 weeks. " +
    "Technical debt is moderate, with ongoing efforts to improve test coverage.",
};

/**
 * Post-call tool for searching the company knowledge base.
 * Demonstrates progress reporting during tool execution.
 *
 * @example
 * // LLM can invoke this tool with:
 * // { "query": "product features", "category": "product" }
 */
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
    args: Record<string, unknown>,
    context?: ToolExecutionContext,
  ) => {
    const query = args.query as string;
    const category = args.category as string | undefined;

    // Report progress to UI
    context?.reportProgress?.(`Searching knowledge base for: ${query}`);

    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 500));

    context?.reportProgress?.(
      `Analyzing results in category: ${category || "general"}`,
    );

    // Return mock results
    const results =
      category && MOCK_KNOWLEDGE_BASE[category]
        ? MOCK_KNOWLEDGE_BASE[category]
        : "No specific results found. Try searching in: product, strategy, audience, or technical categories.";

    return {
      results,
      source: `Knowledge Base - ${category || "general"}`,
      query,
    };
  },
};

/**
 * Complexity factors used for estimation.
 * Each factor adds to the overall complexity score.
 */
const COMPLEXITY_FACTORS = [
  { name: "Backend API changes required", weight: 2 },
  { name: "Frontend UI components", weight: 1.5 },
  { name: "Database schema updates", weight: 2 },
  { name: "Testing and QA", weight: 1 },
  { name: "Documentation updates", weight: 0.5 },
] as const;

/**
 * Post-call tool for estimating feature complexity.
 * Uses a deterministic algorithm based on feature description length
 * and number of affected components.
 *
 * @example
 * // LLM can invoke this tool with:
 * // { "featureDescription": "Add dark mode", "components": ["UI", "Settings"] }
 */
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
    args: Record<string, unknown>,
    context?: ToolExecutionContext,
  ) => {
    const featureDescription = args.featureDescription as string;
    const components = (args.components as string[] | undefined) || [];

    context?.reportProgress?.("Analyzing feature complexity...");

    // Simulate analysis delay
    await new Promise((resolve) => setTimeout(resolve, 800));

    context?.reportProgress?.("Calculating time estimates...");

    await new Promise((resolve) => setTimeout(resolve, 400));

    // Deterministic complexity calculation based on description and components
    // (Avoids Math.random() for reproducible results)
    const descriptionComplexity = Math.min(
      5,
      Math.ceil(featureDescription.length / 50),
    );
    const componentComplexity = Math.min(5, components.length);
    const complexity = Math.max(
      1,
      Math.min(10, descriptionComplexity + componentComplexity),
    );

    // Time estimate based on complexity
    const estimatedWeeks = Math.ceil(complexity * 1.5);

    // Select applicable factors based on components
    const applicableFactors = COMPLEXITY_FACTORS.filter((factor) => {
      if (components.length === 0) return true;
      const lowerComponents = components.map((c) => c.toLowerCase());
      if (factor.name.includes("Backend") && lowerComponents.includes("api"))
        return true;
      if (factor.name.includes("Frontend") && lowerComponents.includes("ui"))
        return true;
      if (
        factor.name.includes("Database") &&
        lowerComponents.includes("database")
      )
        return true;
      return true; // Include all by default for simplicity
    });

    context?.reportProgress?.(`Estimated complexity: ${complexity}/10`);

    return {
      complexityScore: complexity,
      estimatedWeeks,
      confidence: complexity <= 3 ? "high" : complexity <= 6 ? "medium" : "low",
      factors: applicableFactors.map((f) => f.name),
      breakdown: {
        descriptionComplexity,
        componentComplexity,
        componentsAnalyzed: components.length,
      },
    };
  },
};

// ============================================================================
// Tool Collection for Easy Import
// ============================================================================

/**
 * All pre-call tools for the feature validation pipeline.
 */
export const preCallTools = [getCurrentDateTool];

/**
 * All post-call tools for the feature validation pipeline.
 */
export const postCallTools = [searchKnowledgeBaseTool, estimateComplexityTool];

/**
 * All tools combined for the feature validation pipeline.
 */
export const allTools = [...preCallTools, ...postCallTools];
