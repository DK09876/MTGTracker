/**
 * The Geek stats, against exact values from Python's math.comb for a
 * 99-card library with 38 lands.
 */

import { describe, expect, it } from 'vitest';

import { geek } from './geek';
import { analyse } from './health';
import type { ScryfallCard } from './scryfall';

const card = (name: string, over: Partial<ScryfallCard> = {}) =>
  ({ id: name, name, type_line: 'Instant', cmc: 2, color_identity: [], legalities: { commander: 'legal' }, prices: { usd: '1.00' }, ...over }) as ScryfallCard;

// 16 Swamps, 22 Forests (38 lands) and 61 spells, one of them {1}{B}{B}.
const deck = [
  { card: card('Swamp', { type_line: 'Basic Land — Swamp', cmc: 0, produced_mana: ['B'] }), quantity: 16 },
  { card: card('Forest', { type_line: 'Basic Land — Forest', cmc: 0, produced_mana: ['G'] }), quantity: 22 },
  { card: card('Ravenous Chupacabra', { type_line: 'Creature', cmc: 3, mana_cost: '{1}{B}{B}', prices: { usd: '40.00' } }), quantity: 1 },
  ...Array.from({ length: 60 }, (_, i) => ({ card: card(`Spell ${i}`, { mana_cost: '{1}{G}' }), quantity: 1 })),
];
const commander = card('Commander', { type_line: 'Legendary Creature', color_identity: ['B', 'G'] });
const health = analyse({ commander, cards: deck });
const g = geek({ health, cards: deck, commander: { card: commander }, roles: [{ id: 'ramp', label: 'Ramp', count: 10 }] });

describe('geek', () => {
  it('works out keepable hands, with the free mulligan', () => {
    expect(g.keep.seven).toBeCloseTo(0.8168, 4);
    expect(g.keep.withFreeMulligan).toBeCloseTo(0.9664, 4);
  });

  it('works out land drops, drawing on turn one', () => {
    expect(g.landDrops[2]).toMatchObject({ turn: 3 });
    expect(g.landDrops[2].p).toBeCloseTo(0.8190, 4);
    expect(g.landDrops[4].p).toBeCloseTo(0.5189, 4);
  });

  it('finds the hungriest spell per colour and its odds on curve', () => {
    const black = g.castOnCurve.find((c) => c.color === 'B')!;
    expect(black).toMatchObject({ card: 'Ravenous Chupacabra', mv: 3, pips: 2, sources: 16 });
    expect(black.p).toBeCloseTo(0.5063, 4);
  });

  it('gives the odds of drawing a role by the turn it matters', () => {
    expect(g.roleOdds[0]).toMatchObject({ label: 'Ramp', turn: 2 });
    expect(g.roleOdds[0].p).toBeCloseTo(0.6328, 4);
  });

  it('adds up the mana and the money', () => {
    expect(g.mana.totalPips).toBe(62);
    expect(g.mana.landRatio).toBeCloseTo(38 / 99);
    expect(g.price.top[0]).toEqual({ name: 'Ravenous Chupacabra', price: 40 });
    expect(g.price.total).toBeCloseTo(40 + 60 + 38 + 1);
  });
});
