/**
 * Zod Schemas for the Games with Branching Example
 *
 * This file defines all input and output schemas used by the games pipeline.
 *
 * @module games-with-branching/schemas
 */

import { z } from "zod";

// ============================================================================
// Input Schemas
// ============================================================================

/**
 * Input schema for the game selector agent.
 */
export const GameSelectorInputSchema = z.object({
  userMessage: z.string().describe("The user's message"),
});

export type GameSelectorInput = z.infer<typeof GameSelectorInputSchema>;

/**
 * Input schema for the pipeline.
 */
export const GamesInputSchema = z.object({
  sessionId: z.string().describe("Session ID for the game"),
});

export type GamesInput = z.infer<typeof GamesInputSchema>;

// ============================================================================
// Output Schemas
// ============================================================================

/**
 * Schema for the game selector agent result.
 */
export const GameSelectorResultSchema = z.object({
  game: z
    .enum(["trivia", "twenty-questions"])
    .describe("The selected game type"),
  message: z.string().describe("Welcome message for the user"),
});

export type GameSelectorResult = z.infer<typeof GameSelectorResultSchema>;

/**
 * Schema for a trivia question.
 */
export const TriviaQuestionSchema = z.object({
  question: z.string().describe("The trivia question"),
  answer: z.boolean().describe("The correct answer (true or false)"),
});

export type TriviaQuestion = z.infer<typeof TriviaQuestionSchema>;

/**
 * Schema for the trivia game result.
 */
export const TriviaGameResultSchema = z.object({
  finalScore: z.number().describe("Final score out of 10"),
  message: z.string().describe("Final message to the user"),
});

export type TriviaGameResult = z.infer<typeof TriviaGameResultSchema>;

/**
 * Schema for a 20 questions game setup.
 */
export const TwentyQuestionsSetupSchema = z.object({
  answer: z.string().describe("The secret noun"),
  category: z
    .enum(["people", "places", "things"])
    .describe("The category of the noun"),
  message: z.string().describe("Message to start the game"),
});

export type TwentyQuestionsSetup = z.infer<typeof TwentyQuestionsSetupSchema>;

/**
 * Schema for the 20 questions game result.
 */
export const TwentyQuestionsResultSchema = z.object({
  won: z.boolean().describe("Whether the user won"),
  answer: z.string().describe("The secret answer"),
  questionsAsked: z.number().describe("Number of questions asked"),
  message: z.string().describe("Final message to the user"),
});

export type TwentyQuestionsResult = z.infer<typeof TwentyQuestionsResultSchema>;

/**
 * Union type for game results.
 */
export const GameResultSchema = z.union([
  TriviaGameResultSchema,
  TwentyQuestionsResultSchema,
]);

export type GameResult = z.infer<typeof GameResultSchema>;

// ============================================================================
// Pipeline Result Schema
// ============================================================================

/**
 * Complete result from the games pipeline.
 */
export const GamesResultSchema = z.object({
  gameType: z.enum(["trivia", "twenty-questions"]),
  result: GameResultSchema,
  completedAt: z.string().datetime(),
});

export type GamesResult = z.infer<typeof GamesResultSchema>;
