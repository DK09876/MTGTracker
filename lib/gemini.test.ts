/**
 * The model's side of translation: what is sent, and what is accepted back.
 *
 * No real model here. What matters is that a malformed answer is refused
 * rather than run as a query, and that a missing key switches the feature
 * off instead of failing every search.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { GeminiError, geminiTranslator, parseTranslation } from './gemini';

const reply = (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] });

describe('parseTranslation', () => {
  it('reads the JSON the model was asked for', () => {
    expect(parseTranslation(reply('{"explanation":"Green ramp","commander":null,"query":"otag:ramp c:g"}')))
      .toEqual({ query: 'otag:ramp c:g', explanation: 'Green ramp', commander: null });
  });

  it('treats a blank commander as none', () => {
    expect(parseTranslation(reply('{"explanation":"x","commander":"  ","query":"t:elf"}')).commander).toBeNull();
  });

  it('refuses an empty query rather than searching for nothing', () => {
    expect(() => parseTranslation(reply('{"explanation":"x","commander":null,"query":" "}'))).toThrow(GeminiError);
  });

  it('refuses prose', () => {
    expect(() => parseTranslation(reply('Sure! Try t:elf'))).toThrow(/other than JSON/);
  });

  it('refuses a response with no candidates, as a blocked prompt returns', () => {
    expect(() => parseTranslation({ promptFeedback: { blockReason: 'OTHER' } })).toThrow(/nothing/);
  });
});

describe('geminiTranslator', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('is off without an API key', () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    expect(geminiTranslator()).toBeNull();
  });

  it('sends the key as a header, never in the URL', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'secret-key');
    vi.stubEnv('GEMINI_MODEL', 'some-model');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(
      reply('{"explanation":"x","commander":null,"query":"t:elf"}'),
    )));
    vi.stubGlobal('fetch', fetchMock);

    await geminiTranslator()!('elves');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/models/some-model:generateContent');
    expect(url).not.toContain('secret-key');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('secret-key');
  });

  it('passes feedback from a failed attempt back to the model', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'k');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(
      reply('{"explanation":"x","commander":null,"query":"t:elf"}'),
    )));
    vi.stubGlobal('fetch', fetchMock);

    await geminiTranslator()!('elves', 'Scryfall found no cards');

    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.contents[0].parts[0].text).toContain('Scryfall found no cards');
  });

  it('turns an API error into a readable message', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'k');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 },
    )));
    await expect(geminiTranslator()!('elves')).rejects.toThrow('the model returned 400: API key not valid');
  });
});
