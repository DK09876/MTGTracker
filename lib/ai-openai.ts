/**
 * Calls to models served over the OpenAI-style chat API - Mistral and Groq -
 * for lib/ai.ts, which also calls Gemini its own way. The request is the same
 * (a system prompt, a message, a schema for the JSON answer); the schema is
 * translated from Gemini's form, and the answer read back from whichever
 * shape the provider sends (Magistral's comes as thinking and text parts).
 */

import type { JsonRequest } from './ai';
import type { Provider } from './models';

const BASE: Partial<Record<Provider, string>> = {
  mistral: 'https://api.mistral.ai/v1',
  groq: 'https://api.groq.com/openai/v1',
};

type Schema = { type?: string; nullable?: boolean; properties?: Record<string, Schema>; items?: Schema; required?: string[]; enum?: string[]; [k: string]: unknown };

/** Gemini's schema form (OBJECT, STRING, propertyOrdering) as JSON Schema. */
export function toJsonSchema(s: Schema): { schema: Record<string, unknown>; strict: boolean } {
  let strict = true;
  const walk = (x: Schema): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    if (x.type) out.type = x.nullable ? [String(x.type).toLowerCase(), 'null'] : String(x.type).toLowerCase();
    if (x.enum) out.enum = x.enum;
    if (x.items) out.items = walk(x.items);
    if (x.properties) {
      out.properties = Object.fromEntries(Object.entries(x.properties).map(([k, v]) => [k, walk(v)]));
      out.required = x.required ?? [];
      out.additionalProperties = false;
      // Strict schemas need every property required.
      if (Object.keys(x.properties).some((k) => !(x.required ?? []).includes(k))) strict = false;
    }
    return out;
  };
  return { schema: walk(s), strict };
}

export async function callOpenAI(
  provider: Provider, key: string, model: string, request: JsonRequest, timeoutMs: number, signal?: AbortSignal,
): Promise<Response> {
  const { schema, strict } = toJsonSchema(request.schema as Schema);
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.user }],
    temperature: request.temperature ?? 0.2,
    response_format: { type: 'json_schema', json_schema: { name: 'answer', schema, strict } },
  };
  // GPT-OSS takes an effort level for its reasoning; keep it moderate on
  // Groq's free tier, whose token-a-minute cap counts the thinking too.
  if (provider === 'groq' && model.includes('gpt-oss')) body.reasoning_effort = request.thinking === 'low' ? 'low' : 'medium';
  const signals = [AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])];
  return fetch(`${BASE[provider]}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.any(signals),
  });
}

/** The JSON a chat completion carries: the text parts of the reply, thinking skipped, fences stripped. */
export function parseOpenAIJson(body: unknown): unknown {
  const content = (body as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.filter((p: { type?: string }) => p?.type === 'text').map((p: { text?: string }) => p.text ?? '').join('')
      : '';
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  if (!cleaned) throw new Error('the model returned nothing');
  return JSON.parse(cleaned);
}

/** Seconds to wait from a Retry-After header, as milliseconds, or null. */
export function retryAfterHeader(res: Response): number | null {
  const v = Number(res.headers.get('retry-after'));
  return Number.isFinite(v) && v > 0 ? v * 1000 : null;
}
