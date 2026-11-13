/**
 * Tune, as both the page and the server read it: what you can do with a
 * deck (the intents), suggestions waiting for you in groups, and your
 * changes - cards to add and to cut, some paired as swaps - which touch the
 * deck only when you apply them. Pure.
 */

import type { Board } from './decklist';

export type Intent = 'finish' | 'find' | 'swaps' | 'cuts' | 'fix' | 'lands';

export const INTENTS: Array<{ id: Intent; label: string; why: string }> = [
  { id: 'finish', label: 'Finish the deck', why: 'Fill a deck that is far from 100: lands, the jobs every deck needs, your themes, ways to win. Each group waits for you to accept it.' },
  { id: 'find', label: 'Find cards', why: 'Cards for the jobs and themes the deck is short of, and combos one card away. Accept them into your changes, or save them to a section for later.' },
  { id: 'swaps', label: 'Swaps', why: 'For each card waiting in your Maybeboard, the deck cards doing the same job at about the same cost, to help you choose. Not ranked. Ask Claude for swaps it would make. The deck stays at its size.' },
  { id: 'cuts', label: 'Cuts', why: 'Where to find room when the deck is over 100, in the order to look: flagged cards, a heavy curve, your bracket, jobs over their range, cards off the plan.' },
  { id: 'fix', label: 'Fix a problem', why: 'Start from how the last games went. Each problem shows the numbers behind it and at most three swaps for it.' },
  { id: 'lands', label: 'Lands', why: 'The one land number, how your colours split, and basics to add or cut.' },
];

/**
 * The step the deck's size points to (the deck flow plan): over 100, trim;
 * at 100, swaps from what waits to go in; under 100, fill it - from scratch
 * when it is far from 100. However far over, a deck over 100 is trimmed:
 * "the best 100 from everything" is still there under Find cards.
 */
export function suggestedIntent(size: number, pool: number): Intent {
  void pool;
  if (size > 100) return 'cuts';
  if (size === 100) return 'swaps';
  return size < 60 ? 'finish' : 'find';
}

/** A card as a suggestion shows it. */
export interface CardRef {
  /** A printing id: the deck's own, or one from the card data for a card not in the deck. */
  id: string;
  name: string;
  cmc: number;
  manaCost: string;
  typeLine: string;
  image: string | null;
  /** Where you have a copy: "yours, Box 2", "in Ulalek Eldrazi". */
  where?: string | null;
  price?: string | null;
  /** For a card already in the deck: the section it is in. */
  from?: Board;
  gameChanger?: boolean;
}

export interface How {
  inputs: string[];
  steps: string[];
}

/** One suggestion: a card to add, one to cut, or both (a swap). */
export interface Suggestion {
  key: string;
  add?: CardRef & { quantity?: number };
  cut?: CardRef & { quantity?: number };
  why: string;
  warn?: string;
  /** For Claude's: the usual rule it goes against, and why that's fine here. */
  breaks?: string;
  /** Claude's "keep this": a ★ keep rather than a change. */
  keep?: boolean;
  how?: How;
}

export interface SuggestionGroup {
  key: string;
  title: string;
  why: string;
  /** Rules (no model) or Claude's proposals. */
  source: 'rules' | 'claude';
  items: Suggestion[];
  /** For cut groups: the filter it belongs to. */
  filter?: CutFilter;
  /** A group that picks one of its items (a card's possible replacements). */
  pickOne?: boolean;
  /** Claude's groups: the model that answered and the prompt's version (lib/prompt-versions.ts), for the suggestion log. */
  model?: string | null;
  promptVersion?: string;
  /** Claude's groups: which call made them. A new round replaces the last in the suggestion log. */
  round?: string;
}

export type CutFilter = 'flagged' | 'curve' | 'bracket' | 'interaction' | 'rampdraw' | 'offplan' | 'other';

export const CUT_FILTERS: Array<{ id: CutFilter | 'all'; label: string; why: string }> = [
  { id: 'flagged', label: 'Flagged', why: 'Duplicates, cards outside the colours, banned or not legal. The easiest room there is.' },
  { id: 'curve', label: 'Heavy curve', why: 'Where many more cards sit at one cost than usual, or a card costs 6 or more and does not end the game.' },
  { id: 'bracket', label: 'Over your bracket', why: 'Game Changers past what your bracket allows.' },
  { id: 'interaction', label: 'Interaction over range', why: 'More removal, counterspells and wipes than the plan wants: the first utility to trim.' },
  { id: 'rampdraw', label: 'Ramp or draw over range', why: 'Ramp when the commander is cheap, card draw when it is dear, past the plan\'s range.' },
  { id: 'offplan', label: 'Off the plan', why: 'Cards that do nothing the plan, its styles or themes ask for, and no job every deck needs.' },
  { id: 'all', label: 'Best first', why: 'Every card the rules would offer, the best cut first.' },
];

/** A staged change, kept until you apply or clear it. */
export interface Staged {
  /** Unique per staged card. */
  key: string;
  card: CardRef;
  quantity: number;
  why: string;
  /** The suggestion it came from, so the suggestion shows as accepted. */
  from?: string;
  /** The other half of a swap. */
  pair?: string;
}

export interface Changes {
  add: Staged[];
  cut: Staged[];
}

export const NO_CHANGES: Changes = { add: [], cut: [] };

export interface ImpactRow {
  id: string;
  label: string;
  before: number;
  after: number;
  range: [number, number] | null;
}

export interface Impact {
  size: { before: number; after: number };
  rows: ImpactRow[];
  averageMv: { before: number; after: number };
  gameChangers: { before: number; after: number; limit: number | null };
}

/** A fix you applied, and whether it helped. */
export interface FixLog {
  id: string;
  at: string;
  symptom: Symptom;
  swaps: Array<{ add: string; cut: string }>;
  verdict?: 'better' | 'same' | 'worse';
}

export type Symptom = 'gas' | 'mana' | 'late' | 'close' | 'wiped';

export const SYMPTOMS: Array<{ id: Symptom; label: string; sub: string }> = [
  { id: 'gas', label: 'Ran out of cards', sub: 'An empty hand by the middle of the game' },
  { id: 'mana', label: 'Stuck on mana', sub: 'Missed land drops, or the wrong colours' },
  { id: 'late', label: 'The commander came down late', sub: 'It missed the turn it should have come down' },
  { id: 'close', label: 'Couldn’t finish', sub: 'Ahead, but the game dragged on' },
  { id: 'wiped', label: 'Got wiped', sub: 'Lost the board and couldn’t rebuild' },
];

/** How many unpaired cuts may still be staged before the deck would go under 100. */
export function cutsLeft(sizeAfter: number): number {
  return Math.max(0, sizeAfter - 100);
}

/**
 * The first cards of a list that fit in the room left to 100: for "cut the
 * N Claude agrees on" and the like. Over 100 by 3, a list of 5 gives 3.
 */
export function capToHundred<T>(items: T[], sizeAfter: number): T[] {
  return items.slice(0, cutsLeft(sizeAfter));
}
