import type { Prompt } from "../../ai/types";

export const gatherContextPrompt = (
  featureDescription: string,
  existingContext: string,
): Prompt => ({
  messages: [
    {
      role: "system",
      content: `You are a product strategy advisor using Chain-of-Thought reasoning. Your role is to determine if you have enough context to evaluate a feature request.

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
  "reasoning": "Your chain-of-thought analysis",
  "hasEnoughContext": true/false,
  "questions": ["question1", "question2"] // only if hasEnoughContext is false
}`,
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
});

export const analyzeFeaturePrompt = (
  featureDescription: string,
  context: string,
): Prompt => ({
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
});

export const generateReportPrompt = (analysisResult: any): Prompt => ({
  messages: [
    {
      role: "system",
      content: `You are generating a comprehensive feature evaluation report. Format it as a detailed, well-structured document.

Analysis data:
{{analysisData}}

Create a report with these sections:
1. Executive Summary
2. Feature Overview
3. Recommendation (YES/NO with overall score)
4. Detailed Analysis (Value, Impact, Strategic Alignment, Cost)
5. Pros and Cons
6. Reasoning and Rationale
7. Next Steps (if recommended)

Make it professional, clear, and actionable.`,
    },
    {
      role: "user",
      content: "Generate the report based on the analysis provided.",
    },
  ],
  variables: {
    analysisData: JSON.stringify(analysisResult, null, 2),
  },
});
