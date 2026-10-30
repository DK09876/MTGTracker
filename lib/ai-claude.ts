/**
 * Calls to Claude, for lib/ai.ts: the same request as every other provider
 * (a system prompt, a message, a schema for the JSON answer), sent through
 * Anthropic's SDK with structured outputs, so the answer always fits the
 * schema. Server only.
 *
 * One try, at most one retry by the SDK: a long wait is worse than a quick
 * failure the owner can retry. Tests never reach Claude - claudeClient
 * refuses under vitest, and they pass a fake client instead.
 */

import Anthropic from '@anthropic-ai/sdk';

import type { JsonRequest } from './ai';
import type { Effort } from './models';

/** The part of the SDK client used here, so tests can pass their own. */
export interface ClaudeClient {
  messages: { stream: (params: Anthropic.MessageStreamParams, options?: Anthropic.RequestOptions) => { finalMessage: () => Promise<Anthropic.Message> } };
}

let client: Anthropic | null = null;

export function claudeClient(): ClaudeClient {
  if (process.env.VITEST) throw new Error('Claude is never called from tests - pass a fake client');
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1 });
  return client;
}

type Schema = { type?: string; nullable?: boolean; properties?: Record<string, Schema>; items?: Schema; required?: string[]; enum?: string[]; description?: string };

/**
 * Gemini's schema form (OBJECT, STRING, nullable) as the JSON Schema
 * structured outputs take: lower-case types, every object closed, and a
 * nullable field as "this or null".
 */
export function claudeSchema(s: Schema): Record<string, unknown> {
  const walk = (x: Schema): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    if (x.type) out.type = String(x.type).toLowerCase();
    if (x.description) out.description = x.description;
    if (x.enum) out.enum = x.enum;
    if (x.items) out.items = walk(x.items);
    if (x.properties) {
      out.properties = Object.fromEntries(Object.entries(x.properties).map(([k, v]) => [k, walk(v)]));
      out.required = x.required ?? [];
      out.additionalProperties = false;
    }
    return x.nullable ? { anyOf: [out, { type: 'null' }] } : out;
  };
  return walk(s);
}

export function claudeParams(model: string, request: JsonRequest, effort: Effort): Anthropic.MessageStreamParams {
  return {
    model,
    // Thinking counts towards this; a worked rules answer with its thinking
    // can run to 10K. Streamed, so a long one does not time out.
    max_tokens: request.maxOutputTokens ?? 32_000,
    // The system prompt is the same on every search and every tagging
    // request: cached, it costs a tenth on the next one within five minutes.
    system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: request.user }],
    thinking: { type: 'adaptive' },
    output_config: { effort, format: { type: 'json_schema', schema: claudeSchema(request.schema as Schema) } },
  };
}

export interface ClaudeAnswer {
  data: unknown;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

/** Why a Claude call failed, in the words lib/ai.ts reports. */
export class ClaudeFailure extends Error {
  constructor(message: string, readonly kind: 'busy' | 'stopped' | 'other', readonly usage?: ClaudeAnswer['usage']) {
    super(message);
  }
}

const usageOf = (m: Anthropic.Message): ClaudeAnswer['usage'] => ({
  input: m.usage.input_tokens ?? 0,
  output: m.usage.output_tokens ?? 0,
  cacheRead: m.usage.cache_read_input_tokens ?? 0,
  cacheWrite: m.usage.cache_creation_input_tokens ?? 0,
});

/** The JSON a reply carries, from its text blocks (thinking skipped). */
export function parseClaude(message: Anthropic.Message): unknown {
  if (message.stop_reason === 'refusal') throw new ClaudeFailure('Claude declined to answer that', 'other', usageOf(message));
  if (message.stop_reason === 'max_tokens') throw new ClaudeFailure('the answer was too long and got cut off', 'other', usageOf(message));
  const text = message.content.filter((b) => b.type === 'text').map((b) => (b as Anthropic.TextBlock).text).join('').trim();
  if (!text) throw new ClaudeFailure('the model returned nothing', 'other', usageOf(message));
  try {
    return JSON.parse(text);
  } catch {
    throw new ClaudeFailure('the model returned something other than JSON', 'other', usageOf(message));
  }
}

export async function callClaude(
  client: ClaudeClient, model: string, request: JsonRequest, effort: Effort, signal?: AbortSignal,
): Promise<ClaudeAnswer> {
  let message: Anthropic.Message;
  try {
    message = await client.messages.stream(claudeParams(model, request, effort), {
      signal, timeout: request.timeoutMs ?? 240_000,
    }).finalMessage();
  } catch (error) {
    throw failure(error, signal);
  }
  return { data: parseClaude(message), usage: usageOf(message) };
}

function failure(error: unknown, signal?: AbortSignal): ClaudeFailure {
  if (signal?.aborted || error instanceof Anthropic.APIUserAbortError) return new ClaudeFailure('stopped', 'stopped');
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new ClaudeFailure('Claude took too long', 'busy');
  if (error instanceof Anthropic.AuthenticationError) return new ClaudeFailure('the server\'s Anthropic key was refused', 'other');
  if (error instanceof Anthropic.RateLimitError) return new ClaudeFailure('Claude is turning requests away for a minute - try again shortly', 'busy');
  if (error instanceof Anthropic.APIError && (error.status ?? 0) >= 500) {
    return new ClaudeFailure('Claude is overloaded right now - try again in a few minutes', 'busy');
  }
  if (error instanceof Anthropic.APIError) return new ClaudeFailure(`Claude refused the request (${error.status}): ${error.message}`, 'other');
  if (error instanceof Anthropic.APIConnectionError) return new ClaudeFailure('could not reach Claude', 'busy');
  return new ClaudeFailure(error instanceof Error ? error.message : 'Claude failed', 'other');
}
