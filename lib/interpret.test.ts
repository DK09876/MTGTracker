/**
 * Routing a search.
 *
 * Scryfall, Commander Spellbook, EDHREC and the model are all stand-ins
 * here: each test says what they would answer, and checks which of them got
 * asked what. Nothing leaves the machine and nothing costs model usage.
 */

import { describe, expect, it, vi } from 'vitest';

import type { CommanderStats } from './edhrec';
import type { Translation } from './gemini';
import { interpret, runQuery, scoped, type Deps } from './interpret';
import { ScryfallError, type ScryfallCard, type SearchResult } from './scryfall';
import { SpellbookError, type Combo } from './spellbook';

const card = (name: string, over: Partial<ScryfallCard> = {}): ScryfallCard =>
  ({ id: name.toLowerCase().replace(/\W+/g, '-'), name, ...over }) as ScryfallCard;

const found = (...names: string[]): SearchResult =>
  ({ cards: names.map((n) => card(n)), totalCards: names.length, hasMore: false });

const nothing = found();

const plan = (over: Partial<Translation> = {}): Translation =>
  ({ kind: 'cards', query: 'otag:ramp c:g', explanation: 'Something', commander: null, cardName: null, ...over });

const azula = card('Fire Lord Azula', {
  color_identity: ['U', 'B', 'R'],
  mana_cost: '{1}{U}{B}{R}',
  type_line: 'Legendary Creature — Human Noble',
  oracle_text: 'Whenever you cast a spell while Fire Lord Azula is attacking, copy that spell.',
});

const combo = (id: string, cards: string[], over: Partial<Combo> = {}): Combo => ({
  id, cards, produces: ['Infinite mana'], steps: '', prerequisites: '', identity: 'UR',
  popularity: 10, price: 5, url: `https://commanderspellbook.com/combo/${id}`, ...over,
});

function deps(over: Partial<Deps> = {}): Deps {
  return {
    search: vi.fn(async () => found('Llanowar Elves')),
    findCardNamed: vi.fn(async () => null),
    findCommander: vi.fn(async () => null),
    cardsNamed: vi.fn(async (names: string[]) => names.map((n) => card(n))),
    searchCombos: vi.fn(async () => []),
    commanderStats: null,
    translate: vi.fn(async () => plan()),
    ...over,
  };
}

describe('syntax and fallbacks', () => {
  it('sends syntax straight to Scryfall without asking the model', async () => {
    const d = deps();
    const result = await interpret('t:goblin c:r', d);
    expect(d.search).toHaveBeenCalledWith('t:goblin c:r');
    expect(d.translate).not.toHaveBeenCalled();
    expect(result.interpretation).toMatchObject({ via: 'syntax', query: 't:goblin c:r' });
    expect(result.trace[1]).toMatchObject({ query: 't:goblin c:r', count: 1 });
  });

  it('does nothing for an empty search', async () => {
    const d = deps();
    expect((await interpret('   ', d)).cards).toEqual([]);
    expect(d.search).not.toHaveBeenCalled();
  });

  it('searches as typed, and says so, when no model is configured', async () => {
    const d = deps({ translate: null });
    const result = await interpret('Lightning Bolt', d);
    expect(d.search).toHaveBeenCalledWith('Lightning Bolt');
    expect(result.interpretation.note).toMatch(/AI search is off/);
  });

  it('does not name-search a whole sentence when the model is down', async () => {
    const d = deps({ translate: vi.fn(async () => { throw new Error('the model returned 503'); }) });
    const result = await interpret('enchantments that work well for fire lord azula', d);
    expect(d.search).not.toHaveBeenCalled();
    expect(result.interpretation.note).toBe('AI search failed (the model returned 503). Try again in a moment, or use Scryfall syntax.');
  });

  it('falls back to a plain search when the model fails', async () => {
    const d = deps({ translate: vi.fn(async () => { throw new Error('the model took too long'); }) });
    const result = await interpret('Lightning Bolt', d);
    expect(d.search).toHaveBeenCalledWith('Lightning Bolt');
    expect(result.interpretation.note).toMatch(/the model took too long/);
  });

  it('lets a Scryfall outage through rather than retrying the model', async () => {
    const d = deps({ search: vi.fn(async () => { throw new ScryfallError('Scryfall returned 503', 503); }) });
    await expect(interpret('dragons', d)).rejects.toThrow('503');
    expect(d.translate).toHaveBeenCalledTimes(1);
  });
});

describe('one card by name', () => {
  // The model names the card; the exact-name syntax is built here, because
  // asked to write it the model wrote `-"Name"` - every card but that one.
  it('builds the exact-name search itself', async () => {
    const d = deps({ translate: vi.fn(async () => plan({ kind: 'card', cardName: 'Lightning Bolt', query: '' })) });
    const result = await interpret('lightnig bolt', d);
    expect(d.search).toHaveBeenCalledWith('!"Lightning Bolt"');
    expect(result.interpretation).toMatchObject({ kind: 'card', query: '!"Lightning Bolt"' });
  });

  it('falls back to the nearest real name when the model misnames the card', async () => {
    const d = deps({
      translate: vi.fn(async () => plan({ kind: 'card', cardName: 'Emrakul the Timeless', query: '' })),
      search: vi.fn(async () => nothing),
      findCardNamed: vi.fn(async (q: string) => (q === 'Emrakul the Timeless' ? card('Emrakul, the Aeons Torn') : null)),
    });
    const result = await interpret('emrakul', d);
    expect(result.cards.map((c) => c.name)).toEqual(['Emrakul, the Aeons Torn']);
    expect(result.interpretation.via).toBe('name');
  });
});

describe('cards for a commander', () => {
  it('looks the commander up and shows the model its real rules text', async () => {
    const translate = vi.fn()
      .mockResolvedValueOnce(plan({ commander: 'azula', query: 't:enchantment' }))
      .mockResolvedValueOnce(plan({ commander: 'azula', query: 't:enchantment (o:copy or o:"whenever you cast")' }));
    const d = deps({ translate, findCommander: vi.fn(async () => azula) });

    const result = await interpret('enchantments that work well for azula', d);

    expect(d.findCommander).toHaveBeenCalledWith('azula');
    expect(translate.mock.calls[1][1].commander).toMatchObject({
      name: 'Fire Lord Azula',
      text: expect.stringContaining('copy that spell'),
    });
    expect(d.search).toHaveBeenCalledWith(
      '(t:enchantment (o:copy or o:"whenever you cast")) id<=ubr f:commander -!"Fire Lord Azula" order:edhrec',
    );
    expect(result.interpretation).toMatchObject({
      query: 't:enchantment (o:copy or o:"whenever you cast")',
      commander: { name: 'Fire Lord Azula', identity: 'UBR', edhrecUrl: 'https://edhrec.com/commanders/fire-lord-azula' },
    });
  });

  it('skips the rules-text pass when the first call used up the time', async () => {
    let clock = 0;
    const translate = vi.fn(async () => { clock += 20_000; return plan({ commander: 'azula', query: 't:instant' }); });
    const d = deps({ translate, findCommander: vi.fn(async () => azula), now: () => clock });
    const result = await interpret('instants for azula', d);
    expect(translate).toHaveBeenCalledTimes(1);
    expect(d.search).toHaveBeenCalledWith('t:instant id<=ubr f:commander -!"Fire Lord Azula" order:edhrec');
    expect(result.trace.some((s) => s.text.includes('too slow'))).toBe(true);
  });

  it('keeps the first answer when the grounded second pass fails', async () => {
    const translate = vi.fn()
      .mockResolvedValueOnce(plan({ commander: 'azula', query: 'otag:draw mv<5' }))
      .mockRejectedValueOnce(new Error('timeout'));
    const d = deps({ translate, findCommander: vi.fn(async () => azula) });
    await interpret('draw under 5 for azula', d);
    expect(d.search).toHaveBeenCalledWith('otag:draw mv<5 id<=ubr f:commander -!"Fire Lord Azula" order:edhrec');
  });

  it('searches without a commander when none can be found', async () => {
    const d = deps({ translate: vi.fn(async () => plan({ commander: 'Nobody Real', query: 't:elf' })) });
    const result = await interpret('elves for nobody real', d);
    expect(d.search).toHaveBeenCalledWith('t:elf order:edhrec');
    expect(result.trace.some((s) => s.text.includes('Could not find a commander'))).toBe(true);
  });

  it('allows "cards for X" with no other condition', async () => {
    const d = deps({
      translate: vi.fn(async () => plan({ commander: 'azula', query: '' })),
      findCommander: vi.fn(async () => azula),
    });
    await interpret('cards for azula', d);
    expect(d.search).toHaveBeenCalledWith('id<=ubr f:commander -!"Fire Lord Azula" order:edhrec');
  });

  it('re-runs an edited query for the same commander without the model', async () => {
    const d = deps({ findCommander: vi.fn(async () => azula) });
    const result = await runQuery('t:instant', 'Fire Lord Azula', d);
    expect(d.translate).not.toHaveBeenCalled();
    expect(d.search).toHaveBeenCalledWith('t:instant id<=ubr f:commander -!"Fire Lord Azula" order:edhrec');
    expect(result.interpretation.commander?.name).toBe('Fire Lord Azula');
  });
});

describe('scoped', () => {
  // Scryfall's own default is alphabetical, which put "Abomination" first
  // in "new red cards from this year".
  it('sorts by popularity unless the query picks an order', () => {
    expect(scoped('t:elf', null)).toBe('t:elf order:edhrec');
    expect(scoped('c:r year>=2026 order:released', null)).toBe('c:r year>=2026 order:released');
  });

  // Scryfall: "Display options may not be specified inside parentheses."
  it('keeps sort options outside the parentheses it adds', () => {
    expect(scoped('(otag:draw or otag:card-advantage) mv<5 order:edhrec', azula))
      .toBe('((otag:draw or otag:card-advantage) mv<5) id<=ubr f:commander -!"Fire Lord Azula" order:edhrec');
    expect(scoped('t:instant or t:sorcery order:usd direction:asc', azula))
      .toBe('(t:instant or t:sorcery) id<=ubr f:commander -!"Fire Lord Azula" order:usd direction:asc');
  });

  it('respects a format or order the query already sets', () => {
    expect(scoped('t:elf f:pauper order:usd', azula)).toBe('t:elf f:pauper id<=ubr -!"Fire Lord Azula" order:usd');
  });

  it('gives a colourless commander a colourless identity', () => {
    expect(scoped('t:artifact', card('Karn', { color_identity: [] }))).toContain('id<=c ');
  });
});

describe('ranking by EDHREC', () => {
  const stats: CommanderStats = new Map([
    ['Thousand-Year Storm', { decks: 900, inclusion: 0.45, synergy: 0.4 }],
    ['Rhystic Study', { decks: 500, inclusion: 0.25, synergy: 0.01 }],
    ['Niche Enchantment', { decks: 700, inclusion: 0.35, synergy: 0.5 }],
  ]);

  it('puts what the commander\'s decks play first, and finds ones past the first page', async () => {
    const search = vi.fn()
      .mockResolvedValueOnce(found('Rhystic Study', 'Some Random Card', 'Thousand-Year Storm'))
      .mockResolvedValueOnce(found('Niche Enchantment'));
    const d = deps({
      translate: vi.fn(async () => plan({ commander: 'azula', query: 't:enchantment' })),
      findCommander: vi.fn(async () => azula),
      commanderStats: vi.fn(async () => stats),
      search,
    });

    const result = await interpret('enchantments for azula', d);

    expect(search.mock.calls[1][0]).toContain('(!"Niche Enchantment")');
    expect(result.cards.map((c) => c.name))
      .toEqual(['Thousand-Year Storm', 'Niche Enchantment', 'Rhystic Study', 'Some Random Card']);
    expect(result.stats?.['thousand-year-storm']?.inclusion).toBe(0.45);
  });

  it('is skipped entirely when EDHREC is switched off', async () => {
    const d = deps({
      translate: vi.fn(async () => plan({ commander: 'azula', query: 't:enchantment' })),
      findCommander: vi.fn(async () => azula),
    });
    const result = await interpret('enchantments for azula', d);
    expect(d.search).toHaveBeenCalledTimes(1);
    expect(result.stats).toBeUndefined();
  });

  it('carries on without EDHREC when it has nothing', async () => {
    const d = deps({
      translate: vi.fn(async () => plan({ commander: 'azula', query: 't:enchantment' })),
      findCommander: vi.fn(async () => azula),
      commanderStats: vi.fn(async () => null),
    });
    const result = await interpret('enchantments for azula', d);
    expect(result.cards).toHaveLength(1);
    expect(result.trace.some((s) => s.text.includes('EDHREC had nothing'))).toBe(true);
  });
});

describe('combos', () => {
  const vivi = card('Vivi Ornitier', { color_identity: ['U', 'R'] });

  it('asks Spellbook for the commander\'s combos in its colours, then fetches the pieces', async () => {
    const d = deps({
      translate: vi.fn(async () => plan({ kind: 'combos', commander: 'vivi', query: '' })),
      findCommander: vi.fn(async () => vivi),
      searchCombos: vi.fn(async () => [
        combo('1', ['Vivi Ornitier', 'Quicksilver Elemental']),
        combo('2', ['Vivi Ornitier', 'Deadeye Navigator']),
      ]),
    });

    const result = await interpret('combo cards for vivi', d);

    expect(d.searchCombos).toHaveBeenCalledWith('card:"Vivi Ornitier" coloridentity<=UR legal:commander');
    expect(d.cardsNamed).toHaveBeenCalledWith(['Vivi Ornitier', 'Quicksilver Elemental', 'Vivi Ornitier', 'Deadeye Navigator']);
    expect(result.combos).toHaveLength(2);
    expect(result.interpretation).toMatchObject({ kind: 'combos', commander: { name: 'Vivi Ornitier' } });
    expect(d.translate).toHaveBeenCalledTimes(1);
  });

  it('finds combos for a named card that is not the commander', async () => {
    const d = deps({
      translate: vi.fn(async () => plan({ kind: 'combos', cardName: 'Doubling Season', query: '' })),
      findCardNamed: vi.fn(async () => card('Doubling Season')),
      searchCombos: vi.fn(async () => [combo('3', ['Doubling Season', 'Ashnod\'s Altar'])]),
    });
    await interpret('what goes infinite with doubling season', d);
    expect(d.searchCombos).toHaveBeenCalledWith('card:"Doubling Season"');
  });

  it('runs a combo search that names no card', async () => {
    const d = deps({
      translate: vi.fn(async () => plan({ kind: 'combos', query: 'coloridentity<=UR result:"infinite mana" cards<=2' })),
      searchCombos: vi.fn(async () => [combo('4', ['A', 'B'])]),
    });
    await interpret('two card infinite mana in izzet', d);
    expect(d.searchCombos).toHaveBeenCalledWith('coloridentity<=UR result:"infinite mana" cards<=2');
  });

  it('drops the model\'s extra terms when Spellbook cannot parse them', async () => {
    const searchCombos = vi.fn()
      .mockRejectedValueOnce(new SpellbookError('Invalid search query', 400))
      .mockResolvedValueOnce([combo('1', ['Vivi Ornitier', 'Quicksilver Elemental'])]);
    const d = deps({
      translate: vi.fn(async () => plan({ kind: 'combos', commander: 'vivi', query: 'bogus::' })),
      findCommander: vi.fn(async () => vivi),
      searchCombos,
    });
    const result = await interpret('weird vivi combos', d);
    expect(searchCombos).toHaveBeenLastCalledWith('card:"Vivi Ornitier" coloridentity<=UR legal:commander');
    expect(result.combos).toHaveLength(1);
  });

  it('says so when Spellbook has none', async () => {
    const d = deps({
      translate: vi.fn(async () => plan({ kind: 'combos', commander: 'vivi', query: '' })),
      findCommander: vi.fn(async () => vivi),
    });
    const result = await interpret('combos for vivi', d);
    expect(result.cards).toEqual([]);
    expect(result.interpretation.note).toBe('Commander Spellbook has no combos for Vivi Ornitier.');
    expect(d.cardsNamed).not.toHaveBeenCalled();
  });
});

describe('retries', () => {
  it('shows the model why a query was rejected and tries again', async () => {
    const translate = vi.fn()
      .mockResolvedValueOnce(plan({ query: 'bogus:thing' }))
      .mockResolvedValueOnce(plan({ query: 't:dragon' }));
    const search = vi.fn()
      .mockRejectedValueOnce(new ScryfallError('Unknown keyword "bogus"', 400))
      .mockResolvedValueOnce(found('Shivan Dragon'));
    const result = await interpret('dragons', deps({ translate, search }));

    expect(translate.mock.calls[1][1].feedback).toContain('Unknown keyword "bogus"');
    expect(result.cards.map((c) => c.name)).toEqual(['Shivan Dragon']);
  });

  // An unknown otag is not an error to Scryfall, just an empty result.
  it('treats no results as worth one more try', async () => {
    const translate = vi.fn()
      .mockResolvedValueOnce(plan({ query: 'otag:made-up' }))
      .mockResolvedValueOnce(plan({ query: 'o:"add {G}"' }));
    const search = vi.fn().mockResolvedValueOnce(nothing).mockResolvedValueOnce(found('Elvish Mystic'));
    const result = await interpret('mana elves', deps({ translate, search }));

    expect(translate.mock.calls[1][1].feedback).toContain('found no cards for otag:made-up');
    expect(result.cards.map((c) => c.name)).toEqual(['Elvish Mystic']);
  });

  // "combo cards for vivi" once came back as `f:commander order:edhrec`:
  // 31,830 cards, led by Sol Ring, presented as an answer.
  it('sends a query that filters nothing back once', async () => {
    const translate = vi.fn()
      .mockResolvedValueOnce(plan({ query: 'f:commander order:edhrec' }))
      .mockResolvedValueOnce(plan({ query: 'otag:ramp f:commander order:edhrec' }));
    const search = vi.fn().mockResolvedValueOnce(found('Sol Ring')).mockResolvedValueOnce(found('Cultivate'));
    const result = await interpret('good ramp', deps({ translate, search }));

    expect(translate.mock.calls[1][1].feedback).toContain('says nothing about what the cards are or do');
    expect(result.cards.map((c) => c.name)).toEqual(['Cultivate']);
  });

  it('accepts the unfiltered query if the model insists', async () => {
    const translate = vi.fn(async () => plan({ query: 'f:commander order:edhrec' }));
    const result = await interpret('most played commander cards', deps({ translate, search: vi.fn(async () => found('Sol Ring')) }));
    expect(translate).toHaveBeenCalledTimes(2);
    expect(result.cards.map((c) => c.name)).toEqual(['Sol Ring']);
  });

  it('stops after two translations and falls back to the nearest card name', async () => {
    const translate = vi.fn(async () => plan({ query: 'otag:nonsense' }));
    const findCardNamed = vi.fn(async () => card('Emrakul, the Aeons Torn'));
    const result = await interpret('emrakul aeon torn', deps({ translate, findCardNamed, search: vi.fn(async () => nothing) }));

    expect(translate).toHaveBeenCalledTimes(2);
    expect(result.interpretation).toMatchObject({ via: 'name', query: '!"Emrakul, the Aeons Torn"' });
  });

  it('keeps the last translation on screen when nothing is found at all', async () => {
    const result = await interpret('purple cards', deps({
      translate: vi.fn(async () => plan({ query: 'c:purple', explanation: 'Purple cards' })),
      search: vi.fn(async () => nothing),
    }));
    expect(result.cards).toEqual([]);
    expect(result.interpretation).toMatchObject({ via: 'ai', query: 'c:purple', explanation: 'Purple cards' });
  });
});
