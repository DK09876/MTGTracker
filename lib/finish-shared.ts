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
/**
 * Chat's searches over the owner's cards in one answer (handoff 9), counted and refused in code. 12 from the
 * theme test (2026-11-13): with 20 allowed the runs used 12-15 and picked the same best theme as with 12; with 6
 * one answer flipped.
 */
export const CHAT_SEARCH_LIMIT = 12;

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
  /** The section of this deck it waits in (the Maybeboard, a Sideboard, one of the owner's), for a card from there. */
  section?: string;
}

export interface Query {
  words: string[];
  /** Words a card must not have (-word). */
  not: string[];
  /** Every t: filter; a card must match all of them (t:zombie t:creature is Zombie creatures). */
  types: string[];
  /** -t: filters: a card must match none of them. */
  notTypes: string[];
  /** Mana value at most / at least. */
  mv: number | null;
  mvMin: number | null;
  /** Filters the search doesn't know (c:r, pow>=3): left out of the match and named in the answer. */
  ignored: string[];
}

/** A search as Claude writes it: words that must all match, `-word`, `t:<type>`, `mv<=N`, `mv>=N`, `mv=N`. */
export function parseQuery(q: string): Query {
  const out: Query = { words: [], not: [], types: [], notTypes: [], mv: null, mvMin: null, ignored: [] };
  for (const w of q.toLowerCase().replace(/["“”()]/g, ' ').split(/\s+/).filter(Boolean)) {
    const mv = w.match(/^(?:mv|cmc|manavalue)(<=|>=|<|>|=|:)(\d+)$/);
    const text = w.match(/^(?:o|oracle|text|name|n):(.+)$/);
    const type = w.match(/^(?:t|type):(.+)$/);
    const notType = w.match(/^-(?:t|type):(.+)$/);
    if (type) out.types.push(type[1]);
    else if (notType) out.notTypes.push(notType[1]);
    else if (mv) {
      const n = Number(mv[2]);
      if (mv[1] === '<=') out.mv = n;
      else if (mv[1] === '<') out.mv = n - 1;
      else if (mv[1] === '>=') out.mvMin = n;
      else if (mv[1] === '>') out.mvMin = n + 1;
      else { out.mv = n; out.mvMin = n; }
    } else if (text) out.words.push(text[1]);
    else if (/^-?[a-z]+(:|<=|>=|<|>|=)/.test(w)) out.ignored.push(w);
    else if (w.startsWith('-') && w.length > 1) out.not.push(w.slice(1));
    else out.words.push(w);
  }
  return out;
}

/** The owner's cards that match: every word in the name, type line or rules text; the type in the type line; the mana value in range. */
export function searchLines(pool: PoolLine[], q: string, shown = SEARCH_SHOWN): { total: number; lines: PoolLine[]; ignored: string[]; bySrc: Record<Source, number> } {
  const { words, not, types, notTypes, mv, mvMin, ignored } = parseQuery(q);
  const hits = pool.filter((c) => {
    const l = c.line.toLowerCase();
    if (!types.every((t) => c.typeLine.toLowerCase().includes(t))) return false;
    if (notTypes.some((t) => c.typeLine.toLowerCase().includes(t))) return false;
    if (mv !== null && c.cmc > mv) return false;
    if (mvMin !== null && c.cmc < mvMin) return false;
    return words.every((w) => l.includes(w)) && !not.some((w) => l.includes(w));
  });
  const bySrc: Record<Source, number> = { spare: 0, maybe: 0, other: 0 };
  for (const h of hits) bySrc[h.src] += 1;
  return { total: hits.length, lines: hits.slice(0, shown), ignored, bySrc };
}

/** What the search tool answers, in search.py's format; a filter it couldn't use is named, so a "0 match" is never a silent misread. */
export function searchText(r: { total: number; lines: PoolLine[]; ignored?: string[] }): string {
  return [
    `${r.total} match${r.total > r.lines.length ? `, first ${r.lines.length} shown` : ''}`,
    ...(r.ignored?.length ? [`Ignored, not understood: ${r.ignored.join(' ')}. The search takes plain words, -word, t:<type>, -t:<type>, mv<=N, mv>=N and mv=N only.`] : []),
    ...r.lines.map((c) => c.line),
  ].join('\n');
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
  /** The section of this deck it waits in, for src 'maybe'. */
  section?: string;
  /**
   * new: on this list and not the last; back: a card the owner asked Claude to rethink that it picked again, with
   * a new reason (the reason is what is new); yours: taken from a search's results by the owner.
   */
  mark: 'new' | 'back' | 'yours' | null;
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
  /** lands: to add on a fill to 100; target: lands in the deck when done (mine: the owner's number, else the plan's); have: lands now. */
  howMany: { room: number; nonland: number; lands: number; target: number; mine: boolean; have: string; plan: [number, number] };
  run: {
    id: string; at: string; round: number; model: string; want: number; full: boolean; short: number; reply: string;
    items: FinishItem[];
    /** Per group: the search that fed it, and its cards not already listed (for "+"). */
    more: Record<string, { q: string; n: number; cards: Array<{ name: string; manaCost: string }> }>;
    /** A fill to 100: the app's lands, with the owner's changes. total: what goes in; suggested: what the app chose; target: lands in the deck when done. */
    /**
     * duals: the nonbasic lands, ticked or not (Claude's picks with its reason, Part E; or an older run's
     * colour-fixing lands). more: the owner's lands the land searches found, for "+". short: colours left
     * short of their share once the nonbasic lands are in. limit: how many nonbasic lands Claude could pick.
     */
    lands: {
      duals: Array<{ name: string; on: boolean; why?: string; deck?: string }>; basics: Array<{ name: string; n: number; suggested: number }>;
      total: number; suggested: number; target: number; why: string;
      more: string[]; short: Array<{ colour: string; have: number; want: number }>; limit: number | null; byClaude: boolean;
    } | null;
    /** What changed since the last list (a later round), worked out by the app from the two lists. */
    changes: FinishChanges | null;
    /** Picks Claude named that the app dropped (not on offer or not searched), for the record. */
    dropped: number;
  } | null;
  choices: Record<string, { choice: FinishChoice; text: string }>;
  skipped: string[];
  /** Cards skipped on this deck in earlier Finishes, with the owner's reason: never offered again here. */
  skippedBefore: Array<{ name: string; why: string }>;
  /** The cards Claude searches this round: how many, and the deck's colours in words. */
  offer: { n: number; colours: string } | null;
  turns: FinishTurn[];
  /** This round's searches, as they run and once done. */
  searches: FinishSearch[];
  job: { status: 'running' | 'failed'; detail: string | null; error: string | null } | null;
  /** left: picks on Add that were no longer on offer when applied (the deck or the collection changed), so not added. */
  done: { at: string; added: number; lands: number; size: number; borrowed: string[]; left?: string[] } | null;
  /**
   * What a round costs. measured: the average of this app's real rounds (by round, not by call: a round is
   * several calls). Until there are enough, a guess that grows with the cards asked for (perCard).
   */
  cost: { first: RoundCost; later: RoundCost };
  noKey: boolean;
}

/** What a later list changed: cards that left (and which mark sent them), cards that came in, and Rethinks that came back. */
export interface FinishChanges {
  round: number;
  out: Array<{ name: string; because: 'skipped' | 'rethink' | 'message' | 'gone' }>;
  in: Array<{ name: string; group: string }>;
  back: string[];
}

const COLOUR_WORD: Record<string, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };
/** A deck's colours in words, in WUBRG order: "blue, black and red"; "colourless" for none. */
export function colourWords(identity: Iterable<string>): string {
  const w = [...'WUBRG'].filter((c) => [...identity].includes(c)).map((c) => COLOUR_WORD[c]);
  return !w.length ? 'colourless' : w.length === 1 ? w[0] : `${w.slice(0, -1).join(', ')} and ${w.at(-1)}`;
}

/** A kept row's comment that reads like a doubt ("kind of expensive for what it does"): offer Rethink. A plain rule, in code. */
export const soundsUnsure = (text: string) => /\b(not sure|unsure|maybe|kind of|kinda|sort of|meh|expensive|pricey|weak|not great|not sold|doubt|hmm+|iffy|idk|questionable|too slow|clunky)\b|\?\s*$/i.test(text.trim());

export interface RoundCost { usd: number; measured: boolean; base?: number; perCard?: number }

/** The price of a first list of `want` cards: the measured average, or the guess for that many. */
export const roundPrice = (c: RoundCost, want: number) => (c.measured || c.perCard === undefined ? c : { usd: (c.base ?? 0) + c.perCard * want, measured: false });

/**
 * Finish's rounds from the calls log, oldest first: a round starts with its first call ("finish: first list" or
 * "finish: later list") and takes the searches after it from the same profile and deck. Averaged when there
 * are at least `min` of a kind.
 */
export function measuredRounds(calls: Array<{ at: string; profileId: string; label: string; step: string; cost: number }>, min = 3): { first: number | null; later: number | null } {
  const rounds: Array<{ kind: 'first' | 'later'; key: string; cost: number }> = [];
  const open = new Map<string, { kind: 'first' | 'later'; key: string; cost: number }>();
  for (const c of [...calls].sort((a, b) => a.at.localeCompare(b.at))) {
    const key = `${c.profileId}|${c.label}`;
    if (c.step === 'finish: first list' || c.step === 'finish: later list') {
      const r = { kind: c.step === 'finish: first list' ? 'first' as const : 'later' as const, key, cost: c.cost };
      rounds.push(r);
      open.set(key, r);
    } else if (c.step === 'finish: search') {
      const r = open.get(key);
      if (r) r.cost += c.cost;
    }
  }
  const avg = (k: 'first' | 'later') => { const x = rounds.filter((r) => r.kind === k); return x.length >= min ? x.reduce((n, r) => n + r.cost, 0) / x.length : null; };
  return { first: avg('first'), later: avg('later') };
}

/** The rows on Add, the owner's taken cards included. */
export const chosenAdds = (items: Array<Pick<FinishItem, 'name'>>, choices: Record<string, { choice: FinishChoice }>) =>
  items.filter((i) => (choices[i.name]?.choice ?? 'add') === 'add').map((i) => i.name);
