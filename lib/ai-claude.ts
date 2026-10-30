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

type Params = Parameters<Anthropic['beta']['messages']['stream']>[0];

/** The part of the SDK client used here, so tests can pass their own. */
export interface ClaudeClient {
  beta: { messages: { stream: (params: Params, options?: Anthropic.RequestOptions) => { finalMessage: () => Promise<Anthropic.Beta.BetaMessage> } } };
}

/**
 * Anthropic re-runs a declined request on another model, chosen by why it
 * was declined. Asked to write out its working, every Claude model declined
 * rules questions as "reasoning_extraction" (2026-10-30); the fallback
 * answers them. The reply says which model did, and is priced as that one.
 */
const FALLBACKS = (): Pick<Params, 'fallbacks' | 'betas'> => ({ fallbacks: 'default', betas: ['server-side-fallback-2026-07-01'] });

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

/**
 * Schemas Claude would not enforce: structured outputs compile a schema to a
 * grammar, and the rules answer's (a worked answer, a trigger worksheet,
 * checks, citations) is too large for it (2026-10-30). Those are asked for
 * in the prompt instead and read back leniently. Remembered per process, so
 * each costs one refused request - which is not charged - per restart.
 */
const tooLarge = new Set<string>();

export function claudeParams(model: string, request: JsonRequest, effort: Effort, strict = true): Params {
  const schema = claudeSchema(request.schema as Schema);
  if (!strict) {
    return {
      model,
      max_tokens: request.maxOutputTokens ?? 32_000,
      system: [
        { type: 'text', text: request.system, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: `Reply with one JSON object and nothing else - no code fences, no prose - matching this JSON Schema:\n${JSON.stringify(schema)}` },
      ],
      messages: [{ role: 'user', content: request.user }],
      thinking: { type: 'adaptive' },
      output_config: { effort },
      ...FALLBACKS(),
    };
  }
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
    output_config: { effort, format: { type: 'json_schema', schema } },
    ...FALLBACKS(),
  };
}

export interface ClaudeAnswer {
  data: unknown;
  /** The model that answered: the one asked, or Anthropic's fallback for it. */
  model: string;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

/** Why a Claude call failed, in the words lib/ai.ts reports. */
export class ClaudeFailure extends Error {
  constructor(message: string, readonly kind: 'busy' | 'stopped' | 'other', readonly usage?: ClaudeAnswer['usage'], readonly model?: string) {
    super(message);
  }
}

const usageOf = (m: Anthropic.Beta.BetaMessage): ClaudeAnswer['usage'] => ({
  input: m.usage.input_tokens ?? 0,
  output: m.usage.output_tokens ?? 0,
  cacheRead: m.usage.cache_read_input_tokens ?? 0,
  cacheWrite: m.usage.cache_creation_input_tokens ?? 0,
});

/** The JSON a reply carries, from its text blocks (thinking skipped). */
export function parseClaude(message: Anthropic.Beta.BetaMessage): unknown {
  if (message.stop_reason === 'refusal') {
    const category = (message as { stop_details?: { category?: string | null } }).stop_details?.category;
    throw new ClaudeFailure(`Claude declined to answer that${category ? ` (${category})` : ''}`, 'other', usageOf(message), message.model);
  }
  if (message.stop_reason === 'max_tokens') throw new ClaudeFailure('the answer was too long and got cut off', 'other', usageOf(message), message.model);
  const text = message.content.filter((b) => b.type === 'text').map((b) => (b as Anthropic.Beta.BetaTextBlock).text).join('').trim();
  if (!text) throw new ClaudeFailure('the model returned nothing', 'other', usageOf(message), message.model);
  // Strict answers are bare JSON; one asked for in the prompt may come fenced or with a word around it.
  const unfenced = text.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  for (const candidate of [unfenced, unfenced.slice(unfenced.indexOf('{'), unfenced.lastIndexOf('}') + 1)]) {
    try {
      return JSON.parse(candidate);
    } catch { /* try the next reading */ }
  }
  throw new ClaudeFailure('the model returned something other than JSON', 'other', usageOf(message), message.model);
}

export async function callClaude(
  client: ClaudeClient, model: string, request: JsonRequest, effort: Effort, signal?: AbortSignal,
): Promise<ClaudeAnswer> {
  const key = JSON.stringify(request.schema);
  const send = (strict: boolean) => client.beta.messages.stream(claudeParams(model, request, effort, strict), {
    signal, timeout: request.timeoutMs ?? 240_000,
  }).finalMessage();
  let message: Anthropic.Beta.BetaMessage;
  try {
    try {
      message = await send(!tooLarge.has(key));
    } catch (error) {
      if (!(error instanceof Anthropic.BadRequestError) || !/grammar is too large|schema is too complex/i.test(error.message)) throw error;
      tooLarge.add(key);
      message = await send(false);
    }
  } catch (error) {
    throw failure(error, signal);
  }
  return { data: parseClaude(message), model: message.model, usage: usageOf(message) };
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
