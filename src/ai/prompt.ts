import Mustache from "mustache";
import type { LLMMessage, Prompt } from "./types";

export function hydratePrompt(prompt: Prompt): LLMMessage[] {
  return prompt.messages.map((message) => ({
    role: message.role,
    content: Mustache.render(message.content, prompt.variables),
  }));
}
