/**
 * The parts of a plan read from the cards: each with its strength and how
 * it was worked out.
 */

import { describe, expect, it } from 'vitest';

import type { Job } from './deck-numbers';
import {
  detectArchetype, detectBracket, detectBuild, detectCommanderRole, detectFlip, detectLean, detectRoutes, detectStages, detectStyleParts, detectThemes,
  keyCandidates, PROTECTION_BY_LEAN,
} from './plan-detect';
import { fitProfile } from './fit';
import type { RoleCount } from './roles';
import type { ScryfallCard } from './scryfall';
import { styleById } from './styles';

const card = (name: string, text: string, extra: Partial<ScryfallCard> = {}): ScryfallCard => ({ id: name, oracle_id: name, name, oracle_text: text, type_line: 'Creature — Human', cmc: 3, ...extra } as ScryfallCard);
const deck = (cards: ScryfallCard[]) => cards.map((c) => ({ card: c, quantity: 1 }));
const many = (n: number, text: string, extra: Partial<ScryfallCard> = {}) => Array.from({ length: n }, (_, i) => card(`${text.slice(0, 12)} ${i}`, text, extra));
const job = (id: string, count: number, range: [number, number] | null = null, cards: string[] = []): Job => ({ id: id as Job['id'], label: id, group: 'cards', count, cards, range, how: { inputs: [], steps: [] } });

const prosper = card('Prosper, Tome-Bound', 'Deathtouch\nMystic Arcanum — At the beginning of your end step, exile the top card of your library. Until the end of your next turn, you may play that card.\nPact Boon — Whenever you play a card from exile, create a Treasure token.', { cmc: 4, type_line: 'Legendary Creature — Tiefling Warlock' });

describe('bracket', () => {
  it('reads the floor from the bracket report, as 2 when nothing needs more', () => {
    const report = { cards: [{ name: 'Demonic Tutor', gameChanger: true, massLandDenial: false, extraTurn: false, banned: false }], combos: [] };
    const b = detectBracket([], [], report);
    expect([b.value, b.strength]).toEqual([3, 'likely']);
    expect(detectBracket([], [], { cards: [], combos: [] }).value).toBe(2);
  });

  it('falls back to Game Changers alone, as a guess', () => {
    const gc = many(4, 'Draw a card.', { game_changer: true });
    const b = detectBracket(deck(gc), [], null);
    expect([b.value, b.strength]).toEqual([4, 'guess']);
    expect(b.how.inputs.join(' ')).toContain('not checked');
  });
});

describe('styles, the commander\'s role and how the deck is built', () => {
  it('reads Prosper as casting from exile with treasure, and says how sure', () => {
    const cards = deck([...many(22, 'Exile the top card of your library. You may play it this turn.'), ...many(14, 'Create a Treasure token.')]);
    const s = detectStyleParts(prosper, cards);
    expect([s.value.primary.id, s.value.secondary?.id, s.strength]).toEqual(['exile', 'treasure', 'clear']);
    expect(detectStyleParts(prosper, cards.slice(0, 10)).strength).toBe('guess');
  });

  it('calls an every-turn value commander with few other engines the engine', () => {
    const r = detectCommanderRole(prosper, deck(many(40, 'Create a Treasure token.')), [{ id: 'engine', cards: [] } as unknown as RoleCount], [], []);
    expect(r.value).toBe('Engine');
    const doubler = card('Doubler', 'If a token would be created under your control, twice that many are created instead.');
    expect(detectCommanderRole(doubler, deck(many(40, 'Create a token.')), [], [], []).value).toBe('Multiplier');
  });

  it('is dense when a creature type fills 20 or more cards, broad otherwise', () => {
    const elves = card('Lathril', 'Whenever you attack, each Elf you control gets +1/+0. Elves you control have deathtouch.');
    const dense = detectBuild(deck(many(24, 'Other Elves you control get +1/+1.')), fitProfile(elves));
    expect(dense.value).toBe('Dense');
    expect(detectBuild(deck(many(10, 'Other Elves you control get +1/+1.')), fitProfile(elves)).value).toBe('Broad');
  });
});

describe('themes', () => {
  it('finds the themes the commander asks for, the biggest sized 16, and splits enablers, payoffs and multipliers', () => {
    const cards = deck([
      ...many(10, 'Create a Treasure token.'),
      card('Payoff', 'Whenever you sacrifice a Treasure, each opponent loses 1 life.'),
      card('Doubler', 'If you would create one or more Treasure tokens, create twice that many instead.'),
    ]);
    const t = detectThemes(prosper, cards);
    const treasure = t.value.find((x) => x.id === 'treasure')!;
    expect(treasure).toMatchObject({ commander: true, size: 16, multipliers: 1, payoffs: 1, enablers: 10, strength: 'clear' });
  });

  it('uses words in Scryfall tag names too', () => {
    const plain = deck(many(9, 'Flying.'));
    const t = detectThemes(null, plain, () => ['token-maker']);
    expect(t.value.some((x) => x.id === 'tokens' && x.cards.length === 9)).toBe(true);
  });
});

describe('how it wins, and how much it leans on the commander', () => {
  const routes = [
    { id: 'alt-win', label: 'Alternate win', how: '', cards: ['Revel in Riches'], strength: 'strong' as const },
    { id: 'voltron', label: 'Commander damage', how: '', cards: ['Sword'], strength: 'some' as const },
  ];

  it('marks routes that need the commander', () => {
    const r = detectRoutes(routes, prosper, 'Enabler', []);
    expect(r.value.map((x) => x.needsCommander)).toEqual([false, true]);
  });

  it('scores the lean and moves protection with it', () => {
    const r = detectRoutes(routes, prosper, 'Engine', []).value;
    expect(detectLean('Engine', r, 0.3, 60).value).toBe('High');
    expect(detectLean('Covers a weakness', r.slice(0, 1), 0.05, 60).value).toBe('Low');
    expect(PROTECTION_BY_LEAN.High).toEqual([3, 5]);
  });

  it('offers key cards the brief names or that win on their own, never the commander', () => {
    const pool = deck([card('Revel in Riches', 'You win the game.'), card('Mayhem Devil', 'Whenever a player sacrifices a permanent, deal 1 damage.'), prosper]);
    // Cards that win first, then the ones the brief names.
    expect(keyCandidates(pool, 'I love Mayhem Devil', routes, null, prosper)).toEqual(['Revel in Riches', 'Mayhem Devil']);
    // A brief that lists many cards is listing the deck, not naming key cards.
    const listed = deck(['A1', 'B2', 'C3', 'D4'].map((n) => card(`Card ${n}`, 'x')));
    expect(keyCandidates(listed, 'Card A1, Card B2, Card C3 and Card D4.', [], null, prosper)).toEqual([]);
  });

  it('takes the flip turn from a key card that costs more than the commander', () => {
    const big = card('Big', 'Engine.', { cmc: 7 });
    expect(detectFlip(prosper, [prosper]).value).toBe(4);
    expect(detectFlip(prosper, [prosper, big]).value).toBe(7);
  });

  it('drafts the stages from the flip turn, styles and main route', () => {
    const r = detectRoutes(routes, prosper, 'Enabler', []).value;
    const s = detectStages(prosper, 4, [styleById('treasure')!], r, [job('ramp', 2, [11, 13], ['Sol Ring', 'Arcane Signet'])]);
    expect(s.value.early).toContain('Prosper by turn 4');
    expect(s.value.close).toContain('Revel in Riches');
  });

  it('reads the archetype from the numbers', () => {
    expect(detectArchetype(deck(many(40, 'x', { cmc: 2 })), [job('interaction', 10), job('draw', 10)], []).value).toBe('Aggro');
    expect(detectArchetype(deck(many(40, 'x', { type_line: 'Instant', cmc: 2 })), [job('interaction', 16), job('draw', 15)], []).value).toBe('Control');
    expect(detectArchetype(deck(many(40, 'x', { type_line: 'Sorcery', cmc: 4 })), [job('interaction', 10)], [{ id: 'combo', label: 'Combo', how: '', cards: [], strength: 'strong', needsCommander: false }]).value).toBe('Combo');
    expect(detectArchetype(deck(many(40, 'x', { type_line: 'Sorcery', cmc: 4 })), [job('interaction', 10)], []).value).toBe('Midrange');
  });
});
