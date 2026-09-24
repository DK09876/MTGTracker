/**
 * The deck in numbers, for the "Geek stats" section.
 *
 * Every probability is hypergeometric - drawing without replacement from
 * the library - with one assumption stated where it shows: in multiplayer
 * Commander nobody skips their first draw, so by turn N you have seen
 * 7 + N cards. The first mulligan is free (multiplayer), so a hand is
 * "kept" if one of the first two sevens is keepable.
 */

import type { Color, Health } from './health';
import { pips } from './health';
import { atLeast } from './odds';
import type { Finish, ScryfallCard } from './scryfall';
import { manaCostOf, priceOf } from './scryfall';

export const seenBy = (turn: number) => 7 + turn;

export interface GeekInput {
  health: Health;
  /** The main board without the commander, lands included. */
  cards: Array<{ card: ScryfallCard; quantity: number; finish?: Finish }>;
  commander: { card: ScryfallCard; finish?: Finish } | null;
  /** Role counts, once they have loaded. */
  roles?: Array<{ id: string; label: string; count: number }>;
}

export interface Geek {
  /** A hand of 2-5 lands counts as keepable. */
  keep: { seven: number; withFreeMulligan: number; withTwoMulligans: number };
  landDrops: Array<{ turn: number; p: number }>;
  castOnCurve: Array<{ color: Color; card: string; mv: number; pips: number; sources: number; p: number }>;
  roleOdds: Array<{ label: string; count: number; turn: number; p: number }>;
  mana: { totalPips: number; pipsPerSpell: number; medianMv: number; landRatio: number };
  price: { total: number; median: number; topTenShare: number; top: Array<{ name: string; price: number }> };
}

const isLand = (card: ScryfallCard) => /\bLand\b/.test((card.card_faces?.[0]?.type_line ?? card.type_line ?? '').split('—')[0])
  && !/\bCreature\b/.test(card.type_line ?? '');

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// When each role is worth having by: ramp early, answers by mid-game.
const ROLE_TURNS: Record<string, number> = { ramp: 2, draw: 4, removal: 4, wipe: 6, tutor: 4 };

export function geek({ health, cards, commander, roles }: GeekInput): Geek {
  const { library, lands } = health.hand;
  const hyper = (hits: number, turn: number, k = 1) => (library >= seenBy(turn) ? atLeast(library, hits, seenBy(turn), k) : 0);

  // Opening hands: 2-5 lands in seven.
  const seven = library >= 7 ? health.hand.distribution.slice(2, 6).reduce((a, b) => a + b, 0) : 0;
  const keep = {
    seven,
    withFreeMulligan: 1 - (1 - seven) ** 2,
    withTwoMulligans: 1 - (1 - seven) ** 3,
  };

  const landDrops = Array.from({ length: 7 }, (_, i) => ({ turn: i + 1, p: hyper(lands, i + 1, i + 1) }));

  // For each colour, the spell hungriest for it (most symbols, then cheapest):
  // the chance of having that many sources of the colour by its turn.
  const spells = cards.filter((c) => !isLand(c.card));
  const castOnCurve: Geek['castOnCurve'] = [];
  for (const { color, landSources } of health.colors) {
    let worst: { card: ScryfallCard; pips: number } | null = null;
    for (const { card } of spells) {
      const n = Math.ceil(pips(manaCostOf(card))[color]);
      if (n > 0 && (!worst || n > worst.pips || (n === worst.pips && (card.cmc ?? 0) < (worst.card.cmc ?? 0)))) worst = { card, pips: n };
    }
    if (!worst) continue;
    const mv = Math.max(1, Math.ceil(worst.card.cmc ?? 1));
    castOnCurve.push({ color, card: worst.card.name, mv, pips: worst.pips, sources: landSources, p: hyper(landSources, mv, worst.pips) });
  }

  const roleOdds = (roles ?? [])
    .filter((r) => r.count > 0 && ROLE_TURNS[r.id])
    .map((r) => ({ label: r.label, count: r.count, turn: ROLE_TURNS[r.id], p: hyper(r.count, ROLE_TURNS[r.id]) }));

  const spellCopies = spells.reduce((n, c) => n + c.quantity, 0);
  const totalPips = spells.reduce((sum, { card, quantity }) => {
    const p = pips(manaCostOf(card));
    return sum + (p.W + p.U + p.B + p.R + p.G) * quantity;
  }, 0);
  const mvs = spells.flatMap(({ card, quantity }) => Array<number>(quantity).fill(card.cmc ?? 0));

  // Price per copy, the commander included - it is part of what the deck costs.
  const priced = [
    ...cards.flatMap(({ card, quantity, finish }) => Array(quantity).fill({ name: card.name, price: priceOf(card, finish) ?? 0 })),
    ...(commander ? [{ name: commander.card.name, price: priceOf(commander.card, commander.finish) ?? 0 }] : []),
  ] as Array<{ name: string; price: number }>;
  const total = priced.reduce((n, c) => n + c.price, 0);
  const byPrice = [...priced].sort((a, b) => b.price - a.price);

  return {
    keep,
    landDrops,
    castOnCurve,
    roleOdds,
    mana: {
      totalPips: Math.round(totalPips * 10) / 10,
      pipsPerSpell: spellCopies ? totalPips / spellCopies : 0,
      medianMv: median(mvs),
      landRatio: library ? lands / library : 0,
    },
    price: {
      total,
      median: median(priced.map((c) => c.price)),
      topTenShare: total ? byPrice.slice(0, 10).reduce((n, c) => n + c.price, 0) / total : 0,
      top: byPrice.slice(0, 5),
    },
  };
}
