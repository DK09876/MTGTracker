/**
 * The model's side of translation: what is sent, and what is accepted back.
 *
 * No real model here. What matters is that a malformed answer is refused
 * rather than run as a query, and that a missing key switches the feature
 * off instead of failing every search.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { GeminiError, geminiTranslator, parseTranslation, userMessage } from './gemini';

const reply = (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] });

const json = (o: object) => reply(JSON.stringify(o));
const base = { kind: 'cards', cardName: null, commander: null, explanation: 'x', query: 't:elf' };

describe('parseTranslation', () => {
  it('reads a plan', () => {
    expect(parseTranslation(json({ ...base, commander: 'azula', explanation: 'Elves' })))
      .toEqual({ kind: 'cards', cardName: null, commander: 'azula', explanation: 'Elves', query: 't:elf' });
  });

  it('drops the query when the input was a card name', () => {
    expect(parseTranslation(json({ ...base, kind: 'card', cardName: 'Lightning Bolt', query: '-"Lightning Bolt"' })))
      .toMatchObject({ kind: 'card', cardName: 'Lightning Bolt', query: '' });
  });

  it('refuses a card lookup with no card', () => {
    expect(() => parseTranslation(json({ ...base, kind: 'card' }))).toThrow(/named no card/);
  });

  it('treats a bare name filed as "cards" as a card lookup', () => {
    expect(parseTranslation(json({ ...base, query: '', cardName: 'Sol Ring' })).kind).toBe('card');
  });

  it('lets "cards for a commander" have no query', () => {
    expect(parseTranslation(json({ ...base, query: '', commander: 'Azula' })).query).toBe('');
  });

  it('refuses combos about nothing', () => {
    expect(() => parseTranslation(json({ ...base, kind: 'combos', query: '' }))).toThrow(/without saying which/);
  });

  it('reads an unknown kind as a card search', () => {
    expect(parseTranslation(json({ ...base, kind: 'banana' })).kind).toBe('cards');
  });

  it('treats a blank commander as none', () => {
    expect(parseTranslation(json({ ...base, commander: '  ' })).commander).toBeNull();
  });

  it('refuses an empty search', () => {
    expect(() => parseTranslation(json({ ...base, query: ' ' }))).toThrow(GeminiError);
  });

  it('refuses prose', () => {
    expect(() => parseTranslation(reply('Sure! Try t:elf'))).toThrow(/other than JSON/);
  });

  it('refuses a response with no candidates, as a blocked prompt returns', () => {
    expect(() => parseTranslation({ promptFeedback: { blockReason: 'OTHER' } })).toThrow(/nothing/);
  });
});

describe('userMessage', () => {
  const today = new Date('2026-09-24T12:00:00Z');

  it('gives the date, so "new cards" can be worked out', () => {
    expect(userMessage('new red cards', {}, today)).toContain('Today is 2026-09-24.');
  });

  it('frames a follow-up around the search that ran', () => {
    const text = userMessage('only instants', {
      previous: { request: 'green ramp for omnath', kind: 'cards', commander: 'Omnath, Locus of Creation', query: 'otag:ramp c:g' },
    }, today);
    expect(text).toContain('Earlier request: green ramp for omnath');
    expect(text).toContain('kind cards; commander Omnath, Locus of Creation; query otag:ramp c:g');
    expect(text).toContain('Follow-up: only instants');
    expect(text).not.toContain('Request:');
  });

  it('includes the commander\'s rules text and the reason a try failed', () => {
    const text = userMessage('enchantments for azula', {
      commander: { name: 'Fire Lord Azula', manaCost: '{1}{U}{B}{R}', typeLine: 'Legendary Creature', text: 'copy that spell' },
      feedback: 'found no cards',
    }, today);
    expect(text).toContain('The commander is Fire Lord Azula {1}{U}{B}{R}');
    expect(text).toContain('copy that spell');
    expect(text).toContain('did not work: found no cards');
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
      reply('{"kind":"cards","explanation":"x","commander":null,"cardName":null,"query":"t:elf"}'),
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
      reply('{"kind":"cards","explanation":"x","commander":null,"cardName":null,"query":"t:elf"}'),
    )));
    vi.stubGlobal('fetch', fetchMock);

    await geminiTranslator()!('elves', { feedback: 'Scryfall found no cards' });

    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.contents[0].parts[0].text).toContain('Scryfall found no cards');
  });

  it('retries once when the model is momentarily overloaded', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'k');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":{"message":"high demand"}}', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(reply('{"kind":"cards","explanation":"x","commander":null,"cardName":null,"query":"t:elf"}'))));
    vi.stubGlobal('fetch', fetchMock);

    expect((await geminiTranslator()!('elves')).query).toBe('t:elf');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry past the second 503', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'k');
    const fetchMock = vi.fn(async () => new Response('{"error":{"message":"high demand"}}', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(geminiTranslator()!('elves')).rejects.toThrow('the model returned 503: high demand');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('turns an API error into a readable message', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'k');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 },
    )));
    await expect(geminiTranslator()!('elves')).rejects.toThrow('the model returned 400: API key not valid');
  });
});
