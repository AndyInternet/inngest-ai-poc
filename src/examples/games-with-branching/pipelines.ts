/**
 * Inngest Functions and Pipeline for Games with Branching
 *
 * This file demonstrates the pipeline branching feature with a simple game selector.
 * The user chooses between Trivia or 20 Questions, and the pipeline branches
 * to run the appropriate game.
 *
 * Pipeline flow:
 * 1. game-selector: User chooses which game to play
 * 2. Branch based on choice:
 *    - "trivia": Run trivia-game agent (10 true/false questions)
 *    - "twenty-questions": Run twenty-questions-game agent (20 yes/no questions)
 *
 * @module games-with-branching/pipelines
 */

import { inngest } from "../../inngest/client";
import { createAgentPipeline, defineAgent, defineBranch } from "../../ai/pipeline";

import {
  gameSelectorAgent,
  triviaGameAgent,
  twentyQuestionsGameAgent,
} from "./agents";

import {
  type GameSelectorResult,
  type TriviaGameResult,
  type TwentyQuestionsResult,
  type GamesInput,
  type GamesResult,
} from "./schemas";

import { createPipelineHooks } from "./hooks";

// ============================================================================
// Pipeline Definition
// ============================================================================

/**
 * Games pipeline that demonstrates branching.
 *
 * The pipeline:
 * 1. Asks the user which game they want to play (game-selector)
 * 2. Branches based on the response:
 *    - "trivia" -> runs the trivia game
 *    - "twenty-questions" -> runs the 20 questions game
 */
export const gamesPipeline = createAgentPipeline<
  GamesInput,
  TriviaGameResult | TwentyQuestionsResult
>(
  {
    name: "games-with-branching",
    description: "A game selector that branches to different games based on user choice",
    hooks: createPipelineHooks<GamesInput, TriviaGameResult | TwentyQuestionsResult>(),
  },
  [
    // Agent 1: Game Selector
    // Asks the user which game they want to play
    defineAgent<
      GamesInput,
      GameSelectorResult,
      GamesInput,
      GamesInput,
      Record<string, unknown>
    >({
      name: "game-selector",
      description: "Determine which game the user wants to play",
      mapInput: (_prev, ctx) => ctx.initialInput,
      run: async (step, _input, sessionId) => {
        return gameSelectorAgent(step, sessionId!);
      },
    }),

    // Branch based on game selection
    defineBranch<
      "trivia" | "twenty-questions",
      GameSelectorResult,
      TriviaGameResult | TwentyQuestionsResult,
      GamesInput,
      { "game-selector": GameSelectorResult }
    >({
      name: "game-branch",
      description: "Route to the selected game",
      condition: (previousOutput) => previousOutput.game,
      branches: {
        // Trivia branch - runs the trivia game
        trivia: [
          defineAgent<
            GamesInput,
            TriviaGameResult,
            GameSelectorResult,
            GamesInput,
            { "game-selector": GameSelectorResult }
          >({
            name: "trivia-game",
            description: "Play a 10-question true/false trivia game",
            mapInput: (_prev, ctx) => ctx.initialInput,
            run: async (step, _input, sessionId) => {
              return triviaGameAgent(step, sessionId!);
            },
          }),
        ],

        // Twenty Questions branch - runs the 20 questions game
        "twenty-questions": [
          defineAgent<
            GamesInput,
            TwentyQuestionsResult,
            GameSelectorResult,
            GamesInput,
            { "game-selector": GameSelectorResult }
          >({
            name: "twenty-questions-game",
            description: "Play a game of 20 questions",
            mapInput: (_prev, ctx) => ctx.initialInput,
            run: async (step, _input, sessionId) => {
              return twentyQuestionsGameAgent(step, sessionId!);
            },
          }),
        ],
      },
      defaultBranch: "trivia",
    }),
  ],
);

// ============================================================================
// Inngest Functions
// ============================================================================

/**
 * Games workflow function.
 *
 * Triggered by the "games.start" event, this function runs the games pipeline
 * which branches based on user choice.
 */
export const gamesFunction = inngest.createFunction(
  {
    id: "games-with-branching",
    name: "Games with Branching Pipeline",
    retries: 3,
  },
  { event: "games.start" },
  async ({ event, step }): Promise<GamesResult> => {
    const { sessionId } = event.data as { sessionId: string };

    // Run the pipeline
    const result = await gamesPipeline.run(step, { sessionId }, sessionId);

    // Determine game type from result
    const gameType = "finalScore" in result ? "trivia" : "twenty-questions";

    return {
      gameType: gameType as "trivia" | "twenty-questions",
      result,
      completedAt: new Date().toISOString(),
    };
  },
);

// ============================================================================
// Function Registry
// ============================================================================

/**
 * All Inngest functions for the games example.
 */
export const gamesFunctions = [gamesFunction];
