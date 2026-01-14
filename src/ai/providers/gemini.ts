import { GoogleGenerativeAI } from '@google/generative-ai';
import type { LLMProvider, LLMMessage, LLMConfig, LLMResponse, LLMStreamChunk, ProviderConfig } from './index';

export class GeminiProvider implements LLMProvider {
  private client: GoogleGenerativeAI;

  constructor(config: ProviderConfig) {
    this.client = new GoogleGenerativeAI(config.apiKey);
  }

  async complete(messages: LLMMessage[], config: LLMConfig): Promise<LLMResponse> {
    const model = this.client.getGenerativeModel({
      model: config.model,
    });

    const systemMessages = messages.filter(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    const history = conversationMessages.slice(0, -1).map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));

    const chat = model.startChat({
      history,
      generationConfig: {
        temperature: config.temperature,
        maxOutputTokens: config.maxTokens,
        topP: config.topP,
      },
      systemInstruction: systemMessages.length > 0 ? systemMessages.map(m => m.content).join('\n') : undefined,
    });

    const lastMessage = conversationMessages[conversationMessages.length - 1];
    const result = await chat.sendMessage(lastMessage.content);
    const response = result.response;

    return {
      content: response.text(),
      finishReason: response.candidates?.[0]?.finishReason,
      usage: response.usageMetadata ? {
        promptTokens: response.usageMetadata.promptTokenCount || 0,
        completionTokens: response.usageMetadata.candidatesTokenCount || 0,
        totalTokens: response.usageMetadata.totalTokenCount || 0,
      } : undefined,
    };
  }

  async *stream(messages: LLMMessage[], config: LLMConfig): AsyncIterableIterator<LLMStreamChunk> {
    const model = this.client.getGenerativeModel({
      model: config.model,
    });

    const systemMessages = messages.filter(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    const history = conversationMessages.slice(0, -1).map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));

    const chat = model.startChat({
      history,
      generationConfig: {
        temperature: config.temperature,
        maxOutputTokens: config.maxTokens,
        topP: config.topP,
      },
      systemInstruction: systemMessages.length > 0 ? systemMessages.map(m => m.content).join('\n') : undefined,
    });

    const lastMessage = conversationMessages[conversationMessages.length - 1];
    const result = await chat.sendMessageStream(lastMessage.content);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        yield {
          content: text,
          finishReason: chunk.candidates?.[0]?.finishReason,
        };
      }
    }
  }
}
