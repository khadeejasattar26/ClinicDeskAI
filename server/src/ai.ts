import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import type { Config } from './config';
import type { Usage } from './domain';
import { mockEmbedding } from './demo-data';
export type AIMessage = ChatCompletionMessageParam;
export interface ToolCall { id: string; name: string; arguments: string }
export interface Completion { content: string | null; calls: ToolCall[]; promptTokens: number; completionTokens: number }
export interface AIProvider {
  model: string;
  embed(query: string): Promise<{ vector: number[]; tokens: number }>;
  complete(messages: AIMessage[], tools: ChatCompletionTool[]): Promise<Completion>;
}
export class OpenAIProvider implements AIProvider {
  model: string;
  private client: OpenAI;
  constructor(private config: Config, client?: OpenAI) {
    this.model = config.OPENAI_MODEL;
    this.client = client ?? new OpenAI({ apiKey: config.OPENAI_API_KEY, timeout: 20_000, maxRetries: 0 });
  }
  async embed(query: string) {
    const result = await this.client.embeddings.create({ model: this.config.OPENAI_EMBEDDING_MODEL, input: query, dimensions: 1536 });
    return { vector: result.data[0].embedding, tokens: result.usage.total_tokens };
  }
  async complete(messages: AIMessage[], tools: ChatCompletionTool[]): Promise<Completion> {
    const result = await this.client.chat.completions.create({ model: this.model, messages, tools, parallel_tool_calls: false, max_completion_tokens: 600 });
    const message = result.choices[0].message;
    return { content: message.content, calls: (message.tool_calls ?? []).flatMap(call => call.type === 'function' ? [{ id: call.id, name: call.function.name, arguments: call.function.arguments }] : []), promptTokens: result.usage?.prompt_tokens ?? 0, completionTokens: result.usage?.completion_tokens ?? 0 };
  }
}
export class MockAIProvider implements AIProvider {
  model = 'mock-clinicdesk-v1';
  async embed(query: string) { return { vector: mockEmbedding(query), tokens: 0 }; }
  async complete(messages: AIMessage[], _tools: ChatCompletionTool[]): Promise<Completion> {
    const last = messages.at(-1)!;
    const reply = (content: string): Completion => ({ content, calls: [], promptTokens: 0, completionTokens: 0 });
    const call = (name: string, args: unknown): Completion => ({ content: null, calls: [{ id: `mock-${messages.length}`, name, arguments: JSON.stringify(args) }], promptTokens: 0, completionTokens: 0 });
    const text = messages.filter(m => m.role === 'user').at(-1)?.content as string ?? '';
    if (last.role === 'tool') {
      const result = JSON.parse(String(last.content));
      if (result.documents) return reply(result.documents.length ? `${result.documents[0].content}\n\nSource: ${result.documents[0].title}` : "I don't have that information in the clinic documents. I can capture your enquiry or connect you with reception.");
      if (result.slots) return reply(result.slots.length ? 'Here are the next available appointments. Choose a time and share your contact details. I will ask you to confirm before booking.' : 'There are no available appointments in that period. I can connect you with reception.');
      return reply('Reception can help with your request.');
    }
    if (/\b(book|appointment|availability|slots)\b/i.test(text)) return call('get_available_slots', { date_from: new Date().toISOString(), date_to: new Date(Date.now() + 14 * 86400_000).toISOString() });
    return call('search_knowledge_base', { query: /opening|hours/i.test(text) ? 'opening hours' : /fee|price|cost/i.test(text) ? 'consultation fees' : text });
  }
}
export function createAI(config: Config): AIProvider {
  if (config.MOCK_LLM) return new MockAIProvider();
  if (!config.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required when MOCK_LLM=false');
  return new OpenAIProvider(config);
}
export function usageCost(config: Config, prompt: number, completion: number): number { return (prompt * config.OPENAI_INPUT_COST_PER_MILLION + completion * config.OPENAI_OUTPUT_COST_PER_MILLION) / 1_000_000; }
export function usageRow(conversationId: string, model: string, latency: number, prompt: number, completion: number, cost: number): Usage {
  return { conversation_id: conversationId, model, latency_ms: Math.round(latency), prompt_tokens: prompt, completion_tokens: completion, estimated_cost_usd: cost };
}
