import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LLMMessage, LLMConfig, LLMResponse, LLMStreamChunk, ProviderConfig } from './index';

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;

  constructor(config: ProviderConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
  }

  async complete(messages: LLMMessage[], config: LLMConfig): Promise<LLMResponse> {
    const systemMessages = messages.filter(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');

    const response = await this.client.messages.create({
      model: config.model,
      max_tokens: config.maxTokens || 1024,
      temperature: config.temperature,
      top_p: config.topP,
      system: systemMessages.length > 0 ? systemMessages.map(m => m.content).join('\n') : undefined,
      messages: otherMessages.map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content,
      })),
      stream: false,
    });

    const content = response.content[0];
    return {
      content: content.type === 'text' ? content.text : '',
      finishReason: response.stop_reason || undefined,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
    };
  }

  async *stream(messages: LLMMessage[], config: LLMConfig): AsyncIterableIterator<LLMStreamChunk> {
    const systemMessages = messages.filter(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');

    const stream = await this.client.messages.create({
      model: config.model,
      max_tokens: config.maxTokens || 1024,
      temperature: config.temperature,
      top_p: config.topP,
      system: systemMessages.length > 0 ? systemMessages.map(m => m.content).join('\n') : undefined,
      messages: otherMessages.map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content,
      })),
      stream: true,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield {
          content: event.delta.text,
        };
      } else if (event.type === 'message_delta') {
        yield {
          content: '',
          finishReason: event.delta.stop_reason || undefined,
        };
      }
    }
  }
}
