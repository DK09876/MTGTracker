/**
 * A short fingerprint of a deck's main board: the commander and every card
 * by oracle id with its count. Two decks with the same cards hash the same,
 * whatever printings or order. The suggestion log keeps it with each
 * suggestion, and the plan pass keeps it to tell when the deck has moved on.
 * Server only (node:crypto).
 */

import { createHash } from 'node:crypto';

import type { ScryfallCard } from './scryfall';

type Entry = { card: ScryfallCard; quantity: number };

const keyOf = (c: ScryfallCard) => c.oracle_id ?? c.card_faces?.[0]?.oracle_id ?? c.name.split(' // ')[0].toLowerCase();

/** The main board as a sorted list of "oracle id x count", the commander first. */
export function deckKeys(commander: ScryfallCard | null, main: Entry[]): string[] {
  const counts = new Map<string, number>();
  for (const c of main) counts.set(keyOf(c.card), (counts.get(keyOf(c.card)) ?? 0) + c.quantity);
  return [...(commander ? [`cmd:${keyOf(commander)}`] : []), ...[...counts].map(([k, n]) => `${k}x${n}`).sort()];
}

export function deckHash(commander: ScryfallCard | null, main: Entry[]): string {
  return createHash('sha1').update(deckKeys(commander, main).join('\n')).digest('hex').slice(0, 16);
}

/** How many cards differ between two versions of a deck (added plus removed, counting copies). */
export function cardsChanged(before: string[], after: string[]): number {
  const count = (keys: string[]) => {
    const m = new Map<string, number>();
    for (const k of keys) {
      const [id, n] = k.startsWith('cmd:') ? [k, 1] : [k.slice(0, k.lastIndexOf('x')), Number(k.slice(k.lastIndexOf('x') + 1))];
      m.set(id, (m.get(id) ?? 0) + n);
    }
    return m;
  };
  const a = count(before);
  const b = count(after);
  let diff = 0;
  for (const id of new Set([...a.keys(), ...b.keys()])) diff += Math.abs((a.get(id) ?? 0) - (b.get(id) ?? 0));
  return diff;
}
