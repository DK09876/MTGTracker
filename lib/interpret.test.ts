/**
 * Routing a search.
 *
 * Scryfall and the model are stand-ins here: each test says what they would
 * answer, and checks which of them got asked what, and in what order.
 */

import { describe, expect, it, vi } from 'vitest';

import type { Translation } from './gemini';
import { interpret, type Deps } from './interpret';
import { ScryfallError, type ScryfallCard, type SearchResult } from './scryfall';

const card = (name: string, over: Partial<ScryfallCard> = {}): ScryfallCard =>
  ({ id: name.toLowerCase().replace(/\W+/g, '-'), name, ...over }) as ScryfallCard;

const found = (...names: string[]): SearchResult =>
  ({ cards: names.map((n) => card(n)), totalCards: names.length, hasMore: false });

const nothing = found();

const said = (query: string, over: Partial<Translation> = {}): Translation =>
  ({ query, explanation: 'Something', commander: null, ...over });

function deps(over: Partial<Deps> = {}): Deps {
  return {
    search: vi.fn(async () => found('Llanowar Elves')),
    findCardNamed: vi.fn(async () => null),
    translate: vi.fn(async () => said('otag:ramp c:g')),
    ...over,
  };
}

describe('interpret', () => {
  it('sends syntax straight to Scryfall without asking the model', async () => {
    const d = deps();
    const result = await interpret('t:goblin c:r', d);
    expect(d.search).toHaveBeenCalledWith('t:goblin c:r');
    expect(d.translate).not.toHaveBeenCalled();
    expect(result.interpretation).toEqual({ via: 'syntax', query: 't:goblin c:r' });
  });

  it('does nothing for an empty search', async () => {
    const d = deps();
    const result = await interpret('   ', d);
    expect(d.search).not.toHaveBeenCalled();
    expect(result.cards).toEqual([]);
  });

  it('translates English and reports what it ran', async () => {
    const d = deps({ translate: vi.fn(async () => said('otag:ramp c:g -t:land', { explanation: 'Green ramp' })) });
    const result = await interpret('green ramp that is not a land', d);
    expect(d.search).toHaveBeenCalledWith('otag:ramp c:g -t:land');
    expect(result.cards.map((c) => c.name)).toEqual(['Llanowar Elves']);
    expect(result.interpretation).toEqual({ via: 'ai', query: 'otag:ramp c:g -t:land', explanation: 'Green ramp' });
  });

  // The model is trusted with the commander's name, not its colours.
  it('adds the commander\'s identity from Scryfall, not from the model', async () => {
    const d = deps({
      translate: vi.fn(async () => said('otag:board-wipe order:edhrec', { commander: 'Atraxa' })),
      findCardNamed: vi.fn(async () => card('Atraxa, Praetors\' Voice', { color_identity: ['W', 'U', 'B', 'G'] })),
    });
    await interpret('board wipes for atraxa', d);
    expect(d.findCardNamed).toHaveBeenCalledWith('Atraxa');
    expect(d.search).toHaveBeenCalledWith('otag:board-wipe order:edhrec id<=wubg');
  });

  it('gives a colourless commander a colourless identity', async () => {
    const d = deps({
      translate: vi.fn(async () => said('t:artifact', { commander: 'Karn' })),
      findCardNamed: vi.fn(async () => card('Karn, Silver Golem', { color_identity: [] })),
    });
    await interpret('artifacts for karn', d);
    expect(d.search).toHaveBeenCalledWith('t:artifact id<=c');
  });

  it('leaves the query alone when the commander cannot be found', async () => {
    const d = deps({ translate: vi.fn(async () => said('t:elf', { commander: 'Nobody Real' })) });
    await interpret('elves for nobody real', d);
    expect(d.search).toHaveBeenCalledWith('t:elf');
  });

  it('shows the model why a query was rejected and tries again', async () => {
    const translate = vi.fn()
      .mockResolvedValueOnce(said('bogus:thing'))
      .mockResolvedValueOnce(said('t:dragon'));
    const search = vi.fn()
      .mockRejectedValueOnce(new ScryfallError('Unknown keyword "bogus"', 400))
      .mockResolvedValueOnce(found('Shivan Dragon'));
    const result = await interpret('dragons', deps({ translate, search }));

    expect(translate).toHaveBeenLastCalledWith('dragons', expect.stringContaining('Unknown keyword "bogus"'));
    expect(result.cards.map((c) => c.name)).toEqual(['Shivan Dragon']);
    expect(result.interpretation.query).toBe('t:dragon');
  });

  // An unknown otag is not an error to Scryfall, just an empty result.
  it('treats no results as worth one more try', async () => {
    const translate = vi.fn()
      .mockResolvedValueOnce(said('otag:made-up'))
      .mockResolvedValueOnce(said('o:"add {G}"'));
    const search = vi.fn()
      .mockResolvedValueOnce(nothing)
      .mockResolvedValueOnce(found('Elvish Mystic'));
    const result = await interpret('mana elves', deps({ translate, search }));

    expect(translate).toHaveBeenLastCalledWith('mana elves', expect.stringContaining('found no cards for otag:made-up'));
    expect(result.cards.map((c) => c.name)).toEqual(['Elvish Mystic']);
  });

  it('stops after two translations and falls back to the nearest card name', async () => {
    const translate = vi.fn(async () => said('!"Emrakul the Timeless"'));
    const findCardNamed = vi.fn(async () => card('Emrakul, the Aeons Torn'));
    const result = await interpret('emrakul aeon torn', deps({ translate, findCardNamed, search: vi.fn(async () => nothing) }));

    expect(translate).toHaveBeenCalledTimes(2);
    expect(findCardNamed).toHaveBeenCalledWith('emrakul aeon torn');
    expect(result.cards.map((c) => c.name)).toEqual(['Emrakul, the Aeons Torn']);
    expect(result.interpretation).toMatchObject({ via: 'name', query: '!"Emrakul, the Aeons Torn"' });
  });

  it('keeps the last translation on screen when nothing is found at all', async () => {
    const result = await interpret('purple cards', deps({
      translate: vi.fn(async () => said('c:purple', { explanation: 'Purple cards' })),
      search: vi.fn(async () => nothing),
    }));
    expect(result.cards).toEqual([]);
    expect(result.interpretation).toMatchObject({ via: 'ai', query: 'c:purple', explanation: 'Purple cards' });
  });

  it('searches as typed, and says so, when no model is configured', async () => {
    const d = deps({ translate: null });
    const result = await interpret('Lightning Bolt', d);
    expect(d.search).toHaveBeenCalledWith('Lightning Bolt');
    expect(result.interpretation.note).toMatch(/AI search is off/);
  });

  it('falls back to a plain search when the model fails', async () => {
    const d = deps({ translate: vi.fn(async () => { throw new Error('the model took too long'); }) });
    const result = await interpret('Lightning Bolt', d);
    expect(d.search).toHaveBeenCalledWith('Lightning Bolt');
    expect(result.interpretation.note).toMatch(/the model took too long/);
  });

  it('uses the first answer when only the retry fails', async () => {
    const translate = vi.fn()
      .mockResolvedValueOnce(said('otag:made-up', { explanation: 'First go' }))
      .mockRejectedValueOnce(new Error('timeout'));
    const result = await interpret('something odd', deps({ translate, search: vi.fn(async () => nothing) }));
    expect(result.interpretation).toMatchObject({ via: 'ai', query: 'otag:made-up' });
  });

  it('lets a Scryfall outage through rather than retrying the model', async () => {
    const translate = vi.fn(async () => said('t:dragon'));
    const search = vi.fn(async () => { throw new ScryfallError('Scryfall returned 503', 503); });
    await expect(interpret('dragons', deps({ translate, search }))).rejects.toThrow('503');
    expect(translate).toHaveBeenCalledTimes(1);
  });
});
