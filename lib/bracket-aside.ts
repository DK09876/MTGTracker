/**
 * Cards the owner set aside from the bracket's flags on one deck (Part D 17): "Doesn't count in this deck" on a
 * land-denial or extra-turn card. Kept per deck; the floor, the Plan's bracket read and what Claude is told all
 * leave them out. Server only.
 */

import { getSetting, setSetting } from './db';
import type { ScryfallCard } from './scryfall';
import { oracleTextOf } from './scryfall';

const key = (listId: string) => `bracket.aside.${listId}`;
const front = (n: string) => n.split(' // ')[0].trim().toLowerCase();

export function asideOf(listId: string): Set<string> {
  try { return new Set((JSON.parse(getSetting(key(listId)) ?? '[]') as string[]).map(front)); } catch { return new Set(); }
}

export function setAside(listId: string, name: string, on: boolean): void {
  const now = asideOf(listId);
  if (on) now.add(front(name)); else now.delete(front(name));
  setSetting(key(listId), JSON.stringify([...now].slice(0, 200)));
}

/** Each card's text and whether it is a planeswalker, by name, for the bracket's reasons. */
export function textLookup(cards: ScryfallCard[]): (name: string) => { text: string; planeswalker: boolean } | null {
  const by = new Map(cards.map((c) => [front(c.name), c]));
  return (name) => { const c = by.get(front(name)); return c ? { text: oracleTextOf(c), planeswalker: /\bPlaneswalker\b/.test(c.type_line ?? '') } : null; };
}
