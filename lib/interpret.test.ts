/**
 * Routing a search.
 *
 * Scryfall, Commander Spellbook, EDHREC and the model are all stand-ins
 * here: each test says what they would answer, and checks which of them got
 * asked what. Nothing leaves the machine and nothing costs model usage.
 */

import { describe, expect, it, vi } from 'vitest';

import type { CommanderPage } from './edhrec';
import type { Translation, Translator } from './gemini';
import { interpret, pickCommander, runCombos, runQuery, scoped, type Deps } from './interpret';
import { ScryfallError, type ScryfallCard, type SearchResult } from './scryfall';
import { DEFAULT_SORT } from './sort';
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
    findCommanders: vi.fn(async () => []),
    cardsNamed: vi.fn(async (names: string[]) => names.map((n) => card(n))),
    searchCombos: vi.fn(async () => []),
    edhrec: null,
    translate: vi.fn(async () => plan()),
    ...over,
  };
}

describe('syntax and fallbacks', () => {
  it('sends syntax straight to Scryfall without asking the model', async () => {
    const d = deps();
    const result = await interpret('t:goblin c:r', d);
    expect(d.search).toHaveBeenCalledWith('t:goblin c:r', DEFAULT_SORT);
    expect(d.translate).not.toHaveBeenCalled();
    expect(result.interpretation).toMatchObject({ via: 'syntax', query: 't:goblin c:r', sort: DEFAULT_SORT });
    expect(result.trace[1]).toMatchObject({ query: 't:goblin c:r order:edhrec', count: 1 });
  });

  it('does nothing for an empty search', async () => {
    const d = deps();
    expect((await interpret('   ', d)).cards).toEqual([]);
    expect(d.search).not.toHaveBeenCalled();
  });

  it('searches as typed, and says so, when no model is configured', async () => {
    const d = deps({ translate: null });
    const result = await interpret('Lightning Bolt', d);
    expect(d.search).toHaveBeenCalledWith('Lightning Bolt', DEFAULT_SORT);
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
    expect(d.search).toHaveBeenCalledWith('Lightning Bolt', DEFAULT_SORT);
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
    expect(d.search).toHaveBeenCalledWith('!"Lightning Bolt"', DEFAULT_SORT);
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
    const d = deps({ translate, findCommanders: vi.fn(async () => [azula]) });

    const result = await interpret('enchantments that work well for azula', d);

    expect(d.findCommanders).toHaveBeenCalledWith('azula');
    expect(translate.mock.calls[1][1].commander).toMatchObject({
      name: 'Fire Lord Azula',
      text: expect.stringContaining('copy that spell'),
    });
    expect(d.search).toHaveBeenCalledWith(
      '(t:enchantment (o:copy or o:"whenever you cast")) id<=ubr f:commander -!"Fire Lord Azula"', DEFAULT_SORT);
    expect(result.interpretation).toMatchObject({
      query: 't:enchantment (o:copy or o:"whenever you cast")',
      commander: { name: 'Fire Lord Azula', identity: 'UBR', edhrecUrl: 'https://edhrec.com/commanders/fire-lord-azula' },
    });
  });

  it('skips the rules-text pass when the first call used up the time', async () => {
    let clock = 0;
    const translate = vi.fn(async () => { clock += 20_000; return plan({ commander: 'azula', query: 't:instant' }); });
    const d = deps({ translate, findCommanders: vi.fn(async () => [azula]), now: () => clock });
    const result = await interpret('instants for azula', d);
    expect(translate).toHaveBeenCalledTimes(1);
    expect(d.search).toHaveBeenCalledWith('t:instant id<=ubr f:commander -!"Fire Lord Azula"', DEFAULT_SORT);
    expect(result.trace.some((s) => s.text.includes('too slow'))).toBe(true);
  });

  it('keeps the first answer when the grounded second pass fails', async () => {
    const translate = vi.fn()
      .mockResolvedValueOnce(plan({ commander: 'azula', query: 'otag:draw mv<5' }))
      .mockRejectedValueOnce(new Error('timeout'));
    const d = deps({ translate, findCommanders: vi.fn(async () => [azula]) });
    await interpret('draw under 5 for azula', d);
    expect(d.search).toHaveBeenCalledWith('otag:draw mv<5 id<=ubr f:commander -!"Fire Lord Azula"', DEFAULT_SORT);
  });

  it('searches without a commander when none can be found', async () => {
    const d = deps({ translate: vi.fn(async () => plan({ commander: 'Nobody Real', query: 't:elf' })) });
    const result = await interpret('elves for nobody real', d);
    expect(d.search).toHaveBeenCalledWith('t:elf', DEFAULT_SORT);
    expect(result.trace.some((s) => s.text.includes('Could not find a commander'))).toBe(true);
  });

  it('allows "cards for X" with no other condition', async () => {
    const d = deps({
      translate: vi.fn(async () => plan({ commander: 'azula', query: '' })),
      findCommanders: vi.fn(async () => [azula]),
    });
    await interpret('cards for azula', d);
    expect(d.search).toHaveBeenCalledWith('id<=ubr f:commander -!"Fire Lord Azula"', DEFAULT_SORT);
  });

  it('re-runs an edited query for the same commander without the model', async () => {
    const d = deps({ findCommanders: vi.fn(async () => [azula]) });
    const result = await runQuery('t:instant', 'Fire Lord Azula', d);
    expect(d.translate).not.toHaveBeenCalled();
    expect(d.search).toHaveBeenCalledWith('t:instant id<=ubr f:commander -!"Fire Lord Azula"', DEFAULT_SORT);
    expect(result.interpretation.commander?.name).toBe('Fire Lord Azula');
  });
});

describe('scoped', () => {
  it('leaves a query alone without a commander', () => {
    expect(scoped('t:elf', null)).toBe('t:elf');
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

describe('the EDHREC view', () => {
  const page: CommanderPage = {
    decks: 37882,
    stats: new Map([
      ['Leyline of Anticipation', { decks: 18565, inclusion: 0.49, synergy: 0.4 }],
      ['Rhystic Study', { decks: 7831, inclusion: 0.21, synergy: 0.01 }],
      ['Sol Ring', { decks: 37000, inclusion: 0.98, synergy: 0 }],
    ]),
    sections: [
      { header: 'High Synergy Cards', names: ['Leyline of Anticipation'] },
      { header: 'Top Cards', names: ['Sol Ring', 'Rhystic Study'] },
    ],
  };
  const withEdhrec = (over: Partial<Deps> = {}) => deps({
    translate: vi.fn(async () => plan({ commander: 'azula', query: 't:enchantment' })),
    findCommanders: vi.fn(async () => [azula]),
    edhrec: vi.fn(async () => page),
    ...over,
  });

  it('keeps only what the commander\'s decks play that fits the search, most played first', async () => {
    const search = vi.fn()
      .mockResolvedValueOnce(found('Rhystic Study', 'Some Random Card'))                  // All matching cards
      .mockResolvedValueOnce(found('Rhystic Study', 'Leyline of Anticipation'));          // EDHREC names, checked
    const result = await interpret('enchantments for azula', withEdhrec({ search }));

    expect(search.mock.calls[1][0]).toContain('t:enchantment id<=ubr f:commander -!"Fire Lord Azula" (!"Leyline of Anticipation" or');
    expect(result.edhrec).toMatchObject({ commander: 'Fire Lord Azula', decks: 37882, filtered: true });
    expect(result.edhrec!.cards.map((c) => c.name)).toEqual(['Leyline of Anticipation', 'Rhystic Study']);
  });

  it('shows EDHREC\'s own lists when nothing narrows them', async () => {
    const d = withEdhrec({ translate: vi.fn(async () => plan({ commander: 'azula', query: '' })) });
    const result = await interpret('cards for azula', d);

    expect(d.cardsNamed).toHaveBeenCalledWith(['Leyline of Anticipation', 'Rhystic Study', 'Sol Ring']);
    expect(result.edhrec!.sections.map((s) => s.header)).toEqual(['High Synergy Cards', 'Top Cards']);
    expect(result.edhrec!.sections[1].ids).toEqual(['sol-ring', 'rhystic-study']);
    expect(result.edhrec!.filtered).toBe(false);
  });

  it('puts the commander\'s figures on the Scryfall results too, without reordering them', async () => {
    const result = await interpret('enchantments for azula', withEdhrec({
      search: vi.fn(async () => found('Some Random Card', 'Rhystic Study')),
    }));
    expect(result.cards.map((c) => c.name)).toEqual(['Some Random Card', 'Rhystic Study']);
    expect(result.stats).toEqual({ 'rhystic-study': page.stats.get('Rhystic Study') });
  });

  it('is left out when EDHREC is switched off', async () => {
    const result = await interpret('enchantments for azula', withEdhrec({ edhrec: null }));
    expect(result.edhrec).toBeUndefined();
    expect(result.stats).toBeUndefined();
  });

  it('says so when EDHREC does not know the commander', async () => {
    const result = await interpret('enchantments for azula', withEdhrec({ edhrec: vi.fn(async () => null) }));
    expect(result.edhrec).toBeUndefined();
    expect(result.trace.some((s) => s.text === 'EDHREC has no data for Fire Lord Azula yet')).toBe(true);
  });

  it('is not rebuilt when only the sort changes', async () => {
    const d = withEdhrec();
    const result = await runQuery('t:enchantment', 'Fire Lord Azula', d, { order: 'usd', dir: 'asc' }, { withEdhrec: false });
    expect(d.search).toHaveBeenCalledTimes(1);
    expect(d.search).toHaveBeenCalledWith('t:enchantment id<=ubr f:commander -!"Fire Lord Azula"', { order: 'usd', dir: 'asc' });
    expect(result.edhrec).toBeUndefined();
    expect(result.interpretation.sort).toEqual({ order: 'usd', dir: 'asc' });
  });
});

describe('sorting', () => {
  it('lifts an order out of the model\'s query and sends it as the sort', async () => {
    const d = deps({ translate: vi.fn(async () => plan({ query: 'c:r year>=2026 order:released direction:desc' })) });
    const result = await interpret('newest red cards', d);
    expect(d.search).toHaveBeenCalledWith('c:r year>=2026', { order: 'released', dir: 'desc' });
    expect(result.interpretation).toMatchObject({ query: 'c:r year>=2026', sort: { order: 'released', dir: 'desc' } });
  });

  it('lets an order typed into an edited query win over the menu', async () => {
    const d = deps();
    await runQuery('t:elf order:usd', null, d, { order: 'name', dir: 'auto' });
    expect(d.search).toHaveBeenCalledWith('t:elf', { order: 'usd', dir: 'auto' });
  });
});

describe('follow-ups', () => {
  const previous = { request: 'green ramp for omnath', kind: 'cards' as const, commander: 'Omnath, Locus of Creation', query: 'otag:ramp c:g' };
  const omnath = card('Omnath, Locus of Creation', { color_identity: ['W', 'U', 'R', 'G'], oracle_text: 'Landfall' });

  it('gives the model the search that ran, and the commander\'s text up front', async () => {
    const translate = vi.fn<Translator>(async () => plan({ commander: 'Omnath', query: 'otag:ramp c:g t:instant' }));
    const d = deps({ translate, findCommanders: vi.fn(async () => [omnath]) });

    await interpret('only instants', d, previous);

    expect(translate).toHaveBeenCalledTimes(1);
    expect(translate.mock.calls[0][1]).toMatchObject({ previous, commander: { name: 'Omnath, Locus of Creation', text: 'Landfall' } });
    expect(d.search).toHaveBeenCalledWith('otag:ramp c:g t:instant id<=wurg f:commander -!"Omnath, Locus of Creation"', DEFAULT_SORT);
  });

  it('looks up a different commander when the follow-up switches', async () => {
    const translate = vi.fn(async () => plan({ commander: 'Atraxa', query: 'otag:ramp' }));
    const atraxa = card('Atraxa, Praetors\' Voice', { color_identity: ['W', 'U', 'B', 'G'] });
    const findCommanders = vi.fn(async (m: string) => (m === 'Atraxa' ? [atraxa] : [omnath]));
    await interpret('for atraxa instead', deps({ translate, findCommanders }), previous);
    expect(findCommanders).toHaveBeenCalledWith('Atraxa');
    expect(translate).toHaveBeenCalledTimes(2);
  });

  it('treats syntax typed as a follow-up as a follow-up, not a new search', async () => {
    const d = deps();
    await interpret('t:instant', d, previous);
    expect(d.translate).toHaveBeenCalled();
  });

  it('says follow-ups need the model when there is none', async () => {
    const result = await interpret('only instants', deps({ translate: null }), previous);
    expect(result.interpretation.note).toMatch(/Follow-ups need the AI/);
  });
});

describe('combos', () => {
  const vivi = card('Vivi Ornitier', { color_identity: ['U', 'R'] });

  it('asks Spellbook for the commander\'s combos in its colours, then fetches the pieces', async () => {
    const d = deps({
      translate: vi.fn(async () => plan({ kind: 'combos', commander: 'vivi', query: '' })),
      findCommanders: vi.fn(async () => [vivi]),
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
      findCommanders: vi.fn(async () => [vivi]),
      searchCombos,
    });
    const result = await interpret('weird vivi combos', d);
    expect(searchCombos).toHaveBeenLastCalledWith('card:"Vivi Ornitier" coloridentity<=UR legal:commander');
    expect(result.combos).toHaveLength(1);
  });

  it('loads a commander\'s combos on their own, for the Combos tab', async () => {
    const d = deps({ findCommanders: vi.fn(async () => [vivi]), searchCombos: vi.fn(async () => [combo('1', ['Vivi Ornitier', 'X'])]) });
    const result = await runCombos('Vivi Ornitier', d);
    expect(d.translate).not.toHaveBeenCalled();
    expect(d.searchCombos).toHaveBeenCalledWith('card:"Vivi Ornitier" coloridentity<=UR legal:commander');
    expect(result.combos).toHaveLength(1);
  });

  it('says so when Spellbook has none', async () => {
    const d = deps({
      translate: vi.fn(async () => plan({ kind: 'combos', commander: 'vivi', query: '' })),
      findCommanders: vi.fn(async () => [vivi]),
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

describe('which commander', () => {
  const omnaths = [
    card('Omnath, Locus of Rage', { color_identity: ['R', 'G'] }),
    card('Omnath, Locus of the Roil', { color_identity: ['U', 'R', 'G'] }),
    card('Omnath, Locus of Creation', { color_identity: ['W', 'U', 'R', 'G'] }),
    card('Henrika Domnathi // Henrika, Infernal Seer', { color_identity: ['B'] }),
  ];

  describe('pickCommander', () => {
    it('asks when a name fits several, matching whole words only', () => {
      const picked = pickCommander('omnath', omnaths);
      expect(picked && 'choices' in picked && picked.choices.map((c) => c.name)).toEqual([
        'Omnath, Locus of Rage', 'Omnath, Locus of the Roil', 'Omnath, Locus of Creation',
      ]);
    });

    it('answers when the words narrow it to one', () => {
      expect(pickCommander('omnath creation', omnaths)).toEqual({ card: omnaths[2] });
    });

    it('answers when a name is written in full, even if others contain it', () => {
      const vivis = [card('Vivi Ornitier'), card('Vivi, Black Mage')];
      expect(pickCommander('Vivi Ornitier', vivis)).toEqual({ card: vivis[0] });
    });

    it('takes a lone fuzzy match for a typo', () => {
      expect(pickCommander('omnth crreation', [omnaths[2]])).toEqual({ card: omnaths[2] });
    });

    it('is null when nothing was found', () => {
      expect(pickCommander('nobody', [])).toBeNull();
    });
  });

  it('stops to ask, and hands back the plan so the search can carry on', async () => {
    const translate = vi.fn(async () => plan({ commander: 'Omnath', query: 'otag:ramp c:g' }));
    const d = deps({ translate, findCommanders: vi.fn(async () => omnaths) });

    const result = await interpret('green ramp for omnath', d);

    expect(d.search).not.toHaveBeenCalled();
    expect(result.choice?.mention).toBe('Omnath');
    expect(result.choice?.options.map((o) => o.name)).toHaveLength(3);
    expect(result.plan).toMatchObject({ commander: 'Omnath', query: 'otag:ramp c:g' });
  });

  it('carries on with the pick without re-planning, then reads the commander\'s text', async () => {
    const translate = vi.fn<Translator>(async () => plan({ commander: 'Omnath', query: 'otag:ramp c:g t:land' }));
    const d = deps({ translate, findCommanders: vi.fn(async (m: string) => omnaths.filter((c) => c.name === m)) });

    const result = await interpret('green ramp for omnath', d, undefined, {
      plan: plan({ commander: 'Omnath', query: 'otag:ramp c:g' }),
      commander: 'Omnath, Locus of Creation',
    });

    // One call: the rules-text pass. The original plan was not asked for again.
    expect(translate).toHaveBeenCalledTimes(1);
    expect(translate.mock.calls[0][1]?.commander?.name).toBe('Omnath, Locus of Creation');
    expect(result.interpretation.commander?.name).toBe('Omnath, Locus of Creation');
    expect(result.trace[0].text).toBe('You picked Omnath, Locus of Creation');
  });
});
