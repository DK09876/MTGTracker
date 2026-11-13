/**
 * Finish the deck from the owner's collection (handoff 8), as both the page
 * and the server read it: the copies setting, how many cards to add, the
 * search over the owner's cards, the combo check and the conversation's
 * shapes. Pure.
 */

/** Which of the owner's cards may be offered: spare copies only (the default), or cards in other decks too. */
export type Copies = 'spare' | 'any';
export const COPIES: Array<{ id: Copies; label: string; why: string }> = [
  { id: 'spare', label: 'Only spare copies', why: 'Skips a card that sits in another deck unless you own another copy.' },
  { id: 'any', label: 'Take from other decks too', why: 'Any card you own. A card that sits in another deck says which one. Applying doesn’t take it out of that deck.' },
];

/** The groups Claude's picks arrive in. No lands: the app chooses those. */
export const FINISH_GROUPS = ['ramp', 'draw', 'interaction', 'theme', 'wins', 'protection'] as const;
export type FinishGroup = (typeof FINISH_GROUPS)[number];
export const FINISH_TITLE: Record<FinishGroup, string> = { ramp: 'Ramp', draw: 'Card draw', interaction: 'Interaction', theme: 'Theme', wins: 'Ways to win', protection: 'Protection' };

/** Searches Claude may run: the first list, and each later round. Counted and refused in code. */
export const SEARCH_LIMIT = 25;
export const SEARCH_LIMIT_LATER = 8;
/** Cards a search returns, at most; the true count is said too. */
export const SEARCH_SHOWN = 40;

/** Where a pick's copy comes from. */
export type Source = 'spare' | 'maybe' | 'other';

/** One of the owner's cards on offer, as a search returns it. */
export interface PoolLine {
  name: string;
  /** "name {cost} - type - rules text", and " (in <deck>)" for a card only another deck holds. */
  line: string;
  cmc: number;
  typeLine: string;
  src: Source;
  /** The deck it sits in, for a card only another deck holds. */
  deck?: string;
}

export interface Query { words: string[]; type: string | null; mv: number | null }

/** A search as Claude writes it: words that must all match, `t:<type>`, `mv<=N`. */
export function parseQuery(q: string): Query {
  const out: Query = { words: [], type: null, mv: null };
  for (const w of q.toLowerCase().replace(/["“”]/g, ' ').split(/\s+/).filter(Boolean)) {
    if (w.startsWith('t:') && w.length > 2) out.type = w.slice(2);
    else if (/^(mv|cmc)<=\d+$/.test(w)) out.mv = Number(w.replace(/^(mv|cmc)<=/, ''));
    else if (/^(mv|cmc)<\d+$/.test(w)) out.mv = Number(w.replace(/^(mv|cmc)</, '')) - 1;
    else out.words.push(w);
  }
  return out;
}

/** The owner's cards that match: every word in the name, type line or rules text; the type in the type line; the mana value at most N. */
export function searchLines(pool: PoolLine[], q: string, shown = SEARCH_SHOWN): { total: number; lines: PoolLine[] } {
  const { words, type, mv } = parseQuery(q);
  const hits = pool.filter((c) => {
    const l = c.line.toLowerCase();
    if (type && !c.typeLine.toLowerCase().includes(type)) return false;
    if (mv !== null && c.cmc > mv) return false;
    return words.every((w) => l.includes(w));
  });
  return { total: hits.length, lines: hits.slice(0, shown) };
}

/** What the search tool answers, in search.py's format. */
export function searchText(r: { total: number; lines: PoolLine[] }): string {
  return [`${r.total} match${r.total > r.lines.length ? `, first ${r.lines.length} shown` : ''}`, ...r.lines.map((c) => c.line)].join('\n');
}

// --- how many ------------------------------------------------------------------------

/**
 * The cards to add: `want` picks by Claude, plus the lands the app chooses
 * on a full fill only. A full fill is the room to 100 less the lands still
 * short; any other number (5, or past 100 on purpose) adds no lands.
 */
export function finishCount(size: number, landsShort: number, want: number | null): { want: number; full: boolean; room: number; nonland: number; lands: number } {
  const room = Math.max(0, 100 - size);
  const lands = Math.min(room, Math.max(0, landsShort));
  const nonland = room - lands;
  const n = want === null || !Number.isFinite(want) || want < 1 ? (nonland || 5) : Math.round(want);
  const full = room > 0 && n === nonland;
  return { want: n, full, room, nonland, lands: full ? lands : 0 };
}

// --- combos --------------------------------------------------------------------------

export interface OwnedCombo { id: string; cards: string[]; produces: string[] }

const front = (n: string) => n.split(' // ')[0].trim().toLowerCase();

/** The combos complete among these names (the commander, the deck and the picks still on Add). */
export function completeCombos(combos: OwnedCombo[], names: Iterable<string>): OwnedCombo[] {
  const have = new Set([...names].map(front));
  return combos.filter((c) => c.cards.length > 0 && c.cards.every((n) => have.has(front(n))));
}

/**
 * The combo lookup takes at most 600 cards a request, so a pool goes in
 * chunks: every pair of chunks is one request (one request when there is a
 * single chunk). A three-card combo spread over three chunks is missed.
 */
export function chunkPairs<T>(items: T[], size = 290): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  if (chunks.length <= 1) return chunks;
  const out: T[][] = [];
  for (let a = 0; a < chunks.length; a++) for (let b = a + 1; b < chunks.length; b++) out.push([...chunks[a], ...chunks[b]]);
  return out;
}

// --- the conversation ------------------------------------------------------------------

export type FinishChoice = 'add' | 'ask' | 'skip';

export interface FinishMark { name: string; choice: FinishChoice; text: string }

export type FinishTurn =
  | { kind: 'owner-start'; want: number; copies: Copies; at: string }
  | { kind: 'claude-picks'; round: number; picks: string[]; short: number; searches: number; reply: string; at: string }
  | { kind: 'owner-reply'; marks: FinishMark[]; message: string; taken: string[]; at: string };

/** One row on the list. */
export interface FinishItem {
  name: string;
  group: FinishGroup;
  /** The theme's name, for the theme group. */
  theme?: string;
  why: string;
  src: Source;
  deck?: string;
  /** new: this round's pick after the first; yours: taken from a search's results by the owner. */
  mark: 'new' | 'yours' | null;
  card: { id: string; image: string | null; manaCost: string; typeLine: string; text: string; cmc: number };
}

export interface FinishSearch { q: string; n: number; round: number }

export interface FinishView {
  size: number;
  copies: Copies;
  /** The number asked for; null is a fill to 100. */
  want: number | null;
  /** Cards on offer under each setting, and the funnel behind them. */
  counts: { held: number; fit: number; spare: number; any: number; otherOnly: number } | null;
  /**
   * mode: what the plan says. owned: how many combos the owner holds every piece of (looked up only when the
   * plan says first or none). found: the combos complete among `base` and the round's picks, checked by the
   * app after every round; the page keeps the ones still complete with the picks on Add.
   */
  combos: { mode: 'first' | 'none' | null; owned: number | null; failed: boolean; found: OwnedCombo[]; base: string[] };
  plan: { text: string | null; confirmed: boolean };
  howMany: { room: number; nonland: number; lands: number };
  run: {
    id: string; at: string; round: number; model: string; want: number; full: boolean; short: number; reply: string;
    items: FinishItem[];
    /** Per group: the search that fed it, and its cards not already listed (for "+"). */
    more: Record<string, { q: string; n: number; cards: Array<{ name: string; manaCost: string }> }>;
    lands: { names: string[]; basics: Array<{ name: string; n: number }>; total: number; why: string } | null;
    /** Picks Claude named that the app dropped (not on offer or not searched), for the record. */
    dropped: number;
  } | null;
  choices: Record<string, { choice: FinishChoice; text: string }>;
  skipped: string[];
  turns: FinishTurn[];
  /** This round's searches, as they run and once done. */
  searches: FinishSearch[];
  job: { status: 'running' | 'failed'; detail: string | null; error: string | null } | null;
  done: { at: string; added: number; lands: number; size: number; borrowed: string[] } | null;
  cost: { first: { usd: number; measured: boolean }; later: { usd: number; measured: boolean } };
  noKey: boolean;
}

/** The rows on Add, the owner's taken cards included. */
export const chosenAdds = (items: Array<Pick<FinishItem, 'name'>>, choices: Record<string, { choice: FinishChoice }>) =>
  items.filter((i) => (choices[i.name]?.choice ?? 'add') === 'add').map((i) => i.name);
