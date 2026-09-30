import { describe, expect, it, vi } from 'vitest';

import type { ScryfallCard } from '../scryfall';
import { parseAnswer, type Source } from './answer';
import { anchorRules } from './anchors';
import { askRules, type AskDeps } from './ask';
import { keywordRules, parseRules, placeWeight, referencedRules, ruleWithContext, searchRules } from './cr';
import { nameIndex } from './names';

// A slice of the real text: contents, body, glossary, credits.
const CR = `Magic: The Gathering Comprehensive Rules
These rules are effective as of September 25, 2026.
Contents
1. Game Concepts
603. Handling Triggered Abilities

1. Game Concepts

205. Type Line
205.4. Supertypes
205.4d Any permanent with the supertype "legendary" is subject to the state-based action for legendary permanents, also called the "legend rule" (see rule 704.5j).

603. Handling Triggered Abilities
603.2c An ability triggers only once each time its trigger event occurs. However, it can trigger repeatedly if one event contains multiple occurrences.
603.10. Normally, objects that exist immediately after an event are checked to see if the event matched any trigger conditions. However, some triggered abilities are exceptions; the game "looks back in time".
603.10a Some zone-change triggers look back in time. These are leaves-the-battlefield abilities.
Example: Two creatures are on the battlefield along with an artifact that says "Whenever a creature dies, you gain 1 life." A spell destroys all creatures. You gain 2 life.
700.4. The term dies means "is put into a graveyard from the battlefield."
702.116. Myriad
702.116a Myriad is a triggered ability. "Myriad" means "Whenever this creature attacks, for each opponent other than defending player, you may create a token that's a copy of this creature."
702.124. Partner
702.124a Partner abilities are keyword abilities that modify the rules for deck construction.
704.5j If two or more legendary permanents with the same name are controlled by the same player, that player chooses one of them, and the rest are put into their owners' graveyards.
712.21 If a melded permanent leaves the battlefield, one permanent leaves the battlefield.

Glossary

Dies
A creature or planeswalker "dies" if it is put into a graveyard from the battlefield. See rule 700.4.

Legend Rule
A state-based action that causes a player who controls two or more legendary permanents with the same name to put all but one into their owners' graveyards. See rule 704.5j.

Credits

Magic: The Gathering Original Game Design: Richard Garfield
`;

describe('parseRules', () => {
  const index = parseRules(CR);
  it('reads the body, not the contents, with examples kept on their rule', () => {
    expect(index.effective).toBe('September 25, 2026');
    expect(index.rules.get('603')?.text).toBe('Handling Triggered Abilities');
    expect(index.rules.get('603.10a')?.text).toContain('Example: Two creatures');
    expect(index.rules.get('700.4')?.text).toContain('graveyard from the battlefield');
  });
  it('reads the glossary, and what its entries point to', () => {
    expect(index.glossary.get('dies')?.text).toContain('See rule 700.4');
    expect(referencedRules(index.glossary.get('legend rule')!.text)).toEqual(['704.5j']);
  });
  it('gives a subrule its parent for context', () => {
    expect(ruleWithContext(index, '603.10a')).toMatch(/^\(603\.10: Normally/);
  });
  it('finds the rules for creatures dying together, and keeps keyword rules to their keywords', () => {
    const hits = searchRules(index, new Map([['dies', 3], ['trigger', 1], ['destroy all', 1]]), 5).map((h) => h.id);
    expect(hits).toContain('603.10a');
    expect(hits).toContain('g:dies');
    const kw = keywordRules(index);
    expect(kw.get('myriad')).toBe('702.116');
    expect(placeWeight('702.124a', new Set(['702.116']))).toBeLessThan(0.5);
    expect(placeWeight('702.116a', new Set(['702.116']))).toBeGreaterThan(1);
    expect(placeWeight('712.21', new Set())).toBeLessThan(0.5);
  });
});

describe('parseAnswer', () => {
  const sources = [{ id: 'C1', kind: 'rule', label: 'CR 603.10a', text: '' }, { id: 'R1', kind: 'ruling', label: 'Ruling', text: '' }] as Source[];
  it('keeps citations to sources given and drops made-up ones', () => {
    const a = parseAnswer({
      verdict: 'Yes: they all trigger [C1][X9].', explanation: '1. They die together [C1]. 2. Rule 999 says so [C7].',
      confidence: 'certain', citations: [{ id: 'C1', why: 'look back in time' }, { id: 'C7', why: 'made up' }], followUps: ['a', 'b', 'c', 'd'],
    }, sources);
    expect(a.verdict).toBe('Yes: they all trigger [C1].');
    expect(a.explanation).not.toContain('[C7]');
    expect(a.citations).toEqual([{ id: 'C1', role: 'supporting', why: 'look back in time' }]);
    expect(a.followUps).toHaveLength(3);
  });
  it('ranks key sources first, then official word before card text and the wiki', () => {
    const all = [
      { id: 'O1', kind: 'oracle', label: '', text: '' }, { id: 'W1', kind: 'wiki', label: '', text: '' },
      { id: 'C1', kind: 'rule', label: '', text: '' }, { id: 'R1', kind: 'ruling', label: '', text: '' },
    ] as Source[];
    const a = parseAnswer({
      verdict: 'Seven [O1].', explanation: '1. x [W1] [C1] [R1]', confidence: 'certain',
      citations: [{ id: 'O1', role: 'supporting', why: '' }, { id: 'W1', role: 'supporting', why: '' }, { id: 'C1', role: 'key', why: '' }, { id: 'R1', role: 'supporting', why: '' }],
      followUps: [],
    }, all);
    expect(a.citations.map((c) => c.id)).toEqual(['C1', 'R1', 'O1', 'W1']);
    expect(a.confidence).toBe('certain');
  });

  it('is only certain on a key official ruling or rule', () => {
    const all = [{ id: 'O1', kind: 'oracle', label: '', text: '' }, { id: 'C1', kind: 'rule', label: '', text: '' }] as Source[];
    const onCardText = parseAnswer({ verdict: 'Seven [O1].', explanation: '', confidence: 'certain', citations: [{ id: 'O1', role: 'key', why: '' }], followUps: [] }, all);
    expect(onCardText.confidence).toBe('likely');
    const noKey = parseAnswer({ verdict: 'Seven [C1].', explanation: '', confidence: 'certain', citations: [{ id: 'C1', role: 'supporting', why: '' }], followUps: [] }, all);
    expect(noKey.confidence).toBe('likely');
  });

  it('flags a worksheet that let tokens die without checking them, as on Kratos with Blade of Selves', () => {
    const all = [{ id: 'C1', kind: 'rule', label: '', text: '' }] as Source[];
    const kratos = parseAnswer({
      worksheet: [
        { event: 'Kratos is declared as an attacker', checks: [{ object: 'Kratos (original)', ability: 'attack', triggers: true, times: 1, why: '' }] },
        { event: 'The Legend Rule puts two Kratos tokens into the graveyard', checks: [{ object: 'Kratos (surviving)', ability: 'God dies', triggers: true, times: 2, why: '' }] },
      ],
      verdict: 'Three [C1].', explanation: '', confidence: 'likely', citations: [{ id: 'C1', role: 'key', why: '' }], followUps: [],
    }, all);
    expect(kratos.confidence).toBe('unsure');
    expect(kratos.looseEnds?.[0]).toMatch(/603\.10a/);
    const checked = parseAnswer({
      worksheet: [{ event: 'The Legend Rule puts two Kratos tokens into the graveyard', checks: [{ object: 'Kratos token 1', ability: 'God dies', triggers: true, times: 2, why: '' }] }],
      verdict: 'Seven [C1].', explanation: '', confidence: 'likely', citations: [{ id: 'C1', role: 'key', why: '' }], followUps: [],
    }, all);
    expect(checked.looseEnds).toBeUndefined();
    expect(checked.confidence).toBe('likely');
  });

  it('is not certain of anything it cannot cite', () => {
    expect(parseAnswer({ verdict: 'Probably.', explanation: '', confidence: 'certain', citations: [], followUps: [] }, sources).confidence).toBe('unsure');
  });
});

describe('anchorRules', () => {
  const card = (name: string, type: string, text: string) => ({ id: name, name, type_line: type, oracle_text: text }) as ScryfallCard;
  it('brings the look-back-in-time rules for a dies trigger, and the legend rule for legendary copies', () => {
    const rules = anchorRules('how does blade of selves interact with kratos', [
      card('Blade of Selves', 'Artifact — Equipment', 'Equipped creature has myriad.'),
      card('Kratos, Stoic Father', 'Legendary Creature — God Warrior', 'Whenever you attack with one or more Gods and whenever a God dies, you get an experience counter.'),
    ]).map((a) => a.rule);
    expect(rules).toEqual(expect.arrayContaining(['603.10a', '603.2c', '700.4', '707.2', '704.5j', '508.4', '122.1']));
  });
  it('brings nothing it has no call for, and does not take "counter target spell" for counters', () => {
    expect(anchorRules('can this be countered?', [card('Counterspell', 'Instant', 'Counter target spell.')])).toEqual([]);
  });
});

describe('askRules', () => {
  const card = (name: string, extra: Partial<ScryfallCard> = {}) => ({ id: name, oracle_id: name, name, scryfall_uri: `https://scryfall.com/${name}`, ...extra }) as ScryfallCard;
  const cards: Record<string, ScryfallCard> = {
    'Blade of Selves': card('Blade of Selves', { type_line: 'Artifact — Equipment', oracle_text: 'Equipped creature has myriad.', keywords: ['Equip'] }),
    'Kratos, Stoic Father': card('Kratos, Stoic Father', { type_line: 'Legendary Creature — God Warrior', oracle_text: 'Whenever a God dies, you get an experience counter.', keywords: ['Partner'] }),
    'Kratos, God of War': card('Kratos, God of War', { type_line: 'Legendary Creature — God' }),
  };
  const deps = (model = vi.fn()): AskDeps => ({
    rules: async () => { const index = parseRules(CR); return { index, vocab: new Set(['dies', 'creature']) }; },
    names: async () => nameIndex(Object.keys(cards)),
    cards: async (names) => names.map((n) => cards[n]).filter(Boolean),
    rulings: async (c) => (c.name === 'Blade of Selves' ? [{ source: 'wotc', published_at: '2015-11-04', comment: 'If the equipped creature is legendary, you choose one to remain.' }] : []),
    wiki: async (t) => ({ title: t, url: `https://mtg.wiki/page/${t}`, text: `${t} explained.` }),
    model,
    now: () => new Date('2026-09-30T12:00:00Z'),
  });
  const answer = { verdict: 'The copies meet the legend rule [R1].', explanation: '1. Myriad makes copies [C1].', confidence: 'certain', citations: [{ id: 'R1', why: '' }], followUps: [] };

  it('asks which card a word means before spending a model request', async () => {
    const model = vi.fn();
    const r = await askRules({ question: 'how does blade of selves interact with kratos' }, deps(model));
    expect(r).toEqual({ choice: [{ mention: 'kratos', options: ['Kratos, God of War', 'Kratos, Stoic Father'] }] });
    expect(model).not.toHaveBeenCalled();
  });

  it('answers with the pick, from the cards, their rulings, the rules and the wiki', async () => {
    const model = vi.fn().mockResolvedValue({ data: answer, model: 'test' });
    const r = await askRules({ question: 'how does blade of selves interact with kratos', picks: { kratos: 'Kratos, Stoic Father' } }, deps(model));
    if (!('turn' in r)) throw new Error('expected an answer');
    expect(r.turn.cards).toEqual(['Blade of Selves', 'Kratos, Stoic Father']);
    const labels = r.turn.sources.map((s) => s.label);
    expect(labels).toEqual(expect.arrayContaining(['Blade of Selves', 'Ruling: Blade of Selves', 'CR 702.116a', 'CR 704.5j', 'MTG Wiki: Myriad']));
    // Partner is about deckbuilding, not how cards play together.
    expect(labels).not.toContain('CR 702.124a');
    expect(model.mock.calls[0][0].user).toContain('QUESTION: how does blade of selves interact with kratos');
    // Cited in the list, and inline in the explanation.
    expect(r.turn.answer.citations.map((c) => c.id)).toEqual(['R1', 'C1']);
  });

  it('takes a follow-up\'s "kratos" as the Kratos already in the conversation, without asking', async () => {
    const model = vi.fn().mockResolvedValue({ data: answer, model: 'test' });
    const first = await askRules({ question: 'blade of selves on kratos', picks: { kratos: 'Kratos, Stoic Father' } }, deps(model));
    if (!('turn' in first)) throw new Error('expected an answer');
    const next = await askRules({ question: 'Can I choose which Kratos token stays?', earlier: [first.turn] }, deps(model));
    expect('turn' in next).toBe(true);
    if ('turn' in next) expect(next.turn.cards).toContain('Kratos, Stoic Father');
  });

  it('keeps the conversation\'s cards for a follow-up that does not name them', async () => {
    const model = vi.fn().mockResolvedValue({ data: answer, model: 'test' });
    const first = await askRules({ question: 'blade of selves on kratos, stoic father' }, deps(model));
    if (!('turn' in first)) throw new Error('expected an answer');
    const next = await askRules({ question: 'and if an opponent kills one of the tokens?', earlier: [first.turn] }, deps(model));
    if (!('turn' in next)) throw new Error('expected an answer');
    expect(next.turn.cards).toEqual(['Blade of Selves', 'Kratos, Stoic Father']);
    expect(model.mock.calls[1][0].user).toMatch(/CONVERSATION SO FAR:\nQ1: blade of selves on kratos/);
  });
});
