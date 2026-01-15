import Mustache from "mustache";
import type { LLMMessage, Prompt, PromptMessage } from "./types";

/**
 * Options for hydrating prompts.
 */
export type HydratePromptOptions = {
  /**
   * If true, logs a warning when variables referenced in the template
   * are not provided in the variables object.
   * @default false
   */
  warnOnMissingVars?: boolean;

  /**
   * If true, throws an error when variables referenced in the template
   * are not provided in the variables object.
   * @default false
   */
  throwOnMissingVars?: boolean;

  /**
   * Custom logger function for warnings. Defaults to console.warn.
   */
  logger?: (message: string) => void;
};

/**
 * Regular expression to match Mustache variable references.
 * Matches: {{variableName}}, {{#section}}, {{/section}}, {{^inverted}}, etc.
 * Does not match: {{{unescaped}}} (triple braces for unescaped HTML)
 */
const MUSTACHE_VAR_REGEX = /\{\{([#^/]?)([^{}]+?)\}\}/g;

/**
 * Extract all variable names referenced in a Mustache template string.
 * This includes simple variables, section variables, and inverted sections.
 *
 * @param template - The Mustache template string
 * @returns Array of unique variable names found in the template
 *
 * @example
 * ```typescript
 * const vars = extractVariablesFromTemplate("Hello {{name}}, you have {{count}} messages");
 * // Returns: ["name", "count"]
 *
 * const vars2 = extractVariablesFromTemplate("{{#items}}Item: {{name}}{{/items}}");
 * // Returns: ["items", "name"]
 * ```
 */
export function extractVariablesFromTemplate(template: string): string[] {
  const variables = new Set<string>();
  let match;

  while ((match = MUSTACHE_VAR_REGEX.exec(template)) !== null) {
    const varName = match[2].trim();
    // Skip closing tags ({{/section}}) as they don't introduce new variables
    if (match[1] !== "/") {
      variables.add(varName);
    }
  }

  return Array.from(variables);
}

/**
 * Extract all variable names referenced across all messages in a prompt.
 *
 * @param messages - Array of prompt messages to scan
 * @returns Array of unique variable names found across all messages
 *
 * @example
 * ```typescript
 * const prompt: Prompt = {
 *   messages: [
 *     { role: "system", content: "You are a {{role}}" },
 *     { role: "user", content: "Analyze {{data}}" },
 *   ],
 *   variables: { role: "analyst", data: "sales figures" },
 * };
 *
 * const vars = extractVariablesFromMessages(prompt.messages);
 * // Returns: ["role", "data"]
 * ```
 */
export function extractVariablesFromMessages(
  messages: PromptMessage[],
): string[] {
  const allVariables = new Set<string>();

  for (const message of messages) {
    const vars = extractVariablesFromTemplate(message.content);
    for (const v of vars) {
      allVariables.add(v);
    }
  }

  return Array.from(allVariables);
}

/**
 * Find variables that are referenced in the template but not provided in the variables object.
 *
 * @param messages - Array of prompt messages to scan
 * @param variables - Variables object to check against
 * @returns Array of variable names that are missing
 */
function findMissingVariables(
  messages: PromptMessage[],
  variables: Record<string, unknown>,
): string[] {
  const referenced = extractVariablesFromMessages(messages);
  return referenced.filter((varName) => !(varName in variables));
}

/**
 * Hydrate a prompt template by substituting variables into message content.
 *
 * Uses Mustache templating syntax:
 * - `{{variable}}` - Insert variable (HTML-escaped by default)
 * - `{{{variable}}}` - Insert variable (unescaped, raw HTML)
 * - `{{#section}}...{{/section}}` - Conditional/loop section
 * - `{{^section}}...{{/section}}` - Inverted section (renders if falsy)
 *
 * **Note on escaping:** By default, Mustache escapes HTML special characters
 * (`<`, `>`, `&`, `"`, `'`) in variable values. For LLM prompts, this is usually
 * fine since you're not rendering HTML. If you need raw values, use triple
 * braces `{{{variable}}}`.
 *
 * **Note on missing variables:** Mustache silently ignores missing variables
 * by default (they render as empty strings). Use the `warnOnMissingVars` or
 * `throwOnMissingVars` options to catch these issues during development.
 *
 * @param prompt - The prompt template with messages and variables
 * @param options - Optional configuration for hydration behavior
 * @returns Array of hydrated LLM messages ready for the provider
 *
 * @example
 * ```typescript
 * const prompt: Prompt = {
 *   messages: [
 *     { role: "system", content: "You are a {{role}} assistant." },
 *     { role: "user", content: "Please analyze: {{data}}" },
 *   ],
 *   variables: {
 *     role: "helpful",
 *     data: "Q4 sales figures",
 *   },
 * };
 *
 * const messages = hydratePrompt(prompt);
 * // Returns:
 * // [
 * //   { role: "system", content: "You are a helpful assistant." },
 * //   { role: "user", content: "Please analyze: Q4 sales figures" },
 * // ]
 * ```
 *
 * @example
 * ```typescript
 * // With missing variable detection
 * const messages = hydratePrompt(prompt, {
 *   warnOnMissingVars: true,
 *   throwOnMissingVars: false,
 * });
 * ```
 */
export function hydratePrompt(
  prompt: Prompt,
  options: HydratePromptOptions = {},
): LLMMessage[] {
  const {
    warnOnMissingVars = false,
    throwOnMissingVars = false,
    logger = console.warn,
  } = options;

  // Check for missing variables if requested
  if (warnOnMissingVars || throwOnMissingVars) {
    const missing = findMissingVariables(prompt.messages, prompt.variables);

    if (missing.length > 0) {
      const message = `Missing prompt variables: ${missing.join(", ")}`;

      if (throwOnMissingVars) {
        throw new Error(message);
      }

      if (warnOnMissingVars) {
        logger(message);
      }
    }
  }

  return prompt.messages.map((message) => ({
    role: message.role,
    content: Mustache.render(message.content, prompt.variables),
  }));
}

/**
 * Create a prompt from a simple system and user message.
 * Convenience function for the common case of a single system prompt
 * and single user message.
 *
 * @param systemContent - The system message content (can include {{variables}})
 * @param userContent - The user message content (can include {{variables}})
 * @param variables - Variables to substitute into both messages
 * @returns A Prompt object ready for hydration
 *
 * @example
 * ```typescript
 * const prompt = createSimplePrompt(
 *   "You are a {{role}} assistant.",
 *   "Help me with: {{task}}",
 *   { role: "coding", task: "debugging this function" },
 * );
 * ```
 */
export function createSimplePrompt(
  systemContent: string,
  userContent: string,
  variables: Record<string, unknown> = {},
): Prompt {
  return {
    messages: [
      { role: "system", content: systemContent },
      { role: "user", content: userContent },
    ],
    variables,
  };
}

/**
 * Validate that all variables referenced in a prompt are provided.
 * Does not hydrate the prompt, just checks for completeness.
 *
 * @param prompt - The prompt to validate
 * @returns Object with valid flag and array of missing variable names
 *
 * @example
 * ```typescript
 * const result = validatePromptVariables(prompt);
 * if (!result.valid) {
 *   console.error("Missing variables:", result.missing);
 * }
 * ```
 */
export function validatePromptVariables(prompt: Prompt): {
  valid: boolean;
  missing: string[];
  referenced: string[];
} {
  const referenced = extractVariablesFromMessages(prompt.messages);
  const missing = referenced.filter(
    (varName) => !(varName in prompt.variables),
  );

  return {
    valid: missing.length === 0,
    missing,
    referenced,
  };
}
