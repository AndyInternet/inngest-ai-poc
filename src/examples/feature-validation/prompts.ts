/**
 * Prompt Templates for the Feature Validation Pipeline
 *
 * This file defines all prompt templates used by the feature validation agents.
 * Each prompt uses Mustache templating ({{variable}}) for dynamic content.
 *
 * @module feature-validation/prompts
 */

import type { Prompt } from "../../ai/types";
import type { AnalyzeFeatureResult } from "./schemas";

// ============================================================================
// Gather Context Agent Prompts
// ============================================================================

/**
 * Prompt for the gather-context agent.
 *
 * This agent uses Chain-of-Thought reasoning to determine if enough
 * context exists to evaluate a feature request. If not, it generates
 * targeted questions to gather more information.
 *
 * @param featureDescription - The feature being evaluated
 * @param existingContext - Any context already gathered
 * @returns Prompt object ready for hydration
 */
export function gatherContextPrompt(
  featureDescription: string,
  existingContext: string,
): Prompt {
  return {
    messages: [
      {
        role: "system",
        content: `You are a product strategy advisor using Chain-of-Thought reasoning.

Your role is to determine if you have enough context to evaluate a feature request.

You need to understand:
1. The product this feature is for (what does it do, who uses it)
2. The company's strategy and goals
3. The target audience and their needs
4. Any technical constraints or dependencies

Existing context gathered so far:
{{existingContext}}

Think through what information you have and what's missing. If you need more information, generate 1-3 specific, targeted questions.

Respond in JSON format:
{
  "reasoning": "Your chain-of-thought analysis of available context",
  "hasEnoughContext": true or false,
  "questions": ["question1", "question2"],
  "summary": "Brief summary of context if hasEnoughContext is true"
}

Note: Only include "questions" if hasEnoughContext is false.`,
      },
      {
        role: "user",
        content: `Feature to evaluate: {{featureDescription}}`,
      },
    ],
    variables: {
      featureDescription,
      existingContext: existingContext || "None yet",
    },
  };
}

/**
 * Prompt for the second pass of gather-context (after questions answered).
 *
 * This prompt instructs the agent to proceed without asking more questions,
 * working with whatever context is available.
 *
 * @param featureDescription - The feature being evaluated
 * @param existingContext - All context including user answers
 * @returns Prompt object ready for hydration
 */
export function gatherContextFinalPrompt(
  featureDescription: string,
  existingContext: string,
): Prompt {
  return {
    messages: [
      {
        role: "system",
        content: `You are a product strategy advisor. You have gathered context about a feature request.

Context gathered:
{{existingContext}}

Based on this context, provide your analysis. Do NOT ask any more questions - work with what you have. If information is incomplete, note what's missing in your reasoning.

Respond in JSON format:
{
  "reasoning": "Your analysis of the context gathered",
  "hasEnoughContext": true,
  "summary": "Brief summary of the context you have"
}`,
      },
      {
        role: "user",
        content: `Feature to evaluate: {{featureDescription}}`,
      },
    ],
    variables: {
      featureDescription,
      existingContext,
    },
  };
}

// ============================================================================
// Analyze Feature Agent Prompt
// ============================================================================

/**
 * Prompt for the analyze-feature agent.
 *
 * This agent uses Chain-of-Thought and ReAct reasoning patterns to
 * evaluate a feature across multiple dimensions:
 * - Value & Impact
 * - Strategic Alignment
 * - Development Cost
 * - Risks & Trade-offs
 *
 * @param featureDescription - The feature being evaluated
 * @param context - Context gathered from the previous agent
 * @returns Prompt object ready for hydration
 */
export function analyzeFeaturePrompt(
  featureDescription: string,
  context: string,
): Prompt {
  return {
    messages: [
      {
        role: "system",
        content: `You are a product strategy advisor using Chain-of-Thought and ReAct reasoning patterns.

Context about the product, company, and audience:
{{context}}

Analyze the feature using these dimensions:
1. **Value & Impact**: How much value does this bring to users? What problems does it solve?
2. **Strategic Alignment**: Does this align with company goals and product vision?
3. **Development Cost**: Estimate complexity, time, and resources needed
4. **Risks & Trade-offs**: What are the downsides or opportunity costs?

Think step-by-step through your analysis. Consider both quantitative and qualitative factors.

Use the estimateComplexity tool if you need detailed complexity analysis.
Use the searchKnowledgeBase tool to find relevant product or strategy information.

Respond in JSON format:
{
  "reasoning": "Your detailed chain-of-thought analysis",
  "recommendation": "yes" or "no",
  "impactScore": 1-10,
  "valueScore": 1-10,
  "strategicAlignmentScore": 1-10,
  "developmentCostScore": 1-10 (higher = more expensive),
  "overallScore": 1-10,
  "pros": ["pro1", "pro2", ...],
  "cons": ["con1", "con2", ...],
  "summary": "Brief summary of recommendation"
}`,
      },
      {
        role: "user",
        content: `Feature to evaluate: {{featureDescription}}`,
      },
    ],
    variables: {
      featureDescription,
      context,
    },
  };
}

// ============================================================================
// Generate Report Agent Prompt
// ============================================================================

/**
 * Prompt for the generate-report agent.
 *
 * This agent creates a comprehensive, well-structured markdown report
 * summarizing the feature validation analysis.
 *
 * @param analysisResult - The analysis result from the previous agent
 * @returns Prompt object ready for hydration
 */
export function generateReportPrompt(
  analysisResult: AnalyzeFeatureResult,
): Prompt {
  return {
    messages: [
      {
        role: "system",
        content: `You are generating a comprehensive feature evaluation report.

Format it as a well-structured markdown document that is professional, clear, and actionable.

Analysis data:
{{analysisData}}

Create a report with these sections:

# Feature Validation Report

## Executive Summary
Brief overview of the recommendation and key findings.

## Feature Overview
What the feature is and what problem it solves.

## Recommendation
Clear YES or NO with the overall score and brief justification.

## Detailed Analysis

### Value & Impact (Score: X/10)
Analysis of user value and business impact.

### Strategic Alignment (Score: X/10)
How well this aligns with company goals.

### Development Cost (Score: X/10)
Complexity and resource requirements.

## Pros and Cons

### Advantages
- List of pros

### Disadvantages
- List of cons

## Reasoning
Detailed explanation of the analysis.

## Next Steps
If recommended, what should happen next.
If not recommended, alternative suggestions.`,
      },
      {
        role: "user",
        content: "Generate the report based on the analysis provided.",
      },
    ],
    variables: {
      analysisData: JSON.stringify(analysisResult, null, 2),
    },
  };
}
