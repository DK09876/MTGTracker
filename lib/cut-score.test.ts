/**
 * Cut candidates and their reasons, from a made-up deck.
 */

import { describe, expect, it } from 'vitest';

import { cutCandidates } from './cut-score';
import { fitProfile } from './fit';
import type { RoleCount } from './roles';
import type { ScryfallCard } from './scryfall';

const card = (name: string, type_line: string, oracle_text = '', extra: Record<string, unknown> = {}) =>
  ({ card: { id: `id-${name}`, oracle_id: `o-${name}`, name, type_line, oracle_text, cmc: 2, edhrec_rank: 100, ...extra } as ScryfallCard, quantity: 1 });
const role = (id: string, cards: string[], target: [number, number] | null = null): RoleCount =>
  ({ id, label: id, group: 'mana', target, count: cards.length, cards });

const commander = { name: 'Spell Boss', type_line: 'Legendary Creature', oracle_text: 'Magecraft — Whenever you cast or copy an instant or sorcery spell, draw a card.' } as ScryfallCard;

describe('cutCandidates', () => {
  const cards = [
    card('Rock A', 'Artifact', '{T}: Add {C}.'), card('Rock B', 'Artifact', '{T}: Add {C}.'), card('Rock C', 'Artifact', '{T}: Add {C}.'),
    card('Bolt', 'Instant', 'Deal 3 damage.'),
    card('Big Dumb Beast', 'Creature — Beast', 'Trample', { cmc: 8, edhrec_rank: 30_000 }),
    card('Engine', 'Creature — Wizard', 'Whenever you cast an instant or sorcery spell, draw a card.'),
    card('Island', 'Basic Land — Island'),
  ];
  const roles = [role('ramp', ['Rock A', 'Rock B', 'Rock C'], [1, 2]), role('removal', ['Bolt'], [2, 4])];

  it('puts cards in roles the deck is over on, and cards that fit nothing, first - and spares what is short', () => {
    const { candidates, type } = cutCandidates({ cards, roles, fit: fitProfile(commander), commander, commanderRoles: [], tags: null, keep: new Set(), stats: null, lands: { have: 36, want: 37 } });
    expect(type.type).toBe('A');
    const names = candidates.map((c) => c.name);
    expect(names[0]).toBe('Big Dumb Beast');
    expect(candidates[0].reasons.join(' ')).toMatch(/Nothing Spell Boss cares about.*Low floor: a body with little else.*Costs 8.*Rarely played/);
    expect(names).toContain('Rock A');
    expect(candidates.find((c) => c.name === 'Rock A')!.reasons[0]).toMatch(/ramp: 3, more than 1–2/);
    // Removal is short: Bolt is not offered.
    expect(names).not.toContain('Bolt');
    expect(names).not.toContain('Island');
  });

  it('never offers what the owner tagged as an engine, and offers a basic when over on lands', () => {
    const tags = {
      brief: '', overview: '',
      tags: [{ id: 't1', name: 'Engines', kind: 'engine', status: 'accepted' }] as never,
      cardTags: [{ key: 'o-Engine', tagId: 't1', source: 'manual', on: true, reason: '' }] as never,
    };
    const { candidates, protectedCards } = cutCandidates({ cards, roles, fit: null, commander: null, commanderRoles: [], tags, keep: new Set(['o-Bolt']), stats: null, lands: { have: 40, want: 37 } });
    // Tagged as an engine, or starred to keep: never offered.
    expect(protectedCards).toEqual(['Bolt', 'Engine']);
    expect(candidates.map((c) => c.name)).toContain('Island');
  });

  it('reads a deck packed with one narrow theme as Type B, and keeps its theme cards', () => {
    const slivers = { name: 'Sliver Queen', type_line: 'Legendary Creature — Sliver', oracle_text: 'Sliver creatures you control get +1/+1.' } as ScryfallCard;
    const deck = [
      ...Array.from({ length: 22 }, (_, i) => card(`Sliver ${i}`, 'Creature — Sliver', 'Sliver creatures you control have haste.', { edhrec_rank: 20_000 })),
      card('Random Beast', 'Creature — Beast', 'Trample'),
    ];
    const { type, candidates } = cutCandidates({ cards: deck, roles: [], fit: fitProfile(slivers), commander: slivers, commanderRoles: [], tags: null, keep: new Set(), stats: null, lands: { have: 37, want: 37 } });
    expect(type.type).toBe('B');
    // Weak but on theme: kept; off theme: first to go.
    expect(candidates[0].name).toBe('Random Beast');
    expect(candidates.some((c) => c.name.startsWith('Sliver'))).toBe(false);
  });

  it('trims interaction first, then ramp when the commander is cheap', () => {
    const cheap = { name: 'Cheap Boss', type_line: 'Legendary Creature', oracle_text: '', cmc: 2 } as ScryfallCard;
    const removal = Array.from({ length: 10 }, (_, i) => card(`Snipe ${i}`, 'Instant', 'Destroy target creature with power 2 or less.'));
    const flex = card('Beast Within', 'Instant', 'Destroy target permanent.');
    const ramp = Array.from({ length: 12 }, (_, i) => card(`Rock ${i}`, 'Artifact', '{T}: Add {C}.'));
    const r = [role('removal', [...removal.map((c) => c.card.name), 'Beast Within'], [8, 12]), role('ramp', ramp.map((c) => c.card.name), [10, 12])];
    const { candidates } = cutCandidates({ cards: [...removal, flex, ...ramp], roles: r, fit: null, commander: cheap, commanderRoles: [], tags: null, keep: new Set(), stats: null, lands: { have: 37, want: 37 } });
    const snipe = candidates.find((c) => c.name === 'Snipe 0')!;
    expect(snipe.reasons).toContain('Narrow removal: interaction is the first utility to trim');
    expect(candidates.find((c) => c.name === 'Rock 0')!.reasons.join(' ')).toMatch(/Cheap Boss is cheap: ramp is the next to trim/);
    // Flexible removal ranks below narrow removal.
    const flexScore = candidates.find((c) => c.name === 'Beast Within')?.score ?? 0;
    expect(flexScore).toBeLessThan(snipe.score);
  });

  describe('rules and the plan (Kevin\'s Jiang Yanggu deck)', () => {
    const jiang = { name: 'Jiang Yanggu, Alone', type_line: 'Legendary Creature', cmc: 5, oracle_text: 'Whenever a creature you control attacks a player alone, discard a card, then draw a card.' } as ScryfallCard;
    const deck = [
      card('Wheel of Misfortune', 'Sorcery', 'Each player secretly chooses a number. Each player discards their hand, then draws seven cards.', { cmc: 3 }),
      card('Impulse', 'Instant', 'Exile the top two cards of your library. Until the end of your next turn, you may play those cards.', { cmc: 3 }),
      card('Real Draw', 'Sorcery', 'Draw three cards.', { cmc: 3 }),
      card('Draw Two', 'Sorcery', 'Draw two cards.', { cmc: 3 }),
      card('Pet Dragon', 'Creature — Dragon', 'Flying', { cmc: 6, edhrec_rank: 30_000 }),
      card('Fatty', 'Creature — Beast', 'Trample', { cmc: 6, edhrec_rank: 30_000 }),
    ];
    // Four draw cards by Scryfall's count, against a range of 1-2.
    const draw = role('draw', ['Wheel of Misfortune', 'Impulse', 'Real Draw', 'Draw Two'], [1, 2]);
    const base = { cards: deck, roles: [draw], fit: fitProfile(jiang), commander: jiang, commanderRoles: ['draw'], keep: new Set<string>(), stats: null, lands: { have: 37, want: 37 } };
    const discard = { label: 'Discard', test: /\bdiscards? (a|their|your) (card|hand)|each player discards/i };

    it('keeps cards that fit the plan\'s style, like wheels in a discard deck', () => {
      const without = cutCandidates({ ...base, tags: null });
      const withPlan = cutCandidates({ ...base, tags: null, styles: [discard] });
      const score = (r: typeof without, n: string) => r.candidates.find((c) => c.name === n)?.score ?? 0;
      expect(score(withPlan, 'Wheel of Misfortune')).toBeLessThan(score(without, 'Wheel of Misfortune'));
      expect(withPlan.candidates.find((c) => c.name === 'Wheel of Misfortune')?.why.map((w) => w.rule) ?? ['kept']).not.toContain('norole');
    });

    it('counts impulse draw as card draw, unless the owner turns that off', () => {
      const plain = cutCandidates({ ...base, tags: null });
      expect(plain.candidates.find((c) => c.name === 'Real Draw')!.reasons.join(' ')).toMatch(/draw: 4, more than 1–2/);
      const { candidates } = cutCandidates({ ...base, tags: null, settings: { rules: { impulse: { on: true } }, custom: [] } });
      const impulse = candidates.find((c) => c.name === 'Impulse');
      expect(impulse?.why.some((w) => w.rule === 'over') ?? false).toBe(false);
      // Three real draw cards against 1-2, not four.
      expect(candidates.find((c) => c.name === 'Real Draw')!.reasons.join(' ')).toMatch(/draw: 3 \(not counting impulse draw\), more than 1–2/);
    });

    it('names each reason\'s rule, and follows the owner\'s switches, weights and rules', () => {
      const plain = cutCandidates({ ...base, tags: null });
      const fatty = plain.candidates.find((c) => c.name === 'Fatty')!;
      expect(fatty.why.map((w) => w.rule)).toEqual(expect.arrayContaining(['costly', 'rare']));
      const off = cutCandidates({ ...base, tags: null, settings: { rules: { costly: { on: false }, rare: { weight: 2 } }, custom: [] } });
      const fatty2 = off.candidates.find((c) => c.name === 'Fatty')!;
      expect(fatty2.why.some((w) => w.rule === 'costly')).toBe(false);
      expect(fatty2.why.find((w) => w.rule === 'rare')!.delta).toBeCloseTo(2 * 0.67, 1);
      const mine = cutCandidates({ ...base, tags: null, settings: { rules: {}, custom: [{ when: 'card', value: 'Fatty', then: 'protect' }, { when: 'mv-at-least', value: '3', then: 1 }] } });
      expect(mine.protectedCards).toContain('Fatty');
      expect(mine.candidates.find((c) => c.name === 'Real Draw')!.why.some((w) => w.rule === 'custom' && w.delta === 1)).toBe(true);
    });

    it('never offers cards tagged Pet', () => {
      const tags = { brief: '', overview: '', tags: [{ id: 't1', name: 'Pet', description: '', color: '#fff', kind: null, status: 'accepted', origin: 'manual', position: 0, examples: [] }], cardTags: [{ key: 'o-Pet Dragon', tagId: 't1', source: 'manual', on: true, reason: '' }] };
      const { protectedCards, candidates } = cutCandidates({ ...base, tags: tags as never });
      expect(protectedCards).toContain('Pet Dragon');
      expect(candidates.some((c) => c.name === 'Pet Dragon')).toBe(false);
    });
  });
});

describe('packages, engines and the mana rules', () => {
  const tag = (id: string, name: string, kind: string | null = null) => ({ id, name, description: '', color: '#fff', kind, status: 'accepted', origin: 'manual', position: 0, examples: [] });
  const on = (key: string, tagId: string) => ({ key: `o-${key}`, tagId, source: 'manual', on: true, reason: '' });
  const base = { roles: [], fit: null, commander: null, commanderRoles: [], keep: new Set<string>(), stats: null, lands: { have: 37, want: 37 } };

  it('trims a theme package over its size and keeps one at its size', () => {
    const tokens = Array.from({ length: 10 }, (_, i) => card(`Token ${i}`, 'Creature', 'Create a token.', { cmc: 3, edhrec_rank: 30_000 }));
    const wheels = Array.from({ length: 3 }, (_, i) => card(`Wheel ${i}`, 'Sorcery', 'Each player discards their hand.', { cmc: 3, edhrec_rank: 30_000 }));
    const tags = { brief: '', overview: '', tags: [tag('t', 'Tokens'), tag('w', 'Wheels')], cardTags: [...tokens.map((c) => on(c.card.name, 't')), ...wheels.map((c) => on(c.card.name, 'w'))] };
    const { candidates } = cutCandidates({ ...base, cards: [...tokens, ...wheels], tags: tags as never });
    const token = candidates.find((c) => c.name === 'Token 0')!;
    expect(token.why.find((w) => w.rule === 'package-over')?.text).toBe('Tokens: 10, more than its 8');
    expect(candidates.some((c) => c.name.startsWith('Wheel') && !c.why.some((w) => w.rule === 'package-short'))).toBe(false);
    // A key theme sized 16 is no longer over.
    const sized = cutCandidates({ ...base, cards: [...tokens, ...wheels], tags: tags as never, packages: { t: 16 } });
    expect(sized.candidates.find((c) => c.name === 'Token 0')?.why.some((w) => w.rule === 'package-over') ?? false).toBe(false);
  });

  it('keeps enablers while there are few, and trims payoffs that outnumber them', () => {
    const en = Array.from({ length: 2 }, (_, i) => card(`Enabler ${i}`, 'Creature', 'Whenever you gain life, scry 1.', { cmc: 2, edhrec_rank: 30_000 }));
    const pay = Array.from({ length: 4 }, (_, i) => card(`Payoff ${i}`, 'Creature', 'Whenever you gain life, each opponent loses 1 life.', { cmc: 5, edhrec_rank: 30_000 }));
    const tags = { brief: '', overview: '', tags: [tag('e', 'Lifegain', 'enabler'), tag('p', 'Drain', 'payoff')], cardTags: [...en.map((c) => on(c.card.name, 'e')), ...pay.map((c) => on(c.card.name, 'p'))] };
    const { candidates } = cutCandidates({ ...base, cards: [...en, ...pay], tags: tags as never, packages: { e: 16, p: 2 } });
    expect(candidates.find((c) => c.name === 'Payoff 0')!.why.some((w) => w.rule === 'payoffs')).toBe(true);
    const enabler = candidates.find((c) => c.name === 'Enabler 0');
    expect(enabler?.why.some((w) => w.rule === 'enablers') ?? true).toBe(true);
  });

  it('trims slow ramp and sorcery-speed single-target removal', () => {
    const cards = [card('Big Ramp', 'Sorcery', 'Search for two lands.', { cmc: 5 }), card('Snipe', 'Sorcery', 'Destroy target creature.', { cmc: 2 })];
    const roles = [role('ramp', ['Big Ramp']), role('removal', ['Snipe'])];
    const { candidates } = cutCandidates({ ...base, cards, roles, tags: null });
    expect(candidates.find((c) => c.name === 'Big Ramp')!.why.map((w) => w.rule)).toContain('slowramp');
    expect(candidates.find((c) => c.name === 'Snipe')!.why.map((w) => w.rule)).toContain('sorcery');
  });
});
