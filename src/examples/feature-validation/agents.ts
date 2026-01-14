import { runAgent } from "../../ai/agent";
import { createLLMClient } from "../../ai/providers";
import type { StepTools } from "../../ai/agent";
import {
  gatherContextPrompt,
  analyzeFeaturePrompt,
  generateReportPrompt,
} from "./prompts";
import {
  getCurrentDateTool,
  searchKnowledgeBaseTool,
  estimateComplexityTool,
} from "./tools";

const getAnthropicApiKey = () => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY environment variable is required. Please set it in your .env file.",
    );
  }
  return apiKey;
};

export async function gatherContextAgent(
  step: StepTools,
  featureDescription: string,
  existingContext: string,
  publish?: (params: {
    channel: string;
    topic: string;
    data: any;
  }) => Promise<void>,
  sessionId?: string,
) {
  return await runAgent({
    step,
    name: "gather-context",
    provider: await createLLMClient({
      type: "anthropic",
      apiKey: getAnthropicApiKey(),
    }),
    prompt: gatherContextPrompt(featureDescription, existingContext),
    config: {
      model: "claude-haiku-4-5-20251001",
      temperature: 0.7,
      maxTokens: 2000,
    },
    tools: [getCurrentDateTool, searchKnowledgeBaseTool],
    fn: (response) => {
      try {
        // Strip markdown code blocks if present
        let cleanResponse = response.trim();
        if (cleanResponse.startsWith("```json")) {
          cleanResponse = cleanResponse.replace(/^```json\s*\n?/, "");
        }
        if (cleanResponse.startsWith("```")) {
          cleanResponse = cleanResponse.replace(/^```\s*\n?/, "");
        }
        if (cleanResponse.endsWith("```")) {
          cleanResponse = cleanResponse.replace(/\n?```\s*$/, "");
        }

        return JSON.parse(cleanResponse);
      } catch (e) {
        // If parsing fails, return a default structure
        return {
          hasEnoughContext: false,
          questions: ["Could you provide more details about this feature?"],
          reasoning: response,
        };
      }
    },
    publish: sessionId ? publish : undefined,
    streamingConfig: sessionId
      ? {
          channel: `feature-validation:${sessionId}`,
          topic: "agent_updates",
        }
      : undefined,
    sessionId,
  });
}

export async function analyzeFeatureAgent(
  step: StepTools,
  featureDescription: string,
  context: string,
  publish?: (params: {
    channel: string;
    topic: string;
    data: any;
  }) => Promise<void>,
  sessionId?: string,
) {
  return await runAgent({
    step,
    name: "analyze-feature",
    provider: await createLLMClient({
      type: "anthropic",
      apiKey: getAnthropicApiKey(),
    }),
    prompt: analyzeFeaturePrompt(featureDescription, context),
    config: {
      model: "claude-haiku-4-5-20251001",
      temperature: 0.7,
      maxTokens: 3000,
    },
    tools: [
      getCurrentDateTool,
      searchKnowledgeBaseTool,
      estimateComplexityTool,
    ],
    fn: (response) => {
      try {
        // Strip markdown code blocks if present
        let cleanResponse = response.trim();
        if (cleanResponse.startsWith("```json")) {
          cleanResponse = cleanResponse.replace(/^```json\s*\n?/, "");
        }
        if (cleanResponse.startsWith("```")) {
          cleanResponse = cleanResponse.replace(/^```\s*\n?/, "");
        }
        if (cleanResponse.endsWith("```")) {
          cleanResponse = cleanResponse.replace(/\n?```\s*$/, "");
        }

        return JSON.parse(cleanResponse);
      } catch (error) {
        console.error("Failed to parse JSON response:", response);
        return {
          reasoning: response,
          recommendation: "yes",
          impactScore: 5,
          valueScore: 5,
          strategicAlignmentScore: 5,
          developmentCostScore: 5,
          overallScore: 5,
          pros: [],
          cons: [],
          summary: response,
        };
      }
    },
    publish: sessionId ? publish : undefined,
    streamingConfig: sessionId
      ? {
          channel: `feature-validation:${sessionId}`,
          topic: "agent_updates",
        }
      : undefined,
    sessionId,
  });
}

export async function generateReportAgent(
  step: StepTools,
  analysisResult: any,
  publish?: (params: {
    channel: string;
    topic: string;
    data: any;
  }) => Promise<void>,
  sessionId?: string,
) {
  return await runAgent({
    step,
    name: "generate-report",
    provider: await createLLMClient({
      type: "anthropic",
      apiKey: getAnthropicApiKey(),
    }),
    prompt: generateReportPrompt(analysisResult),
    config: {
      model: "claude-haiku-4-5-20251001",
      temperature: 0.5,
      maxTokens: 4000,
    },
    fn: (response) => response,
    publish: sessionId ? publish : undefined,
    streamingConfig: sessionId
      ? {
          channel: `feature-validation:${sessionId}`,
          topic: "agent_updates",
        }
      : undefined,
    sessionId,
  });
}
