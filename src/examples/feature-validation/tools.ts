import type { Tool } from '../../ai/tools';

export const getCurrentDateTool: Tool = {
  type: 'pre-call',
  name: 'getCurrentDate',
  description: 'Get the current date and time for context',
  execute: () => {
    return {
      currentDate: new Date().toISOString().split('T')[0],
      currentTime: new Date().toLocaleTimeString()
    };
  }
};

export const searchKnowledgeBaseTool: Tool = {
  type: 'post-call',
  name: 'searchKnowledgeBase',
  description: 'Search the company knowledge base for product information, strategy docs, or audience data',
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: 'The search query',
      required: true
    },
    {
      name: 'category',
      type: 'string',
      description: 'Category to search in: product, strategy, audience, technical',
      required: false
    }
  ],
  execute: async (args) => {
    // Mock implementation - in production this would query a real knowledge base
    const mockResults = {
      product: 'This is a B2B SaaS platform for project management with focus on remote teams.',
      strategy: 'Company strategy focuses on increasing user engagement and expanding into enterprise market.',
      audience: 'Target audience is mid-size companies (50-500 employees) with distributed teams.',
      technical: 'Current stack uses React, Node.js, PostgreSQL. Average sprint is 2 weeks.'
    };

    return {
      results: mockResults[args.category as keyof typeof mockResults] || 'No results found',
      source: `Knowledge Base - ${args.category || 'general'}`
    };
  }
};

export const estimateComplexityTool: Tool = {
  type: 'post-call',
  name: 'estimateComplexity',
  description: 'Estimate development complexity and time for a feature',
  parameters: [
    {
      name: 'featureDescription',
      type: 'string',
      description: 'Description of the feature to estimate',
      required: true
    },
    {
      name: 'components',
      type: 'array',
      description: 'List of components or systems affected',
      required: false
    }
  ],
  execute: async (args) => {
    // Mock complexity estimation
    const complexity = Math.floor(Math.random() * 10) + 1;
    const timeEstimate = complexity * 2; // weeks

    return {
      complexityScore: complexity,
      estimatedWeeks: timeEstimate,
      confidence: 'medium',
      factors: [
        'Backend API changes required',
        'Frontend UI components',
        'Database schema updates',
        'Testing and QA'
      ]
    };
  }
};
