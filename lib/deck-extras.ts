/**
 * What a deck needs on the table beyond its cards (components/DeckExtras.tsx): the tokens and emblems its cards
 * make, and the pieces Scryfall files with them (The Monarch, The Initiative, Day // Night, dungeons, meld
 * results), from each card's related parts. Pure.
 */

import type { ScryfallCard } from './scryfall';

type Part = { id: string; component: string; name: string; type_line?: string };
export type ExtraKind = 'token' | 'emblem' | 'other';
type Kind = ExtraKind;
export interface Extra { id: string; name: string; typeLine: string; kind: Kind; from: string[] }

/** A related part that is a game piece rather than a card in its own right. */
const PIECE = /^(Card\b|Dungeon|Emblem|Token)/;

/** The extras a deck's cards make, grouped and named once each. Pure. */
export function extrasOf(cards: ScryfallCard[]): Extra[] {
  const inDeck = new Set(cards.map((c) => c.name));
  const out = new Map<string, Extra>();
  for (const c of cards) {
    for (const p of ((c as { all_parts?: Part[] }).all_parts ?? [])) {
      const type = p.type_line ?? '';
      if (p.name === c.name || inDeck.has(p.name)) continue;
      const kind: Kind | null = /Emblem/.test(type) ? 'emblem'
        : p.component === 'token' ? 'token'
          : p.component === 'meld_result' || (p.component === 'combo_piece' && PIECE.test(type)) ? 'other' : null;
      if (!kind) continue;
      const key = `${p.name}|${type}`;
      const had = out.get(key);
      if (had) { if (!had.from.includes(c.name)) had.from.push(c.name); }
      else out.set(key, { id: p.id, name: p.name, typeLine: type, kind, from: [c.name] });
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}
