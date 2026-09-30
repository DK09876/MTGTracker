import { afterEach, describe, expect, it, vi } from 'vitest';

import { testing, type Usage } from './ai';
import { parseOpenAIJson, toJsonSchema } from './ai-openai';
import { providerOf } from './models';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const noWait = async () => {};
const usage = (models: string[]): Usage => ({ available: () => models, called: () => {}, spent: () => {} });
const chat = (content: unknown) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

describe('toJsonSchema', () => {
  it('lowers Gemini types, closes objects, and is strict only when every property is required', () => {
    const all = toJsonSchema({ type: 'OBJECT', properties: { a: { type: 'STRING', nullable: true }, b: { type: 'ARRAY', items: { type: 'INTEGER' } } }, required: ['a', 'b'], propertyOrdering: ['a', 'b'] });
    expect(all).toEqual({
      strict: true,
      schema: { type: 'object', properties: { a: { type: ['string', 'null'] }, b: { type: 'array', items: { type: 'integer' } } }, required: ['a', 'b'], additionalProperties: false },
    });
    expect(toJsonSchema({ type: 'OBJECT', properties: { a: { type: 'STRING' } } }).strict).toBe(false);
  });
});

describe('parseOpenAIJson', () => {
  it('reads string content, fenced or not', () => {
    expect(parseOpenAIJson({ choices: [{ message: { content: '```json\n{"a":1}\n```' } }] })).toEqual({ a: 1 });
  });
  it('keeps only the text parts of a thinking model\'s reply', () => {
    expect(parseOpenAIJson({ choices: [{ message: { content: [{ type: 'thinking', thinking: [] }, { type: 'text', text: '{"b":2}' }] } }] })).toEqual({ b: 2 });
  });
  it('refuses an empty reply', () => {
    expect(() => parseOpenAIJson({ choices: [{ message: { content: '' } }] })).toThrow();
  });
});

describe('providerOf', () => {
  it('knows each provider by its ids', () => {
    expect(providerOf('gemini-3.5-flash-lite')).toBe('gemini');
    expect(providerOf('magistral-medium-latest')).toBe('mistral');
    expect(providerOf('openai/gpt-oss-120b')).toBe('groq');
  });
});

describe('generate across providers', () => {
  it('sends Groq models to Groq with its own key, and reads the chat answer', async () => {
    vi.stubEnv('GROQ_API_KEY', 'groq-key');
    const fetch = vi.fn().mockResolvedValue(chat('{"ok":true}'));
    vi.stubGlobal('fetch', fetch);
    const answer = await testing.generate('gemini-key', usage(['openai/gpt-oss-120b']), { system: 's', user: 'u', schema: { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } }, required: ['ok'] }, thinking: 'low' }, {}, noWait);
    expect(answer).toEqual({ data: { ok: true }, model: 'openai/gpt-oss-120b' });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer groq-key');
    const body = JSON.parse(String(init.body));
    expect(body.reasoning_effort).toBe('low');
    expect(body.response_format.json_schema.strict).toBe(true);
  });

  it('asks again once when Groq refuses the model\'s JSON for missing the schema', async () => {
    vi.stubEnv('GROQ_API_KEY', 'groq-key');
    const shape = () => new Response(JSON.stringify({ error: { message: 'Generated JSON does not match the expected schema. Please adjust your prompt.', code: 'json_validate_failed' } }), { status: 400 });
    const fetch = vi.fn().mockResolvedValueOnce(shape()).mockResolvedValueOnce(chat('{"ok":true}'));
    vi.stubGlobal('fetch', fetch);
    const answer = await testing.generate('', usage(['openai/gpt-oss-120b']), { system: 's', user: 'u', schema: {} }, {}, noWait);
    expect(answer.data).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('falls back to Gemini when the chosen provider is rate limited', async () => {
    vi.stubEnv('MISTRAL_API_KEY', 'm-key');
    const gemini = new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] }), { status: 200 });
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('{"message":"Rate limit exceeded"}', { status: 429, headers: { 'retry-after': '120' } }))
      .mockResolvedValueOnce(gemini);
    vi.stubGlobal('fetch', fetch);
    const answer = await testing.generate('gemini-key', usage(['mistral-medium-latest', 'gemini-3.5-flash-lite']), { system: 's', user: 'u', schema: {} }, {}, noWait);
    expect(answer.model).toBe('gemini-3.5-flash-lite');
    expect(String(fetch.mock.calls[1][0])).toContain('generativelanguage.googleapis.com');
  });
});
