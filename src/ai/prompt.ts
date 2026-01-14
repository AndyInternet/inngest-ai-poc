import Mustache from "mustache";
import type { LLMMessage } from "./providers/index";

export type PromptMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type Prompt = {
  messages: PromptMessage[];
  variables: Record<string, string>;
};

export function hydratePrompt(prompt: Prompt): LLMMessage[] {
  return prompt.messages.map((message) => ({
    role: message.role,
    content: Mustache.render(message.content, prompt.variables),
  }));
}
