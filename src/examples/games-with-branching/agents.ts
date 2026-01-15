/**
 * Game Agents for the Games with Branching Pipeline
 *
 * This file defines the AI agents for the games pipeline:
 * 1. game-selector: Determines which game the user wants to play
 * 2. trivia-game: Runs the trivia game with 10 true/false questions
 * 3. twenty-questions-game: Runs the 20 questions guessing game
 *
 * @module games-with-branching/agents
 */

import type { AgentHooks, StepTools } from "../../ai/types";
import { runAgent } from "../../ai/agent";
import { askUser } from "../../ai/questions";

import {
  GameSelectorResultSchema,
  TriviaQuestionSchema,
  TwentyQuestionsSetupSchema,
  type GameSelectorResult,
  type TriviaGameResult,
  type TwentyQuestionsResult,
  type TriviaQuestion,
  type TwentyQuestionsSetup,
} from "./schemas";

import {
  gameSelectorPrompt,
  triviaQuestionPrompt,
  triviaFeedbackPrompt,
  twentyQuestionsSetupPrompt,
  twentyQuestionsAnswerPrompt,
} from "./prompts";

import { createLoggingHooks } from "./hooks";
import { parseJsonResponse, broadcastToUser, broadcastLoading } from "./utils";
import { getProvider, DEFAULT_MODEL } from "./providers";

/**
 * Game selector agent - determines which game to play.
 */
export async function gameSelectorAgent(
  step: StepTools,
  sessionId: string,
  hooks?: AgentHooks<GameSelectorResult>,
): Promise<GameSelectorResult> {
  const provider = await getProvider();
  const agentHooks = hooks ?? createLoggingHooks<GameSelectorResult>();

  // Question key for the game choice
  const questionKey = "game-choice";

  // Use sessionId in step IDs to isolate sessions
  const stepPrefix = `${sessionId}-game-selector`;

  // Wait for user to choose a game (broadcast happens in onQuestionsReady to ensure idempotency)
  const answers = await askUser(step, {
    questions: [questionKey],
    sessionId,
    stepId: `${stepPrefix}-wait-for-choice`,
    timeout: "1h",
    eventName: "games.user.response",
    onQuestionsReady: async () => {
      await broadcastToUser(
        sessionId,
        "Welcome! Which game would you like to play?",
        {
          type: "choice",
          choices: ["Trivia", "20 Questions"],
          questionKey,
        },
      );
    },
  });

  const userChoice = answers[questionKey] || "trivia";

  // Show loading while processing (wrapped in step for idempotency)
  await step.run(`${stepPrefix}-show-loading`, async () => {
    await broadcastLoading(sessionId, "Starting game...");
  });

  return runAgent<GameSelectorResult>({
    step,
    name: "game-selector",
    runId: "main", // Deterministic ID for Inngest replay
    provider,
    prompt: gameSelectorPrompt(userChoice),
    config: {
      model: DEFAULT_MODEL,
      temperature: 0.7,
      maxTokens: 500,
    },
    resultSchema: GameSelectorResultSchema,
    hooks: agentHooks,
    fn: parseJsonResponse<GameSelectorResult>,
  });
}

/**
 * Trivia game agent - runs 10 true/false questions.
 */
export async function triviaGameAgent(
  step: StepTools,
  sessionId: string,
  hooks?: AgentHooks<TriviaGameResult>,
): Promise<TriviaGameResult> {
  const provider = await getProvider();
  const agentHooks = hooks ?? createLoggingHooks<TriviaGameResult>();

  let score = 0;
  const totalQuestions = 10;

  // Use sessionId in step IDs to isolate sessions
  const stepPrefix = `${sessionId}-trivia`;

  // Show game start message (wrapped in step for idempotency)
  await step.run(`${stepPrefix}-game-start`, async () => {
    await broadcastToUser(
      sessionId,
      `Let's play Trivia! I'll ask you ${totalQuestions} true/false questions. Good luck!`,
      { type: "none" },
      { loadingLabel: "Generating question 1..." },
    );
  });

  // Generate a base seed for this game session
  const baseRandomSeed = Date.now() + Math.floor(Math.random() * 10000);

  for (let i = 1; i <= totalQuestions; i++) {
    const questionKey = `trivia-q-${i}`;
    // Unique seed per question (base + question number ensures variety)
    const questionSeed = baseRandomSeed + i * 1000;

    // Generate a question
    const questionResult = await runAgent<TriviaQuestion>({
      step,
      name: `${stepPrefix}-question-${i}`,
      runId: "main", // Deterministic ID for Inngest replay
      provider,
      prompt: triviaQuestionPrompt(i, questionSeed),
      config: {
        model: DEFAULT_MODEL,
        temperature: 1.0, // Max temperature for variety
        maxTokens: 300,
      },
      resultSchema: TriviaQuestionSchema,
      hooks: agentHooks as unknown as AgentHooks<TriviaQuestion>,
      fn: parseJsonResponse<TriviaQuestion>,
    });

    // Wait for user answer (broadcast happens in onQuestionsReady)
    const answers = await askUser(step, {
      questions: [questionKey],
      sessionId,
      stepId: `${stepPrefix}-answer-${i}`,
      timeout: "10m",
      eventName: "games.user.response",
      onQuestionsReady: async () => {
        await broadcastToUser(
          sessionId,
          `Question ${i}/${totalQuestions}: ${questionResult.question}`,
          {
            type: "boolean",
            questionKey,
          },
          { data: { questionNumber: i, totalQuestions, currentScore: score } },
        );
      },
    });

    const userAnswerStr = answers[questionKey] || "";
    const userAnswer =
      userAnswerStr.toLowerCase() === "true" ||
      userAnswerStr.toLowerCase() === "t" ||
      userAnswerStr === "1";

    const isCorrect = userAnswer === questionResult.answer;
    if (isCorrect) {
      score++;
    }

    // Generate feedback
    const feedbackResponse = await runAgent<string>({
      step,
      name: `${stepPrefix}-feedback-${i}`,
      runId: "main", // Deterministic ID for Inngest replay
      provider,
      prompt: triviaFeedbackPrompt(
        questionResult.question,
        questionResult.answer,
        userAnswer,
        score,
        i,
      ),
      config: {
        model: DEFAULT_MODEL,
        temperature: 0.7,
        maxTokens: 200,
      },
      fn: (response) => response,
    });

    // Show feedback (wrapped in step for idempotency)
    const feedbackMessage = `${isCorrect ? "✓ Correct!" : "✗ Incorrect."} ${feedbackResponse} (Score: ${score}/${i})`;

    await step.run(`${stepPrefix}-feedback-display-${i}`, async () => {
      if (i < totalQuestions) {
        await broadcastToUser(
          sessionId,
          feedbackMessage,
          { type: "none" },
          { loadingLabel: `Generating question ${i + 1}...` },
        );
      } else {
        await broadcastToUser(sessionId, feedbackMessage, { type: "none" });
      }
    });
  }

  // Generate final message
  const percentage = (score / totalQuestions) * 100;
  let finalMessage: string;
  if (percentage === 100) {
    finalMessage = `Perfect score! You got all ${totalQuestions} questions right! You're a trivia master!`;
  } else if (percentage >= 80) {
    finalMessage = `Excellent! You scored ${score}/${totalQuestions} (${percentage}%). Great job!`;
  } else if (percentage >= 60) {
    finalMessage = `Good effort! You scored ${score}/${totalQuestions} (${percentage}%). Not bad at all!`;
  } else if (percentage >= 40) {
    finalMessage = `You scored ${score}/${totalQuestions} (${percentage}%). Keep practicing!`;
  } else {
    finalMessage = `You scored ${score}/${totalQuestions} (${percentage}%). Better luck next time!`;
  }

  // Show game over (wrapped in step for idempotency)
  await step.run(`${stepPrefix}-game-over`, async () => {
    await broadcastToUser(
      sessionId,
      finalMessage,
      { type: "none" },
      { isGameOver: true, data: { finalScore: score, totalQuestions, percentage } },
    );
  });

  return {
    finalScore: score,
    message: finalMessage,
  };
}

/**
 * Twenty Questions game agent.
 */
export async function twentyQuestionsGameAgent(
  step: StepTools,
  sessionId: string,
  hooks?: AgentHooks<TwentyQuestionsResult>,
): Promise<TwentyQuestionsResult> {
  const provider = await getProvider();
  const agentHooks = hooks ?? createLoggingHooks<TwentyQuestionsResult>();

  // Use sessionId in step IDs to isolate sessions
  const stepPrefix = `${sessionId}-20q`;

  // Show loading while setting up (wrapped in step for idempotency)
  await step.run(`${stepPrefix}-setup-loading`, async () => {
    await broadcastLoading(sessionId, "Thinking of something...");
  });

  // Generate a random seed for variety (use timestamp + random for uniqueness)
  const randomSeed = Date.now() + Math.floor(Math.random() * 10000);

  // Set up the game - choose a secret answer
  const setup = await runAgent<TwentyQuestionsSetup>({
    step,
    name: `${stepPrefix}-setup`,
    runId: "main", // Deterministic ID for Inngest replay
    provider,
    prompt: twentyQuestionsSetupPrompt(randomSeed),
    config: {
      model: DEFAULT_MODEL,
      temperature: 1.0, // Max temperature for variety
      maxTokens: 300,
    },
    resultSchema: TwentyQuestionsSetupSchema,
    hooks: agentHooks as unknown as AgentHooks<TwentyQuestionsSetup>,
    fn: parseJsonResponse<TwentyQuestionsSetup>,
  });

  const maxQuestions = 20;
  let questionsAsked = 0;
  let won = false;

  // Helper to check if user's input contains the answer (case-insensitive)
  function containsAnswer(input: string, answer: string): boolean {
    const normalizedInput = input.toLowerCase().trim();
    const normalizedAnswer = answer.toLowerCase().trim();
    return normalizedInput.includes(normalizedAnswer);
  }

  while (questionsAsked < maxQuestions && !won) {
    questionsAsked++;
    const questionsRemaining = maxQuestions - questionsAsked;
    const questionKey = `twenty-q-${questionsAsked}`;

    // Wait for user question (broadcast happens in onQuestionsReady)
    const answers = await askUser(step, {
      questions: [questionKey],
      sessionId,
      stepId: `${stepPrefix}-q-${questionsAsked}`,
      timeout: "10m",
      eventName: "games.user.response",
      onQuestionsReady: async () => {
        if (questionsAsked === 1) {
          // First question - show game start message
          await broadcastToUser(
            sessionId,
            `${setup.message}\n\nYou have ${maxQuestions} questions. Ask away!`,
            {
              type: "text",
              placeholder: "Ask a yes/no question...",
              questionKey,
            },
            { data: { category: setup.category, questionsRemaining: maxQuestions } },
          );
        }
        // Subsequent questions are prompted after the previous response
      },
    });

    const userQuestion = answers[questionKey] || "";

    // Check if user's question contains the exact answer
    if (containsAnswer(userQuestion, setup.answer)) {
      // They got it!
      won = true;
      await step.run(`${stepPrefix}-win-${questionsAsked}`, async () => {
        await broadcastToUser(
          sessionId,
          `Yes! The answer is "${setup.answer}"! You got it in ${questionsAsked} question${questionsAsked === 1 ? "" : "s"}!`,
          { type: "none" },
          { isGameOver: true, data: { won: true, questionsAsked, answer: setup.answer } },
        );
      });
    } else {
      // Get the AI's yes/no response
      const aiResponse = await runAgent<string>({
        step,
        name: `${stepPrefix}-answer-${questionsAsked}`,
        runId: "main",
        provider,
        prompt: twentyQuestionsAnswerPrompt(
          setup.answer,
          setup.category,
          userQuestion,
        ),
        config: {
          model: DEFAULT_MODEL,
          temperature: 0.3,
          maxTokens: 50,
        },
        fn: (response) => response.trim(),
      });

      // Show response and prompt for next question if questions remain
      await step.run(`${stepPrefix}-response-${questionsAsked}`, async () => {
        if (questionsRemaining > 0) {
          const nextQuestionKey = `twenty-q-${questionsAsked + 1}`;
          await broadcastToUser(
            sessionId,
            `${aiResponse}. (${questionsRemaining} questions remaining)`,
            {
              type: "text",
              placeholder: "Ask a yes/no question...",
              questionKey: nextQuestionKey,
            },
          );
        } else {
          // Last question answered, game over
          await broadcastToUser(
            sessionId,
            `${aiResponse}.\n\nGame over! You've used all ${maxQuestions} questions. The answer was: ${setup.answer}. Better luck next time!`,
            { type: "none" },
            { isGameOver: true, data: { won: false, questionsAsked, answer: setup.answer } },
          );
        }
      });
    }
  }

  return {
    won,
    answer: setup.answer,
    questionsAsked,
    message: won
      ? `You guessed "${setup.answer}" in ${questionsAsked} questions!`
      : `The answer was "${setup.answer}". You used all ${questionsAsked} questions.`,
  };
}
