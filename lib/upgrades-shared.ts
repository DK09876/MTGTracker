/**
 * Upgrades (handoff 10, Part A), as both the page and the server read it:
 * "the deck is at 100; what would make it better, from my boxes or to buy,
 * and what does each replace?" One conversation per deck, built like
 * Finish's: Claude searches the owner's cards and names well-known cards they
 * don't have; the app checks every name, says where each copy is, prices it
 * and works out what the swap does to the job counts. Pure.
 */

import type { RoundCost } from './finish-shared';

/** How many suggestions: the owner's answer (2026-11-13) was 10 by default, 5 and 20 offered. */
export const UPGRADE_COUNTS = [5, 10, 20] as const;
export const UPGRADE_DEFAULT = 10;

/** Where the suggestions may come from: the owner's cards, cards to buy, or both (the default). */
export type UpgradeSources = 'both' | 'mine' | 'buy';
export const UPGRADE_SOURCES: Array<{ id: UpgradeSources; label: string }> = [
  { id: 'both', label: 'Both' },
  { id: 'mine', label: 'From my cards' },
  { id: 'buy', label: 'To buy' },
];

/** Searches over the owner's cards: the first list, and each later round (proposed 10; counted and refused in code). */
export const UPGRADE_SEARCHES = 10;
export const UPGRADE_SEARCHES_LATER = 4;

/** Swap in (the default) | Rethink | Not for me. */
export type UpgradeChoice = 'in' | 'ask' | 'skip';
/** Swap in puts the card in the main deck and the replaced card in the cuts section; "maybe" waits in the Maybeboard instead and nothing comes out. */
export type UpgradeWhere = 'swap' | 'maybe';

/** Where the copy is, worked out by the app, never by the model. */
export type UpgradeOwn =
  | { kind: 'spare' }
  | { kind: 'section'; section: string }
  | { kind: 'deck'; deck: string }
  | { kind: 'buy'; price: number | null };

export interface UpgradeItem {
  name: string;
  /** The job it does in this deck, in Claude's words. */
  job: string;
  why: string;
  own: UpgradeOwn;
  /** Claude called it a card to buy, but the owner has it: shown as owned. */
  wasBuy?: boolean;
  /** The card in the main deck it replaces; null when Claude named none the app could use ("you choose what comes out"). */
  out: { name: string; id: string; why: string; image?: string | null } | null;
  /** Why "replaces" was dropped, when Claude named a card that may not come out (the commander, never cut, not in the deck). */
  outNote?: string;
  /** What the swap does to the job counts, worked out by the app: true statements. */
  warn: string[];
  /** new: not on the last list; back: a Rethink that came back with a new reason. */
  mark: 'new' | 'back' | null;
  card: { id: string; image: string | null; manaCost: string; typeLine: string; text: string; cmc: number; land: boolean };
}

export interface UpgradeChanges {
  round: number;
  out: Array<{ name: string; because: 'skipped' | 'rethink' | 'message' | 'gone' }>;
  in: string[];
  back: string[];
}

export interface UpgradesView {
  size: number;
  count: number;
  sources: UpgradeSources;
  /** "Only cards I own" on the plan: cards to buy are off, and the screen says so. */
  ownOnly: boolean;
  plan: { text: string | null; confirmed: boolean; budget: number | null };
  run: {
    id: string; at: string; round: number; model: string; want: number; read: string;
    items: UpgradeItem[];
    /** Names the app couldn't use (not a card, off-colour, over budget, in the deck...), counted and said; never shown as suggestions. */
    dropped: Array<{ name: string; why: string }>;
    changes: UpgradeChanges | null;
  } | null;
  choices: Record<string, { choice: UpgradeChoice; text: string; where?: UpgradeWhere }>;
  /** "Not for me" on this deck before, with the owner's reason: never offered again here (apart from Finish's list). */
  notForMe: Array<{ name: string; why: string }>;
  offer: { n: number; colours: string; searched: boolean } | null;
  searches: Array<{ q: string; n: number; round: number }>;
  job: { status: 'running' | 'failed'; detail: string | null; error: string | null } | null;
  done: { at: string; swapped: number; maybe: number; size: number; cutsTo: string; buy: Array<{ name: string; price: number | null }>; skipped?: Array<{ name: string; why: string }> } | null;
  cost: { first: RoundCost; later: RoundCost };
  noKey: boolean;
}

/** A card's chip: "spare copy", "in your Maybeboard", "in <deck>", "to buy · $1.20" or "to buy · no price". */
export function ownLabel(o: UpgradeOwn): string {
  switch (o.kind) {
    case 'spare': return 'spare copy';
    case 'section': return `in your ${o.section}`;
    case 'deck': return `in ${o.deck}`;
    default: return `to buy · ${o.price === null ? 'no price' : `$${o.price.toFixed(2)}`}`;
  }
}

export const isBuy = (o: UpgradeOwn): o is Extract<UpgradeOwn, { kind: 'buy' }> => o.kind === 'buy';

/** The rows on Swap in (Swap in is the default when no choice is kept). */
export const chosenIn = (items: Array<Pick<UpgradeItem, 'name'>>, choices: UpgradesView['choices']) =>
  items.filter((i) => (choices[i.name]?.choice ?? 'in') === 'in').map((i) => i.name);

/** The buy list's total: cards with no price are left out of it and counted apart. */
export function buyTotal(rows: Array<{ price: number | null }>): { total: number; priced: number; unpriced: number } {
  const priced = rows.filter((r) => r.price !== null);
  return { total: Math.round(priced.reduce((n, r) => n + r.price!, 0) * 100) / 100, priced: priced.length, unpriced: rows.length - priced.length };
}

/** "Copy as a buy list": one card a line with its price, the total last. */
export function buyListText(rows: Array<{ name: string; price: number | null }>): string {
  const t = buyTotal(rows);
  return [
    ...rows.map((r) => `1 ${r.name}${r.price === null ? ' (no price)' : ` $${r.price.toFixed(2)}`}`),
    `Total: $${t.total.toFixed(2)}${t.unpriced ? ` (${t.unpriced} with no price not counted)` : ''}`,
  ].join('\n');
}

/** The owner's words ask about lands: only then may a land be suggested. */
export const asksForLands = (text: string) => /\blands?\b/i.test(text);
