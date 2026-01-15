/**
 * Prompt Templates for the Games with Branching Pipeline
 *
 * @module games-with-branching/prompts
 */

import type { Prompt } from "../../ai/types";

/**
 * Prompt for the game selector agent.
 */
export function gameSelectorPrompt(userChoice: string): Prompt {
  return {
    messages: [
      {
        role: "system",
        content: `You are a friendly game host. The user wants to play a game.

Based on their message, determine which game they want to play:
- "trivia" - True/False trivia game (10 questions)
- "twenty-questions" - Classic 20 questions guessing game

Respond in JSON format:
{
  "game": "trivia" or "twenty-questions",
  "message": "A friendly welcome message for the selected game"
}

If the user's choice is unclear, ask them to clarify by responding with the message field asking them to choose.`,
      },
      {
        role: "user",
        content: "{{userChoice}}",
      },
    ],
    variables: {
      userChoice,
    },
  };
}

/**
 * Prompt to generate a trivia question.
 */
export function triviaQuestionPrompt(questionNumber: number, randomSeed: number): Prompt {
  // Use the seed to pick a random topic for variety
  const topics = [
    "science", "history", "geography", "pop culture", "nature", "animals",
    "space", "ocean", "ancient civilizations", "music", "movies", "sports",
    "food", "technology", "literature", "art", "mythology", "human body",
    "weather", "inventions", "famous people", "world records", "languages",
    "architecture", "plants", "insects", "dinosaurs", "chemistry", "physics"
  ];

  const topicHint = topics[randomSeed % topics.length];

  return {
    messages: [
      {
        role: "system",
        content: `You are a trivia game host. Generate an interesting true/false trivia question.

Question number: {{questionNumber}} of 10

For THIS question, focus on the topic: {{topicHint}}

Generate a question that:
- Has a clear true or false answer
- Is interesting and educational
- Is UNIQUE - don't repeat common trivia questions
- Varies in difficulty

IMPORTANT: Be creative! Don't use obvious or overused trivia facts.

Respond in JSON format:
{
  "question": "The trivia question ending with True or False?",
  "answer": true or false
}`,
      },
      {
        role: "user",
        content: "Generate trivia question {{questionNumber}}. Random seed: {{seed}}",
      },
    ],
    variables: {
      questionNumber: questionNumber.toString(),
      topicHint,
      seed: randomSeed.toString(),
    },
  };
}

/**
 * Prompt for evaluating a trivia answer and giving feedback.
 */
export function triviaFeedbackPrompt(
  question: string,
  correctAnswer: boolean,
  userAnswer: boolean,
  currentScore: number,
  questionNumber: number,
): Prompt {
  return {
    messages: [
      {
        role: "system",
        content: `You are a trivia game host. The user just answered a question.

Question: {{question}}
Correct answer: {{correctAnswer}}
User's answer: {{userAnswer}}
Current score: {{currentScore}}/{{questionNumber}}

Provide brief, encouraging feedback. If wrong, explain the correct answer.
Keep it short (1-2 sentences).`,
      },
      {
        role: "user",
        content: "Give feedback on my answer",
      },
    ],
    variables: {
      question,
      correctAnswer: correctAnswer.toString(),
      userAnswer: userAnswer.toString(),
      currentScore: currentScore.toString(),
      questionNumber: questionNumber.toString(),
    },
  };
}

/**
 * Prompt to generate the 20 questions secret answer.
 */
export function twentyQuestionsSetupPrompt(randomSeed: number): Prompt {
  // Use the seed to pick a random category hint and theme
  // Note: using singular for the hint but the schema expects plural (people/places/things)
  const categoryHints = ["famous person", "well-known place", "common thing"];
  const themes = [
    "from nature", "from history", "from pop culture", "from science",
    "from sports", "from food", "from technology", "from art",
    "from music", "from movies", "from literature", "from geography",
    "that's an animal", "that's a landmark", "that's a vehicle",
    "from everyday life", "that's famous", "that's fictional"
  ];

  const categoryHint = categoryHints[randomSeed % categoryHints.length];
  const themeHint = themes[randomSeed % themes.length];

  return {
    messages: [
      {
        role: "system",
        content: `You are setting up a game of 20 Questions.

Choose a noun (person, place, or thing) for the player to guess.

IMPORTANT: Be creative and pick something DIFFERENT each game!
For this game, try to pick a {{categoryHint}} {{themeHint}}.

Requirements:
- Well-known enough that most people would recognize it
- Specific enough to be guessable in 20 yes/no questions
- Interesting and fun
- DO NOT pick common defaults like "Eiffel Tower" - be creative!

Respond in JSON format:
{
  "answer": "The secret noun",
  "category": "people", "places", or "things" (use EXACTLY one of these three words),
  "message": "I'm thinking of a [person/place/thing]. You have 20 yes/no questions to guess what it is. Ask away!"
}`,
      },
      {
        role: "user",
        content: "Set up a new game of 20 questions. Random seed: {{seed}}",
      },
    ],
    variables: {
      categoryHint,
      themeHint,
      seed: randomSeed.toString(),
    },
  };
}

/**
 * Prompt to answer a yes/no question in 20 questions.
 */
export function twentyQuestionsAnswerPrompt(
  secretAnswer: string,
  category: string,
  question: string,
): Prompt {
  return {
    messages: [
      {
        role: "system",
        content: `You are playing 20 Questions. You are thinking of: "{{secretAnswer}}" (category: {{category}})

The user asked: "{{question}}"

RULES:
1. NEVER reveal the secret answer
2. Answer ONLY with "Yes" or "No" based on whether the question is true about the secret answer
3. Be accurate and fair

Examples for secret "Blue Whale":
- "Is it an animal?" → "Yes"
- "Is it smaller than a car?" → "No"
- "Does it live in water?" → "Yes"
- "Is it a mammal?" → "Yes"

Respond with ONLY "Yes" or "No" - nothing else.`,
      },
      {
        role: "user",
        content: "{{question}}",
      },
    ],
    variables: {
      secretAnswer,
      category,
      question,
    },
  };
}

