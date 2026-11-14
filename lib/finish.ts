/**
 * Finish the deck from the owner's collection (handoff 8), as one
 * conversation per deck, the way Trim runs:
 *
 *   1. Code works out which of the owner's cards are on offer (finish-pool.ts:
 *      the copies setting, then Tune's checks). Claude never sees a card it
 *      may not pick.
 *   2. Claude is sent the commander, the confirmed plan, the cards already in
 *      the deck and how many non-land cards to pick, with one tool: a search
 *      over the cards on offer. No card list. Searches are counted and refused
 *      in code past the limit. When the plan says combos first or none, the
 *      combos the owner holds every piece of go with the request.
 *   3. Every pick is checked against the same pool and against what the
 *      searches returned; anything else is dropped and never shown. Short
 *      answers say how many short; nothing is padded.
 *   4. The owner marks each pick Add, Rethink or Skip and can say something;
 *      a later round keeps what is on Add, never offers a skipped card again,
 *      and refills only the slots that opened.
 *   5. Review and apply: a snapshot first, the picks and (on a full fill) the
 *      app's lands go in, and Undo puts every row back as it was.
 *
 * A card taken from another deck stays in that deck: applying only adds it
 * here (the owner's call), and the review warns that no spare copy is left.
 * Nothing crosses decks: the conversation is kept per deck. Server only.
 */

import { randomUUID } from 'node:crypto';

import type Anthropic from '@anthropic-ai/sdk';

import { ModelError } from './ai';
import type { ClaudeParams } from './ai-claude';
import { addCardToList, aiCalls, cardsInList, database, getSetting, setQuantity, setSetting, updateListCard, type CardBefore, type List } from './db';
import { planFor } from './deck-plan';
import { latestJob } from './jobs';
import { ownedCombos } from './finish-combos';
import { BASIC, dualCandidates, finishLands, finishPool, splitBasics, heldCards, isLand, nonbasicLimit, sourceOf, type Held, type LandPick, type Pool } from './finish-pool';
import { localCards } from './card-store';
import { checkNamed, ESSENTIALS_MAX, nameCards, withinTotal, type Named } from './essentials';
import {
  averageRounds, chosenAdds, colourWords, finishCount, FINISH_GROUPS, parseQuery, type MeasuredRound, SEARCH_LIMIT, SEARCH_LIMIT_LATER, searchLines, searchText,
  type Buy, type Copies, type FinishChanges, type FinishChoice, type FinishGroup, type FinishItem, type FinishMark, type FinishTurn, type FinishView, type OwnedCombo, type Source,
} from './finish-shared';
import { planContext } from './plan-context';
import { owner as planOwner } from './plan-help';
import { PROMPT_VERSIONS } from './prompt-versions';
import { imageOf, manaCostOf, oracleTextOf, typeLineOf, type ScryfallCard } from './scryfall';
import { combosInDeck } from './spellbook';
import { gcRoomOf, landPlan, tuneContext, whyNotAddable, type Context } from './tune';
import { cardsNamed } from './cards-named';

const front = (n: string) => n.split(' // ')[0].trim().toLowerCase();
const fmt = (x: number) => String(Math.round(x * 10) / 10);
/** Lands to add for the deck to hold `target` lands (a double-faced card counts as part of one, as the land number does). */
export const landsToAdd = (lp: { have: number }, target: number) => Math.max(0, Math.ceil(target - lp.have));
const keyOf = (c: ScryfallCard) => c.oracle_id ?? c.id;
const now = () => new Date().toISOString();
/** Names are joined with "; " for the model: many card names have commas in them. */
const NAMES = '; ';

// --- kept with the deck ---------------------------------------------------------------

interface StoredItem extends Omit<FinishItem, 'card'> { cardId: string; /** Named by Claude rather than searched (Part C): checked by name, not against the pool. */ named?: true }
interface StoredSearch { q: string; n: number; round: number; names: string[] }
interface Run {
  id: string; at: string; model: string; round: number; want: number; full: boolean; short: number; reply: string;
  items: StoredItem[]; dropped: number;
  /** The combos complete among the commander, the deck and every pick this round (the app's check). */
  combos: OwnedCombo[];
  owned: number | null; combosFailed: boolean;
  /** Lands in the deck when this fill is done (a full fill). */
  landsTarget?: number;
  /** A full fill (Part E): the nonbasic lands Claude chose, each with why, and the most it could choose. */
  landPicks?: StoredLand[];
  landsLimit?: number;
  /** A later round: what changed since the last list. */
  changes?: FinishChanges;
  /** Part C: how this list bought cards. */
  buy?: NonNullable<NonNullable<FinishView['run']>['buy']>;
}
interface StoredLand { name: string; why: string }
interface Done {
  at: string; added: number; lands: number; size: number; borrowed: string[];
  /** Picks on Add that were no longer on offer at apply time, so not added. */
  left?: string[];
  /** Cards to buy that went in (Part C), with their prices. */
  buy?: Array<{ name: string; price: number | null }>;
  /** Cards this apply added to the skipped-before list: Undo takes them off again (review 16). */
  remembered?: string[];
  /** Each row the apply touched, and how it was before. */
  undo: Array<{ cardId: string; before: CardBefore }>;
  session: Pick<FinishStore, 'run' | 'choices' | 'skipped' | 'turns' | 'searches' | 'seen'>;
}

export interface FinishStore {
  copies: Copies;
  /** Cards the owner would buy for this deck (Part C), and the most to spend on them in all (null: no limit). */
  buy: Buy;
  spend: number | null;
  /** The number asked for; null is a full fill. */
  want: number | null;
  /** Lands in the deck when a fill to 100 is done, the owner's number; null is the plan's land number. */
  lands: number | null;
  /** The owner's changes to the lands for this list: nonbasic lands left out, how many of each basic, and lands added with "+". */
  landPicks: { skip: string[]; basics: Record<string, number>; added?: string[]; /** The basics' room when the counts were typed. */ typedFor?: number };
  run: Run | null;
  choices: Record<string, { choice: FinishChoice; text: string }>;
  /** Never offered again in this conversation. */
  skipped: string[];
  /** Skipped on this deck in an earlier Finish, with the owner's reason: never offered again on this deck (D 14). */
  skippedBefore: Array<{ name: string; why: string }>;
  /** The cards Claude searches in the round running now or last run (D 10), the lands apart. */
  offer: { n: number; lands: number; colours: string } | null;
  /** Every name a search returned in this conversation: a pick must be one of them. */
  seen: string[];
  searches: StoredSearch[];
  turns: FinishTurn[];
  done: Done | null;
  /** The round running now, for its searches on the page. */
  pending: number | null;
}

const EMPTY: FinishStore = { copies: 'spare', buy: 'none', spend: null, want: null, lands: null, landPicks: { skip: [], basics: {} }, run: null, choices: {}, skipped: [], skippedBefore: [], offer: null, seen: [], searches: [], turns: [], done: null, pending: null };

let ready = false;
function db() {
  const d = database();
  if (!ready) {
    d.run(`CREATE TABLE IF NOT EXISTS deck_finish (listId TEXT PRIMARY KEY, state TEXT NOT NULL DEFAULT '{}', updatedAt TEXT NOT NULL)`);
    ready = true;
  }
  return d;
}

export function finishStore(listId: string): FinishStore {
  const r = db().get('SELECT state FROM deck_finish WHERE listId = ?', [listId]) as { state: string } | null;
  if (!r) return structuredClone(EMPTY);
  try { return { ...structuredClone(EMPTY), ...(JSON.parse(r.state) as Partial<FinishStore>) }; } catch { return structuredClone(EMPTY); }
}

function update(listId: string, change: (s: FinishStore) => void): FinishStore {
  const s = finishStore(listId);
  change(s);
  db().run(`INSERT INTO deck_finish (listId, state, updatedAt) VALUES (?, ?, ?)
    ON CONFLICT(listId) DO UPDATE SET state = excluded.state, updatedAt = excluded.updatedAt`, [listId, JSON.stringify(s), now()]);
  return s;
}

/**
 * What the owner skipped on this list, with the reason they typed, joins the deck's skipped-before list (D 14):
 * per deck, kept through Apply and Start over, so a later Finish on this deck never offers them again.
 */
function rememberSkips(s: FinishStore): void {
  if (!s.run) return;
  const have = new Set(s.skippedBefore.map((x) => front(x.name)));
  for (const i of s.run.items) {
    const c = s.choices[i.name];
    if (c?.choice !== 'skip') continue;
    const why = (c.text ?? '').trim().slice(0, 300);
    if (have.has(front(i.name))) { const x = s.skippedBefore.find((y) => front(y.name) === front(i.name))!; if (why) x.why = why; continue; }
    s.skippedBefore.push({ name: i.name, why });
    have.add(front(i.name));
  }
  s.skippedBefore = s.skippedBefore.slice(-300);
}

/** Take a card off the deck's skipped-before list: it may be offered again. */
export function unskip(listId: string, name: string): void {
  update(listId, (s) => { s.skippedBefore = s.skippedBefore.filter((x) => front(x.name) !== front(name)); });
}

/** Start over: the picks, the choices and the conversation go; the copies setting, the number and the skipped-before list stay. */
export function resetFinish(listId: string): void {
  update(listId, (s) => { rememberSkips(s); s.run = null; s.choices = {}; s.skipped = []; s.seen = []; s.searches = []; s.turns = []; s.done = null; s.landPicks = { skip: [], basics: {} }; });
}

/** The copies setting and the number, per deck. A new commander starts the conversation over. */
export function setFinish(listId: string, input: { copies?: unknown; want?: unknown; lands?: unknown; buy?: unknown; spend?: unknown }): void {
  update(listId, (s) => {
    if (input.copies === 'spare' || input.copies === 'any') s.copies = input.copies;
    if (input.buy === 'none' || input.buy === 'matter' || input.buy === 'any') s.buy = input.buy;
    if (input.spend === null) s.spend = null;
    else if (typeof input.spend === 'number' && Number.isFinite(input.spend) && input.spend >= 0) s.spend = Math.min(100_000, Math.round(input.spend * 100) / 100);
    if (input.lands === null) s.lands = null;
    else if (typeof input.lands === 'number' && Number.isFinite(input.lands) && input.lands >= 0) s.lands = Math.min(99, Math.round(input.lands));
    if (input.want === null) s.want = null;
    else if (typeof input.want === 'number' && Number.isFinite(input.want) && input.want >= 1) s.want = Math.min(500, Math.round(input.want));
  });
}

// --- the call --------------------------------------------------------------------------

export const FINISH_SYSTEM = `You help a Magic: The Gathering player finish their Commander deck from cards they own.
You get the deck's plan (each part with who set it), the cards already in the deck, and how many cards to pick. After the first list, you also get the conversation so far.

Find cards with the search tool. It searches only the owner's cards that may go in this deck: in its colours, legal, within the owner's budget, deck rule and bracket. Lands are searched apart: a search with t:land looks only at the owner's nonbasic lands; any other search never shows lands. Each land line ends with what it makes and how it enters, as words you can search: makes-blue (makes-white, makes-black, makes-red, makes-green, makes-colourless), untapped, enters-tapped, sometimes-tapped (untapped under a condition). For example "t:land makes-blue makes-red -enters-tapped". Words are matched in the name, type line and rules text, and all words must match; add t:<type>, mv<=N, mv>=N or mv=N to narrow, and -word or -t:<type> to leave cards out. Nothing else is understood (no colour or other filters): a word it can't use is ignored, and the result says so. Each search returns up to 40 cards with their rules text and the total count. Searches are limited; when none are left, give your picks.

Give your picks with give_picks, sorted into groups: ramp, draw (real card draw, not cantrips), interaction (removal, counterspells, board wipes), theme (name the theme), wins (ways to end the game), protection.
- Pick only cards a search returned, by their exact name. A card a search didn't return can't be used.
- No lands in the groups. When the task asks for lands, give them in "lands" only: the owner's nonbasic lands worth a slot, at most the number the task gives, each with one sentence why for this deck. Choose lands that fix the colours without slowing the deck (few that enter tapped), and lands that do something the plan wants. Say nothing about basics: the app decides how many lands go in, adds the basics and checks every colour has enough sources. A few searches with t:land are enough.
- Exactly the number of cards asked for, each once. If the searches truly can't fill it, give fewer and say so in the reply.
- Give every card one short sentence why, as a player would say it at the table, about this card in this deck.
- A line that ends "(in <deck>)" is a card the owner has only in another deck. Pick it only when it is clearly better than what their spare copies offer.
- Judge by the plan first and by what the owner wants. Think it through privately.
- Before giving picks, search by name for the well-known colourless staples (Sol Ring, Arcane Signet, Lightning Greaves and the like) and the commander's best-known partners: owned copies of those are easy to miss.
- Cards listed as already chosen are in the deck as far as you are concerned: build around them, and don't spend picks on weaker cards for the same job.

This is one conversation. On every list after the first:
- Cards the owner kept stay; don't pick them again.
- Never pick a card the owner skipped.
- When the owner asked you to rethink a card, weigh their reason: pick it again with a better argument, or pick something else, and say which in the reply.
- Where the owner said something, follow it, and apply their reasons to similar cards. If what they said means a kept card should go, name it in "out" and pick its replacement too.
- Reply in 2 to 4 sentences: what you changed and which of their words changed it.
- Lands: give "lands" again only when the owner's words are about the lands ("more utility lands", "no lands that enter tapped"); then give the whole new set. Otherwise leave it out and the lands stay as they are. Never pick a land the owner took out.
- Cards the owner skipped on this deck before are listed with their reasons: they are never on offer; apply those reasons to similar cards too.`;

export const FINISH_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'search',
    description: 'Search the owner\'s cards that may go in this deck. Words match the name, type line and rules text (all must match). t:<type> narrows by type and -t:<type> leaves a type out; mv<=N, mv>=N or mv=N by mana value; -word leaves out cards with that word. Returns up to 40 cards with rules text and the total count.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'e.g. "draw a card t:instant mv<=2" or "treasure -creature mv>=3"' } }, required: ['query'] },
  },
  {
    name: 'give_picks',
    description: 'Give the picks, in groups. Ends the turn.',
    input_schema: {
      type: 'object',
      properties: {
        groups: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              group: { type: 'string', enum: [...FINISH_GROUPS] },
              theme: { type: 'string', description: 'For the theme group: the theme in a few words.' },
              cards: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, why: { type: 'string' } }, required: ['name', 'why'] } },
            },
            required: ['group', 'cards'],
          },
        },
        lands: {
          type: 'array',
          description: 'Only when the task asks for lands: the owner\'s nonbasic lands worth a slot (from t:land searches), at most the number the task gives. No basics.',
          items: { type: 'object', properties: { name: { type: 'string' }, why: { type: 'string' } }, required: ['name', 'why'] },
        },
        reply: { type: 'string', description: 'First list: one or two sentences on the build. Later lists: 2 to 4 sentences on what changed and why.' },
        out: { type: 'array', items: { type: 'string' }, description: 'Later lists only: kept picks the owner\'s words say should go. Leave empty otherwise.' },
      },
      required: ['groups', 'reply'],
    },
  },
];

const quote = (t: string) => `"${t.replace(/\s+/g, ' ').trim()}"`;

/** The conversation so far, oldest first, in plain lines; nothing before the first list. */
export function sessionLines(turns: FinishTurn[]): string[] {
  if (!turns.some((t) => t.kind === 'claude-picks')) return [];
  const out = ['', '## This conversation so far'];
  for (const t of turns) {
    if (t.kind === 'owner-start') out.push(`Owner, at the start: asked for ${t.want} cards, ${t.copies === 'spare' ? 'spare copies only' : 'cards from other decks allowed'}.`);
    else if (t.kind === 'claude-picks') out.push(`You, list ${t.round}: ${t.picks.length} picks${t.short ? `, ${t.short} short` : ''}: ${t.picks.join(NAMES)}.${t.reply ? ` You said: ${quote(t.reply)}` : ''}`);
    else {
      const why = (m: FinishMark) => (m.text.trim() ? ` (${quote(m.text)})` : '');
      const parts = [
        ...t.marks.filter((m) => m.choice === 'ask').map((m) => `asked you to rethink ${m.name}${why(m) || ' (no reason given)'}`),
        ...t.marks.filter((m) => m.choice === 'skip').map((m) => `skipped ${m.name}${why(m)}`),
        ...t.marks.filter((m) => m.choice === 'add' && m.text.trim()).map((m) => `kept ${m.name}${why(m)}`),
        ...(t.taken.length ? [`took from your searches themselves: ${t.taken.join(NAMES)}`] : []),
        ...(t.message.trim() ? [`said: ${quote(t.message)}`] : []),
      ];
      out.push(`Owner: ${parts.length ? parts.join('; ') : 'asked for the list again'}.`);
    }
  }
  return out;
}

/** The combos block, only when the plan says combos first or none. */
export function combosLines(mode: 'first' | 'none' | null, combos: OwnedCombo[] | null): string[] {
  if (!mode || !combos?.length) return [];
  return [
    '',
    `## Combos the owner owns every piece of (found by the app; a piece may already be in the deck)`,
    ...combos.slice(0, 60).map((c) => `- ${c.cards.join(' + ')} => ${c.produces.slice(0, 3).join(', ')}`),
    mode === 'first'
      ? 'The plan says combos first: build in complete combos the owner owns before anything else.'
      : 'The plan says no combos: never put every piece of one of these in the deck. Leave at least one piece of each out.',
  ];
}

/** Claude's picks, kept to what may go in: in the pool, returned by a search, not skipped, not already listed or in the deck, within the bracket's room. */
export function checkPicks(data: unknown, input: { pool: Pick<Pool, 'cards'>; seen: Set<string>; skipped: Set<string>; taken: Set<string>; need: number; gcRoom: number | null }): {
  picks: Array<{ card: ScryfallCard; group: FinishGroup; theme?: string; why: string }>; dropped: number; short: number; reply: string; out: string[];
} {
  const d = (data ?? {}) as { groups?: unknown; reply?: unknown; out?: unknown };
  const groups = (Array.isArray(d.groups) ? d.groups : []) as Array<{ group?: unknown; theme?: unknown; cards?: unknown }>;
  const picks: Array<{ card: ScryfallCard; group: FinishGroup; theme?: string; why: string }> = [];
  const used = new Set(input.taken);
  let dropped = 0;
  let gcs = 0;
  for (const g of groups) {
    const group = (FINISH_GROUPS as readonly string[]).includes(String(g.group)) ? g.group as FinishGroup : 'theme';
    const theme = group === 'theme' && typeof g.theme === 'string' && g.theme.trim() ? g.theme.trim().slice(0, 40) : undefined;
    for (const c of (Array.isArray(g.cards) ? g.cards : []) as Array<{ name?: unknown; why?: unknown }>) {
      const name = String(c.name ?? '').trim();
      const card = input.pool.cards.get(name.toLowerCase()) ?? input.pool.cards.get(front(name));
      const k = card ? front(card.name) : front(name);
      if (!card || isLand(card) || !input.seen.has(k) || input.skipped.has(k) || used.has(k)) { dropped += 1; continue; }
      if (picks.length >= input.need) continue;
      if (card.game_changer && input.gcRoom !== null) { if (gcs >= input.gcRoom) { dropped += 1; continue; } gcs += 1; }
      used.add(k);
      picks.push({ card, group, ...(theme ? { theme } : {}), why: String(c.why ?? '').trim().slice(0, 300) || 'Claude’s pick' });
    }
  }
  const out = (Array.isArray(d.out) ? d.out : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 60);
  return { picks, dropped, short: Math.max(0, input.need - picks.length), reply: typeof d.reply === 'string' ? d.reply.trim().slice(0, 1200) : '', out };
}

const toItem = (card: ScryfallCard, held: Held | undefined, copies: Copies, rest: Omit<StoredItem, 'name' | 'cardId' | 'src' | 'deck' | 'section'>): StoredItem => {
  const s: { src: Source; deck?: string; section?: string } = (held && sourceOf(held, copies)) ?? { src: 'spare' };
  return { name: card.name, cardId: card.id, src: s.src, ...(s.deck ? { deck: s.deck } : {}), ...(s.section ? { section: s.section } : {}), ...rest };
};

/** A card Claude named (Part C) as a row: where the copy is comes from the app's check, never the model. */
const namedItem = (p: Named, mark: StoredItem['mark'], themeNow: string): StoredItem => ({
  name: p.card.name, cardId: p.card.id, named: true, group: p.group, ...(p.group === 'theme' && (themeNow || p.theme) ? { theme: themeNow || p.theme } : {}), why: p.why, mark,
  ...(p.own.kind === 'buy' ? { src: 'buy' as const, price: p.own.price } : p.own.kind === 'spare' ? { src: 'spare' as const } : p.own.kind === 'section' ? { src: 'maybe' as const, section: p.own.section } : { src: 'other' as const, deck: p.own.deck }),
});

/** The combos complete among the commander, the deck and these picks: one lookup, failing soft. */
async function combosFound(ctx: Context, picks: string[]): Promise<OwnedCombo[] | null> {
  if (!ctx.list.commander) return [];
  try {
    const { included } = await combosInDeck({ commanders: ctx.commanders.map((c) => c.name), main: [...ctx.main.filter((c) => !ctx.commanders.includes(c.card)).map((c) => c.card.name), ...picks].map((name) => ({ name, quantity: 1 })) });
    return included.map((c) => ({ id: c.id, cards: c.cards, produces: c.produces.slice(0, 4) }));
  } catch { return null; }
}

export type Call = (params: ClaudeParams, step: string) => Promise<Anthropic.Beta.BetaMessage>;

/**
 * One round: the first list, or (`rerun`) the owner's answer and the slots it
 * opened. The searches are written to the store as they run, for the page.
 */
export async function runFinish(call: Call, model: string, list: List, profileId: string, opts: { rerun?: boolean; message?: string } = {}, progress: (s: string) => void = () => {}): Promise<{ runId: string; picks: number }> {
  progress('Working out which of your cards may go in');
  const before = finishStore(list.id);
  const rerun = !!opts.rerun && !!before.run;
  // This list's skips join the deck's skipped-before list now, so they are left out of every later Finish too. Only
  // these are written back at the end, so a card taken off the list while the round runs stays off (review 17).
  const hadSkips = new Set(before.skippedBefore.map((x) => front(x.name)));
  if (rerun) rememberSkips(before);
  const newSkips = before.skippedBefore.filter((x) => !hadSkips.has(front(x.name)));
  const ctx = await tuneContext(list, profileId);
  if (!list.commander) throw new ModelError('Set the commander first: the cards on offer follow its colours.');
  const held = heldCards(profileId, list.id);
  // Skipped on this deck before, and lands the owner took out this conversation: never on offer.
  const leaveOut = new Set([...before.skippedBefore.map((x) => front(x.name)), ...(rerun ? before.landPicks.skip.map(front) : [])]);
  const pool = finishPool(ctx, before.copies, held, { leaveOut });
  // A profile whose cards can't go in at all (none held, or none that fit) gets "any card" (Part C, item 31).
  const buyMode: Buy = before.buy === 'none' && pool.counts.any === 0 ? 'any' : before.buy;
  if (!pool.lines.length && buyMode === 'none') throw new ModelError('None of your cards can go in this deck under these settings. Try “Take from other decks too”, or “Cards you’d buy: Any card”, or check the budget and deck rule on the Plan tab.');
  const lp = landPlan(ctx);
  const landsTarget = before.lands ?? lp.range[0];
  const count = finishCount(ctx.size, landsToAdd(lp, landsTarget), before.want);
  const at = now();
  const round = rerun ? before.run!.round + 1 : 1;
  // Part E: on a full fill Claude also chooses which of the owner's nonbasic lands are worth a slot, up to a limit.
  // "Any card" has no search, so the app picks the owner's lands that fix the colours, and basics (Part C, item 36).
  const landLimit = count.full && buyMode !== 'any' ? Math.min(count.lands, nonbasicLimit(ctx, landsTarget)) : 0;
  const askLands = landLimit > 0 && pool.lands.lines.length > 0;
  const prevLands = rerun ? (before.run!.landPicks ?? []).filter((l) => !before.landPicks.skip.some((x) => front(x) === front(l.name))) : [];
  // A run stored before Claude chose lands (review 12): its next round asks for them as a first list would.
  const legacyLands = rerun && before.run!.full && before.run!.landPicks === undefined && buyMode !== 'any';

  // What the owner's answer changes: the picks on Add stay, the rest open their slots.
  let turns: FinishTurn[];
  let kept: StoredItem[] = [];
  let skipped = new Set(rerun ? before.skipped.map(front) : []);
  let reply: Extract<FinishTurn, { kind: 'owner-reply' }> | null = null;
  if (!rerun) turns = [{ kind: 'owner-start', want: count.want, copies: before.copies, ...(buyMode !== 'none' ? { buy: buyMode } : {}), at }];
  else {
    const items = before.run!.items;
    const choiceOf = (n: string) => before.choices[n]?.choice ?? 'add';
    const marks: FinishMark[] = items.filter((i) => choiceOf(i.name) !== 'add' || before.choices[i.name]?.text?.trim())
      .map((i) => ({ name: i.name, choice: choiceOf(i.name), text: (before.choices[i.name]?.text ?? '').trim().slice(0, 300) }));
    reply = { kind: 'owner-reply', marks, message: (opts.message ?? '').trim().slice(0, 1500), taken: items.filter((i) => i.mark === 'yours' && choiceOf(i.name) === 'add').map((i) => i.name), at };
    turns = [...before.turns, reply];
    kept = items.filter((i) => choiceOf(i.name) === 'add').map((i) => ({ ...i, mark: i.mark === 'yours' ? 'yours' : null }));
    for (const i of items) if (choiceOf(i.name) === 'skip') skipped.add(front(i.name));
  }
  // The pool may have changed since (the deck, the setting): what is no longer on offer opens its slot too. A card
  // named rather than searched (to buy, or owned outside the copies setting) stays while Tune's checks pass.
  const named = (i: StoredItem) => i.src === 'buy' || !!i.named;
  const nameChecks = new Map([...cardsNamed(kept.filter(named).map((i) => i.name))].map(([k, c]) => [k, !whyNotAddable(ctx, c)]));
  kept = kept.filter((i) => !named(i) || nameChecks.get(front(i.name)) === true);
  skipped = new Set([...skipped].filter(Boolean));
  const need = Math.max(0, count.want - kept.length);
  if (rerun && !need && !reply?.message) throw new ModelError('Nothing to change: every pick is on Add. Mark a card Rethink or Skip, or say something.');

  // Combos: only when the plan says so.
  const mode = planFor(list.id, '', list.commander, ctx.main).goal.combos ?? null;
  let owned: OwnedCombo[] | null = null;
  let combosFailed = false;
  if (mode) {
    progress('Looking up the combos you own');
    // The lookup is keyed on what the owner holds in the colours, not on what is in this deck, so an apply (picks and
    // lands move from the holdings into the deck) does not throw the kept answer away. Then kept to what may go in now.
    const holdings = [...held.values()].filter((h) => (h.card.color_identity ?? []).every((x) => ctx.identity.has(x)) && h.card.legalities?.commander === 'legal').map((h) => h.card.name);
    try {
      const all = await ownedCombos(profileId, list.commander.name, [...holdings, ...ctx.main.map((c) => c.card.name)]);
      const usable = new Set([...pool.lines.map((l) => l.name), ...ctx.main.map((c) => c.card.name), ...ctx.commanders.map((c) => c.name)].map(front));
      owned = all.filter((c) => c.cards.every((n) => usable.has(front(n))));
    } catch { combosFailed = true; }
  }

  const limit = round === 1 ? SEARCH_LIMIT : SEARCH_LIMIT_LATER;
  const deck = [
    `Commander: ${list.commander.name} ${manaCostOf(list.commander)} - ${typeLineOf(list.commander)}: ${oracleTextOf(list.commander).replace(/\n+/g, ' | ')}`,
    '',
    await planContext(list).catch(() => ''),
    '',
    ctx.main.length ? `Already in the deck (${ctx.main.reduce((n, c) => n + c.quantity, 0)}): ${ctx.main.map((c) => c.card.name).join(NAMES)}` : 'Nothing else is in the deck yet.',
    ...combosLines(mode, owned),
    ...(before.skippedBefore.length ? ['', `## Skipped on this deck before, with the owner's reasons (never on offer; apply the reasons to similar cards)`, ...before.skippedBefore.map((x) => `- ${x.name}${x.why ? `: ${quote(x.why)}` : ''}`)] : []),
  ].join('\n');
  const landTask = !askLands ? '' : rerun && !legacyLands
    ? (prevLands.length ? ` The lands Claude chose stay unless the owner's words are about the lands: ${prevLands.map((l) => l.name).join(NAMES)}. If they are, give "lands" again, at most ${landLimit}.` : '')
    : ` Also choose up to ${landLimit} of the owner's nonbasic lands worth a slot, in "lands" (search with t:land; ${pool.lands.lines.length} are on offer). The app adds the basics for the rest.`;
  // The list's theme group, when it has one: a later round keeps it rather than opening a second.
  const themeNow = rerun ? before.run!.items.find((i) => i.group === 'theme' && i.theme)?.theme ?? '' : '';

  // Part C: cards to buy. "The ones that matter": Claude names the essentials first (no search), the app checks
  // each and marks it owned or to buy, takes the ones to buy up to the total, and the search then fills the rest
  // around them. "Any card": Claude names the whole list and nothing is searched. On a later round, the slots that
  // a card to buy left (Rethink, Skip) are named again, so it can come back as an owned card or another to buy.
  let chosen: StoredItem[] = [];
  let buyInfo: Run['buy'] | undefined;
  let buyReply = '';
  const openedBuy = rerun ? before.run!.items.filter((i) => i.src === 'buy' && (before.choices[i.name]?.choice ?? 'add') !== 'add').length : 0;
  const buySlots = buyMode === 'any' ? need : buyMode === 'matter' ? Math.min(need, rerun ? openedBuy : Math.min(ESSENTIALS_MAX, count.want)) : 0;
  if (buySlots > 0) {
    progress(buyMode === 'any' ? `Claude is naming ${buySlots} cards` : 'Claude is naming the cards that matter');
    const leave = new Set([...leaveOut, ...skipped]);
    const named = await nameCards(call, model, ctx, list, {
      kind: buyMode === 'any' ? 'all' : 'matter', count: buySlots, skipped: before.skippedBefore,
      chosen: kept.map((i) => i.name), extra: rerun ? [...sessionLines(turns), ...(skipped.size ? ['', `## Skipped by the owner: never name these\n${[...before.skipped, ...(reply?.marks ?? []).filter((m) => m.choice === 'skip').map((m) => m.name)].join(NAMES)}`] : [])] : [],
    });
    const checkedNames = checkNamed(ctx, held, named.raw, { need: buySlots, taken: new Set(kept.map((i) => front(i.name))), leaveOut: leave });
    const spentKept = kept.reduce((n, i) => n + (i.src === 'buy' ? i.price ?? 0 : 0), 0);
    const { taken, over } = withinTotal(checkedNames.picks, before.spend === null ? null : Math.max(0, before.spend - spentKept));
    const asked0 = new Set((reply?.marks ?? []).filter((m) => m.choice === 'ask').map((m) => front(m.name)));
    chosen = taken.map((p) => namedItem(p, rerun ? (asked0.has(front(p.card.name)) ? 'back' : 'new') : null, themeNow));
    buyInfo = { kind: buyMode, limit: before.spend, over: over.map((p) => ({ name: p.card.name, price: p.own.kind === 'buy' ? p.own.price : null })), dropped: checkedNames.dropped };
    buyReply = named.reply;
  } else if (buyMode !== 'none') buyInfo = { kind: buyMode, limit: before.spend, over: rerun ? before.run!.buy?.over ?? [] : [], dropped: [] };
  const searchNeed = Math.max(0, need - chosen.length);
  // A message may take kept picks out ("out") even when no slot is open, so a later round with words always asks.
  const searching = buyMode !== 'any' && (searchNeed > 0 || !!reply?.message || (askLands && (!rerun || legacyLands)));
  const task = [
    ...sessionLines(turns),
    ...(rerun ? [
      '',
      kept.length ? `## Kept (they stay; don't pick them again)\n${kept.map((i) => i.name).join(NAMES)}` : '## Kept\nNothing.',
      ...(themeNow ? ['', `## The theme group is "${themeNow}": give theme picks under exactly that name.`] : []),
      ...(skipped.size ? ['', `## Skipped by the owner: never pick these\n${[...before.skipped, ...(reply?.marks ?? []).filter((m) => m.choice === 'skip').map((m) => m.name)].filter((n, i, a) => a.indexOf(n) === i).join(NAMES)}`] : []),
    ] : []),
    '',
    '## The task',
    ...(chosen.length ? ['', `## Already chosen (count them as in the deck; don't pick them again)\n${chosen.map((i) => i.name).join(NAMES)}`] : []),
    rerun
      ? `This is list ${round}. Pick exactly ${searchNeed} more non-land card${need === 1 ? '' : 's'} for the slots that opened${reply?.message ? ' (and the replacements for any you name in "out")' : ''}, in groups. No lands in the groups.${landTask} You have ${limit} searches.`
      : `Pick exactly ${searchNeed} non-land cards, in groups. No lands in the groups${count.full ? `: the app adds ${count.lands} lands to bring the deck to 100, so it will hold ${landsTarget} lands when done (${before.lands !== null ? 'the number the owner chose' : "the plan's land number"}). Weigh ramp and mana costs with that in mind` : ''}.${landTask} You have ${limit} searches.`,
  ].join('\n').trim();

  const offer = { n: pool.lines.length, lands: askLands ? pool.lands.lines.length : 0, colours: colourWords(ctx.identity) };
  update(list.id, (s) => { if (!rerun) { s.searches = []; s.seen = []; } s.done = null; s.pending = round; s.offer = offer; });
  if (searching) progress(rerun ? `Claude is reading your answer (list ${round})` : `Claude is searching your cards (${searchNeed} to find)`);

  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: task }];
  let used = 0;
  let answer: unknown = searching ? null : { groups: [], reply: buyReply };
  const seen = new Set(rerun ? before.seen.map(front) : []);
  for (let step = 0; searching && step < limit + 6 && answer === null; step++) {
    const message = await call({
      model,
      max_tokens: 16_000,
      system: [{ type: 'text', text: FINISH_SYSTEM }, { type: 'text', text: deck, cache_control: { type: 'ephemeral' } }],
      thinking: { type: 'adaptive' },
      tools: FINISH_TOOLS,
      messages,
    } as ClaudeParams, step === 0 ? `finish: ${round === 1 ? 'first list' : 'later list'}` : 'finish: search');
    const uses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    const pick = uses.find((u) => u.name === 'give_picks');
    if (pick) { answer = pick.input; break; }
    if (message.stop_reason !== 'tool_use' || !uses.length) {
      // No picks given: read a JSON answer from the text if there is one.
      const text = message.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n');
      const m = text.match(/\{[\s\S]*"groups"[\s\S]*\}/);
      if (m) { try { answer = JSON.parse(m[0]); } catch { /* not JSON */ } }
      break;
    }
    messages.push({ role: 'assistant', content: message.content as Anthropic.Beta.BetaContentBlockParam[] });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of uses) {
      const q = String((use.input as { query?: unknown })?.query ?? '').trim().slice(0, 200);
      if (use.name !== 'search') { results.push({ type: 'tool_result', tool_use_id: use.id, content: 'Unknown tool.', is_error: true }); continue; }
      if (used >= limit) { results.push({ type: 'tool_result', tool_use_id: use.id, content: 'No searches left, give your picks now.' }); continue; }
      // t:land searches the owner's nonbasic lands, and only when lands are asked for; nothing else ever shows a land.
      const landAsk = parseQuery(q).types.some((t) => t.startsWith('land'));
      if (landAsk && !askLands) { results.push({ type: 'tool_result', tool_use_id: use.id, content: 'Lands aren\'t part of this ask: the app chooses them. That search wasn\'t counted.' }); continue; }
      used += 1;
      const r = searchLines(landAsk ? pool.lands.lines : pool.lines, q);
      for (const l of r.lines) seen.add(front(l.name));
      const names = r.lines.map((l) => l.name);
      update(list.id, (s) => { s.searches.push({ q, n: r.total, round, names }); s.seen = [...new Set([...s.seen, ...names])]; });
      progress(`Search ${used} of ${limit}: ${q}`);
      results.push({ type: 'tool_result', tool_use_id: use.id, content: searchText(r) + (used >= limit ? '\n\nThat was your last search: give your picks now.' : '') });
    }
    // Every call re-sends the searches so far. Mark the newest result (and only it) as the cache point, so the next
    // call reads everything before it from the cache instead of paying for it again.
    for (const m of messages) if (m.role === 'user' && Array.isArray(m.content)) for (const b of m.content) delete (b as { cache_control?: unknown }).cache_control;
    if (results.length) results[results.length - 1] = { ...results[results.length - 1], cache_control: { type: 'ephemeral' } };
    messages.push({ role: 'user', content: results });
  }
  if (answer === null) throw new ModelError('Claude didn’t give its picks. Nothing was changed; try again.');

  // The owner's words may take kept picks out ("out"); only Claude's own picks, never one the owner took.
  const outs = rerun && reply?.message ? new Set(checkOut(answer, kept)) : new Set<string>();
  kept = kept.filter((i) => !outs.has(i.name));
  const need2 = Math.max(0, count.want - kept.length - chosen.length);
  const checked = checkPicks(answer, {
    pool, seen, skipped, taken: new Set([...kept, ...chosen].map((i) => front(i.name))), need: need2,
    gcRoom: (() => { const r = gcRoomOf(ctx); return r === null ? null : Math.max(0, r - kept.filter((i) => pool.cards.get(i.name.toLowerCase())?.game_changer).length); })(),
  });
  if (!checked.picks.length && !kept.length && !chosen.length) throw new ModelError(`None of Claude’s ${checked.dropped} picks could be used (not among your cards on offer, or not from its searches). Nothing was saved; try again.`);
  // A card the owner asked Claude to rethink that it picked again comes back with a new reason (D 15).
  const asked = new Set([...(rerun ? (reply?.marks ?? []).filter((m) => m.choice === 'ask').map((m) => front(m.name)) : []), ...[...outs].map(front)]);
  // A later round's theme picks go in the list's theme group, whatever name the model gave them (real runs, item 4).
  const fresh = checked.picks.map((p) => toItem(p.card, held.get(keyOf(p.card)), before.copies, { group: p.group, ...(p.group === 'theme' && (themeNow || p.theme) ? { theme: themeNow || p.theme } : {}), why: p.why, mark: rerun ? (asked.has(front(p.card.name)) ? 'back' : 'new') : null }));
  const items = [...kept, ...chosen, ...fresh];
  // Lands (Part E): Claude's picks, checked like the others and cut to the limit; on a later list they stay unless given again.
  const given = (answer as { lands?: unknown }).lands;
  const landPicks: StoredLand[] | undefined = !askLands ? undefined
    : Array.isArray(given) && (!rerun || legacyLands || given.length) ? checkLands(given, pool, seen, landLimit)
      : legacyLands ? undefined : rerun ? prevLands : [];
  // A new set of lands starts the owner's land changes over: the basics typed for the old set don't carry (review 11).
  // Compared as sets: the same lands in another order are no change (round 2, item 2).
  const setOf = (ls: StoredLand[]) => new Set(ls.map((l) => front(l.name)));
  const landsOut = rerun && landPicks ? prevLands.filter((l) => !setOf(landPicks).has(front(l.name))).map((l) => l.name) : [];
  const landsIn = rerun && landPicks ? landPicks.filter((l) => !setOf(prevLands).has(front(l.name))).map((l) => l.name) : [];
  // What changed since the last list, by the app from the two lists, not from Claude's reply.
  let changes: FinishChanges | undefined;
  if (rerun) {
    const now2 = new Set(items.map((i) => front(i.name)));
    const was = new Set(before.run!.items.map((i) => front(i.name)));
    const because = (n: string): FinishChanges['out'][number]['because'] => {
      const c = before.choices[n]?.choice ?? 'add';
      return c === 'skip' ? 'skipped' : c === 'ask' ? 'rethink' : outs.has(n) ? 'message' : 'gone';
    };
    changes = {
      round,
      out: before.run!.items.filter((i) => !now2.has(front(i.name))).map((i) => ({ name: i.name, because: because(i.name) })),
      in: [...chosen, ...fresh].filter((i) => !was.has(front(i.name))).map((i) => ({ name: i.name, group: i.group === 'theme' && i.theme ? `theme:${i.theme}` : i.group })),
      back: [...chosen, ...fresh].filter((i) => i.mark === 'back').map((i) => i.name),
      ...(landsIn.length || landsOut.length ? { lands: { in: landsIn, out: landsOut } } : {}),
    };
  }
  const found = await combosFound(ctx, items.map((i) => i.name));
  const run: Run = {
    id: randomUUID(), at: now(), model, round, want: count.want, full: count.full, short: Math.max(0, count.want - items.length), reply: checked.reply || buyReply,
    items, dropped: checked.dropped, combos: found ?? [], owned: owned?.length ?? null, combosFailed: combosFailed || found === null, ...(count.full ? { landsTarget } : {}),
    ...(landPicks ? { landPicks, landsLimit: landLimit } : {}), ...(changes ? { changes } : {}), ...(buyInfo ? { buy: buyInfo } : {}),
  };
  update(list.id, (s) => {
    s.run = run;
    s.choices = {};
    s.skippedBefore = [...s.skippedBefore, ...newSkips.filter((x) => !s.skippedBefore.some((y) => front(y.name) === front(x.name)))];
    if (!rerun) s.landPicks = { skip: [], basics: {}, added: [] };
    s.skipped = rerun ? [...new Set([...before.skipped, ...(reply?.marks ?? []).filter((m) => m.choice === 'skip').map((m) => m.name)])] : [];
    s.turns = [...turns, { kind: 'claude-picks', round, picks: items.map((i) => i.name), short: run.short, searches: used, reply: run.reply, at: run.at }];
    s.done = null;
    s.pending = null;
  });
  recordRound(round === 1 ? 'first' : 'later', at, profileId, list.name);
  return { runId: run.id, picks: items.length };
}

/** Claude's land picks: the owner's nonbasic lands on offer that a search returned, once each, cut to the limit. */
export function checkLands(given: unknown[], pool: Pick<Pool, 'lands'>, seen: Set<string>, limit: number): StoredLand[] {
  const out: StoredLand[] = [];
  for (const g of given as Array<{ name?: unknown; why?: unknown }>) {
    const card = pool.lands.cards.get(String(g?.name ?? '').trim().toLowerCase()) ?? pool.lands.cards.get(front(String(g?.name ?? '')));
    if (!card || !seen.has(front(card.name)) || out.some((l) => front(l.name) === front(card.name))) continue;
    if (out.length >= limit) break;
    out.push({ name: card.name, why: String(g.why ?? '').trim().slice(0, 300) || 'Claude’s pick' });
  }
  return out;
}

const checkOut = (answer: unknown, kept: StoredItem[]): string[] => {
  const out = ((answer as { out?: unknown })?.out ?? []) as unknown[];
  const names = new Set((Array.isArray(out) ? out : []).map((n) => front(String(n))));
  return kept.filter((i) => i.mark !== 'yours' && names.has(front(i.name))).map((i) => i.name);
};

// --- the owner's side ----------------------------------------------------------------------

/** The owner's choices on the list, replaced whole (the page sends them as they change). */
export function setChoices(listId: string, choices: unknown): void {
  const s = finishStore(listId);
  if (!s.run) return;
  const names = new Set(s.run.items.map((i) => i.name));
  const next: FinishStore['choices'] = {};
  for (const [name, v] of Object.entries((choices ?? {}) as Record<string, unknown>).slice(0, 300)) {
    const c = v as { choice?: unknown; text?: unknown } | null;
    if (!names.has(name) || !c || (c.choice !== 'add' && c.choice !== 'ask' && c.choice !== 'skip')) continue;
    const text = typeof c.text === 'string' ? c.text.slice(0, 300) : '';
    if (c.choice === 'add' && !text.trim()) continue;
    next[name] = { choice: c.choice, text };
  }
  update(listId, (x) => { x.choices = next; });
}

/** "+": take a card from a search's results without a paid round. It must be on offer, and not skipped or listed. */
export async function takeCard(list: List, profileId: string, name: string, group: string): Promise<void> {
  const s = finishStore(list.id);
  if (!s.run) throw new Error('There are no picks to add to');
  if (s.run.items.some((i) => front(i.name) === front(name))) return;
  if (!s.seen.some((n) => front(n) === front(name))) throw new Error(`${name} wasn't in a search's results`);
  const ctx = await tuneContext(list, profileId);
  const held = heldCards(profileId, list.id);
  const pool = finishPool(ctx, s.copies, held);
  const card = pool.cards.get(name.toLowerCase()) ?? pool.cards.get(front(name));
  if (!card) throw new Error(`${name} can't go in this deck under these settings`);
  const g = (FINISH_GROUPS as readonly string[]).includes(group) ? group as FinishGroup : 'theme';
  const theme = s.run.items.find((i) => i.group === g && i.theme)?.theme;
  const item = toItem(card, held.get(keyOf(card)), s.copies, { group: g, ...(theme ? { theme } : {}), why: 'You took it from the search results.', mark: 'yours' });
  const found = await combosFound(ctx, [...s.run.items.map((i) => i.name), card.name]);
  update(list.id, (x) => {
    if (!x.run) return;
    x.run.items.push(item);
    x.skipped = x.skipped.filter((n) => front(n) !== front(card.name));
    x.skippedBefore = x.skippedBefore.filter((n) => front(n.name) !== front(card.name));
    if (found) x.run.combos = found;
  });
}

/**
 * The lands for a fill to 100, and the owner's changes to them (Part E). The nonbasic lands are Claude's picks
 * (or, for a run from before Part E, the colour-fixing lands by how many colours they make) plus any the owner
 * added with "+"; a land unticked gives its slot back to a basic, so the land number never changes. Basics are
 * split by basicsFor, counting what the ticked lands make; the owner may set any basic's count, and every
 * colour's basic is offered, at 0 when the split gave it none.
 */
export function landsFor(ctx: Context, held: Map<string, Held>, s: Pick<FinishStore, 'copies' | 'lands' | 'landPicks' | 'run'>, lp: { have: number; range: [number, number] }, adds: number, costs: string[]): {
  suggested: LandPick[]; chosen: LandPick[]; short: Array<{ colour: string; have: number; want: number }>; byClaude: boolean;
  /** The slots the basics fill: the land number less the nonbasic lands that are on. */
  room: number;
} {
  const target = s.run?.landsTarget ?? s.lands ?? lp.range[0];
  const n = Math.max(0, Math.min(100 - ctx.size - adds, landsToAdd(lp, target)));
  const picks = { skip: s.landPicks?.skip ?? [], basics: s.landPicks?.basics ?? {}, added: s.landPicks?.added ?? [] };
  const isBasic = (c: ScryfallCard) => /\bBasic\b/.test(c.type_line ?? '');
  const byName = new Map([...held.values()].map((h) => [front(h.card.name), h]));
  const asPick = (l: StoredLand): LandPick | null => {
    const h = byName.get(front(l.name));
    return h ? { card: h.card, n: 1, ...(sourceOf(h, s.copies) ?? { src: 'spare' as Source }), why: l.why } : null;
  };
  const byClaude = !!s.run?.landPicks;
  const added = picks.added.map((name) => asPick({ name, why: 'You added it.' })).filter((l): l is LandPick => !!l);
  const all = [...(byClaude ? s.run!.landPicks!.map(asPick).filter((l): l is LandPick => !!l) : dualCandidates(ctx, held, s.copies, n)), ...added]
    .filter((l, k, a) => a.findIndex((x) => front(x.card.name) === front(l.card.name)) === k);
  const on = all.filter((l) => !picks.skip.includes(l.card.name)).slice(0, n);
  const { lands, short } = finishLands(ctx, held, s.copies, n, costs, on);
  const basics = new Map(lands.filter((l) => isBasic(l.card)).map((l) => [l.card.name, l]));
  const more = localCards([...ctx.identity].map((c) => BASIC[c]).filter((b) => b && !basics.has(b)));
  for (const c of more) basics.set(c.name, { card: ctx.main.find((x) => x.card.name === c.name)?.card ?? c, n: 0, src: 'spare' });
  // The owner's typed counts stay as typed; the basics they didn't type take up the rest, so the land number holds
  // when a land is unticked or a pick skipped afterwards (review 11). With every basic typed, the largest one moves.
  const auto = [...basics.values()];
  const typed = auto.filter((l) => picks.basics[l.card.name] !== undefined);
  const counts = new Map(auto.map((l) => [l.card.name, picks.basics[l.card.name] ?? l.n]));
  if (typed.length) {
    const left = n - on.length - typed.reduce((k, l) => k + picks.basics[l.card.name], 0);
    const free = auto.filter((l) => picks.basics[l.card.name] === undefined);
    if (free.length) {
      const split = splitBasics(Math.max(0, left), Object.fromEntries(free.map((l) => [l.card.name, l.n + 0.01])));
      for (const l of free) counts.set(l.card.name, split[l.card.name] ?? 0);
    } else if (s.landPicks?.typedFor !== undefined) {
      // Every basic typed: the numbers stand as typed, and a later change (a land unticked, a pick skipped) moves the
      // largest by what the basics' room changed since.
      const big = [...typed].sort((a, b) => picks.basics[b.card.name] - picks.basics[a.card.name])[0];
      counts.set(big.card.name, Math.max(0, picks.basics[big.card.name] + (n - on.length) - s.landPicks.typedFor));
    }
  }
  const chosen = [...on, ...auto.map((l) => ({ ...l, n: counts.get(l.card.name) ?? 0 })).filter((l) => l.n > 0)];
  return { suggested: [...all, ...basics.values()], chosen, short, byClaude, room: n - on.length };
}

/** The owner's changes to the lands: a nonbasic in or out, a basic's count, and "+" for another of their lands a land search found. */
export async function setLands(list: List, profileId: string, input: { skip?: unknown; basics?: unknown; add?: unknown }): Promise<void> {
  const listId = list.id;
  // The basics' room now, from the land number and the nonbasic lands that are on (round 2, items 1 and 3): never
  // from the page, whose sum of basics is only right while the total is on target.
  const s0 = finishStore(listId);
  // The room as it will be once this change is in: an untick in the same call gives its slot to the basics.
  const s1 = structuredClone(s0);
  if (Array.isArray(input.skip)) s1.landPicks.skip = input.skip.filter((x): x is string => typeof x === 'string');
  if (typeof input.add === 'string') s1.landPicks.added = [...(s1.landPicks.added ?? []), input.add];
  const now = s0.run?.full ? await (async () => {
    const ctx = await tuneContext(list, profileId);
    return landsFor(ctx, heldCards(profileId, listId), s1, landPlan(ctx), chosenAdds(s0.run!.items, s0.choices).length, []);
  })() : null;
  if (now && typeof input.add === 'string') {
    const basics = now.suggested.filter((l) => /\bBasic\b/.test(l.card.type_line ?? ''));
    const allTyped = basics.length > 0 && basics.every((b) => s0.landPicks.basics[b.card.name] !== undefined);
    if (allTyped && now.room < basics.reduce((k, b) => k + s0.landPicks.basics[b.card.name], 0)) {
      throw new Error('Every basic count is one you set, so another land has no basic to replace: lower a basic first');
    }
  }
  update(listId, (s) => {
    if (input.basics && now) s.landPicks.typedFor = now.room;
    if (Array.isArray(input.skip)) s.landPicks.skip = input.skip.filter((x): x is string => typeof x === 'string').slice(0, 100);
    if (input.basics && typeof input.basics === 'object') {
      for (const [k, v] of Object.entries(input.basics as Record<string, unknown>)) {
        if (typeof v === 'number' && Number.isFinite(v) && v >= 0) s.landPicks.basics[k] = Math.min(99, Math.round(v));
      }
    }
    if (typeof input.add === 'string') {
      const landNames = s.searches.filter((x) => parseQuery(x.q).types.some((t) => t.startsWith('land'))).flatMap((x) => x.names);
      const name = landNames.find((n) => front(n) === front(input.add as string));
      if (!name) throw new Error(`${input.add} wasn't in a land search's results`);
      const added = s.landPicks.added ?? [];
      if (!added.some((n) => front(n) === front(name))) s.landPicks.added = [...added, name].slice(0, 40);
      s.landPicks.skip = s.landPicks.skip.filter((n) => front(n) !== front(name));
    }
  });
}

/**
 * Apply: the picks on Add and, on a full fill, the app's lands go into the
 * main deck. A card waiting in a section moves in; a card in another deck is
 * only added here (the other deck keeps it). The caller takes the snapshot.
 */
export async function applyFinish(list: List, profileId: string): Promise<NonNullable<FinishView['done']>> {
  const s = finishStore(list.id);
  if (!s.run) throw new Error('There are no picks to apply');
  const ctx = await tuneContext(list, profileId);
  const held = heldCards(profileId, list.id);
  const pool = finishPool(ctx, s.copies, held);
  const names = chosenAdds(s.run.items, s.choices);
  // A card Claude named (to buy, or owned outside the copies setting, Part C) is checked by name, not against the pool.
  const namedRows = s.run.items.filter((i) => names.includes(i.name) && (i.src === 'buy' || i.named));
  const byName = cardsNamed(namedRows.map((i) => i.name));
  const named = new Map<string, ScryfallCard>();
  for (const i of namedRows) { const c = byName.get(front(i.name)); if (c && !whyNotAddable(ctx, c)) named.set(i.name, c); }
  const cardOf = (n: string) => named.get(n) ?? pool.cards.get(n.toLowerCase()) ?? pool.cards.get(front(n));
  const cards = names.map(cardOf).filter((c): c is ScryfallCard => !!c);
  if (!cards.length) throw new Error('Nothing to add: put at least one card on Add');
  const lp = landPlan(ctx);
  const lands = s.run.full ? landsFor(ctx, held, s, lp, cards.length, cards.map(manaCostOf)).chosen : [];
  const undo: Done['undo'] = [];
  const add = (card: ScryfallCard, n: number) => {
    // A card waiting in a section moves to the main deck as it is; anything else is a new row or more copies.
    const row = cardsInList(list.id).find((c) => front(c.card.name) === front(card.name) && c.board !== 'main');
    if (row) { undo.push({ cardId: row.card.id, before: { quantity: row.quantity, board: row.board } }); updateListCard(list.id, row.card.id, { board: 'main' }); if (n > row.quantity) setQuantity(list.id, row.card.id, n); return; }
    undo.push({ cardId: card.id, before: addCardToList(list.id, card, n, 'nonfoil', 'main') });
  };
  for (const c of cards) add(c, 1);
  for (const l of lands) add(l.card, l.n);
  const landCount = lands.reduce((n, l) => n + l.n, 0);
  // From what went in: a pick no longer on offer at apply time was left out, and is said so, not named as borrowed.
  const added = new Set(cards.map((c) => c.name));
  const borrowed = s.run.items.filter((i) => i.src === 'other' && added.has(cardOf(i.name)?.name ?? '')).map((i) => `${i.name} (in ${i.deck})`);
  const left = names.filter((n) => !cardOf(n));
  const buy = s.run.items.filter((i) => i.src === 'buy' && added.has(cardOf(i.name)?.name ?? '')).map((i) => ({ name: i.name, price: i.price ?? null }));
  const done: Done = {
    at: now(), added: cards.length, lands: landCount, size: ctx.size + cards.length + landCount, borrowed, left, undo, buy,
    session: { run: s.run, choices: s.choices, skipped: s.skipped, turns: s.turns, searches: s.searches, seen: s.seen },
  };
  update(list.id, (x) => { const had = new Set(x.skippedBefore.map((y) => front(y.name))); rememberSkips(x); done.remembered = x.skippedBefore.filter((y) => !had.has(front(y.name))).map((y) => y.name); x.done = done; x.run = null; x.choices = {}; x.turns = []; x.skipped = []; x.searches = []; x.seen = []; });
  return { at: done.at, added: done.added, lands: done.lands, size: done.size, borrowed, left, buy };
}

/** Put every row the apply touched back exactly as it was, and bring the conversation back. */
export function undoFinish(list: List): { moved: number } {
  const s = finishStore(list.id);
  if (!s.done) return { moved: 0 };
  for (const u of [...s.done.undo].reverse()) {
    const row = cardsInList(list.id).find((c) => c.card.id === u.cardId);
    if (!row) continue;
    if (u.before === null) setQuantity(list.id, u.cardId, 0);
    else {
      if (row.board !== u.before.board) updateListCard(list.id, u.cardId, { board: u.before.board });
      setQuantity(list.id, u.cardId, u.before.quantity);
    }
  }
  const moved = s.done.undo.length;
  update(list.id, (x) => {
    const back = new Set((x.done!.remembered ?? []).map(front));
    x.skippedBefore = x.skippedBefore.filter((y) => !back.has(front(y.name)));
    Object.assign(x, x.done!.session);
    x.done = null;
  });
  return { moved };
}

// --- the view ----------------------------------------------------------------------------------

/**
 * What a round costs. Measured: the average of the app's own rounds this week
 * (recordRound; a round is several calls, mostly
 * searches, so one call's average would not say it). Until there are three of
 * a kind, a guess from the one real Opus run (2026-11-13: a first list of 43
 * picks $0.41, a later round $0.05) that grows with the cards asked for, so
 * 5 cards no longer show the price of a fill.
 */
const GUESS = { first: { base: 0.06, perCard: 0.008 }, later: { base: 0.04, perCard: 0.004 } };
const ROUNDS_KEY = 'finish.rounds';
const measured = (): MeasuredRound[] => { try { return JSON.parse(getSetting(ROUNDS_KEY) ?? '[]') as MeasuredRound[]; } catch { return []; } };

/** A round that ended with picks: what its own calls cost (answered calls only), kept for the price (round 2, item 5). */
function recordRound(kind: 'first' | 'later', since: string, profileId: string, label: string): void {
  const cost = aiCalls(since, 500).filter((c) => c.profileId === profileId && c.label === label && c.step.startsWith('finish:') && c.outcome === 'ok').reduce((n, c) => n + c.cost, 0);
  if (cost <= 0) return;
  setSetting(ROUNDS_KEY, JSON.stringify([...measured(), { kind, cost, at: new Date().toISOString() }].slice(-60)));
}

function roundCosts(): FinishView['cost'] {
  // Only rounds that ended with picks, each priced by its own answered calls: a round whose search failed isn't one.
  const m = averageRounds(measured().filter((r) => Date.parse(r.at) > Date.now() - 30 * 86400_000));
  const one = (k: 'first' | 'later') => (m[k] !== null ? { usd: m[k]!, measured: true } : { usd: GUESS[k].base + GUESS[k].perCard * 40, measured: false, ...GUESS[k] });
  return { first: one('first'), later: one('later') };
}

export async function finishView(list: List, profileId: string): Promise<FinishView> {
  const s = finishStore(list.id);
  const job = latestJob('finish', list.id);
  const running = job?.status === 'running';
  const ctx = await tuneContext(list, profileId);
  const lp = landPlan(ctx);
  const landsTarget = s.lands ?? lp.range[0];
  const count = finishCount(ctx.size, landsToAdd(lp, landsTarget), null);
  const po = planOwner(list.id);
  const mode = ctx.plan.goal.combos ?? null;
  // The funnel is worked out on the setup screen only: the list and the polling while Claude runs don't need it.
  const pool = !s.run && !running && list.commander ? finishPool(ctx, s.copies) : null;
  const byId = new Map<string, ScryfallCard>();
  if (s.run) {
    const ids = [...new Set(s.run.items.map((i) => i.cardId))];
    for (const r of database().all(`SELECT id, data FROM cards WHERE id IN (${ids.map(() => '?').join(',') || "''"})`, ids) as Array<{ id: string; data: string }>) byId.set(r.id, JSON.parse(r.data) as ScryfallCard);
    // A card to buy (Part C) may be only in the card data: read it by name.
    const missing = s.run.items.filter((i) => !byId.has(i.cardId));
    if (missing.length) { const got = cardsNamed(missing.map((i) => i.name)); for (const i of missing) { const c = got.get(front(i.name)); if (c) byId.set(i.cardId, c); } }
  }
  const items: FinishItem[] = (s.run?.items ?? []).map(({ cardId, ...i }) => {
    const c = byId.get(cardId);
    return { ...i, card: { id: cardId, image: c ? imageOf(c, 'normal') : null, manaCost: c ? manaCostOf(c) : '', typeLine: c ? typeLineOf(c) : '', text: c ? oracleTextOf(c) : '', cmc: c?.cmc ?? 0 } };
  });
  const listed = new Set(items.map((i) => front(i.name)));
  const skipped = new Set(s.skipped.map(front));
  // Under each group, the search that fed it (the one whose results hold most of its picks), and what else it found.
  const more: NonNullable<FinishView['run']>['more'] = {};
  if (s.run) {
    const costs = new Map<string, string>();
    const others = [...new Set(s.searches.flatMap((x) => x.names))].filter((n) => !listed.has(front(n)));
    for (const c of others.length ? (database().all(`SELECT name, data FROM cards WHERE name IN (${others.map(() => '?').join(',')})`, others) as Array<{ name: string; data: string }>) : []) costs.set(c.name, manaCostOf(JSON.parse(c.data) as ScryfallCard));
    const keyOfGroup = (i: Pick<FinishItem, 'group' | 'theme'>) => (i.group === 'theme' && i.theme ? `theme:${i.theme}` : i.group);
    for (const g of [...new Set(items.map(keyOfGroup))]) {
      const mine = new Set(items.filter((i) => keyOfGroup(i) === g).map((i) => front(i.name)));
      const best = [...s.searches].reverse().map((x) => ({ x, hits: x.names.filter((n) => mine.has(front(n))).length })).sort((a, b) => b.hits - a.hits)[0];
      if (!best || !best.hits) continue;
      const cards = best.x.names.filter((n) => !listed.has(front(n)) && !skipped.has(front(n))).slice(0, 16).map((n) => ({ name: n, manaCost: costs.get(n) ?? '' }));
      if (cards.length) more[g] = { q: best.x.q, n: best.x.n, cards };
    }
  }
  let lands: NonNullable<FinishView['run']>['lands'] = null;
  if (s.run?.full) {
    const adds = chosenAdds(items, s.choices);
    const { suggested, chosen, short, byClaude } = landsFor(ctx, heldCards(profileId, list.id), s, lp, adds.length, items.filter((i) => adds.includes(i.name)).map((i) => i.card.manaCost));
    const basic = (l: { card: ScryfallCard }) => /\bBasic\b/.test(l.card.type_line ?? '');
    const picked = new Set(suggested.map((l) => front(l.card.name)));
    // "+": the owner's lands the land searches found that aren't listed yet.
    const landSearched = [...new Set(s.searches.filter((x) => parseQuery(x.q).types.some((t) => t.startsWith('land'))).flatMap((x) => x.names))].filter((n) => !picked.has(front(n)));
    lands = {
      duals: suggested.filter((l) => !basic(l)).map((l) => ({ name: l.card.name, on: !s.landPicks.skip.includes(l.card.name), ...(l.why ? { why: l.why } : {}), ...(l.src === 'other' && l.deck ? { deck: l.deck } : {}) })),
      more: landSearched.slice(0, 24), short, limit: s.run.landsLimit ?? null, byClaude,
      basics: suggested.filter(basic).map((l) => ({ name: l.card.name, n: chosen.find((c) => c.card.name === l.card.name)?.n ?? 0, suggested: l.n })),
      total: chosen.reduce((k, p) => k + p.n, 0),
      suggested: suggested.reduce((k, p) => k + p.n, 0),
      target: s.run.landsTarget ?? landsTarget,
      why: `${s.run.landsTarget !== undefined && s.run.landsTarget !== lp.range[0] ? `You asked for ${s.run.landsTarget} lands in the deck (the plan says ${lp.range[0]}–${lp.range[1]})` : `The plan wants ${lp.range[0]}–${lp.range[1]} lands`}; the deck has ${fmt(lp.have)}.`,
    };
  }
  return {
    size: ctx.size,
    copies: s.copies,
    buy: s.buy,
    spend: s.spend,
    noCollection: !!pool && pool.counts.any === 0,
    want: s.want,
    counts: pool?.counts ?? null,
    combos: {
      mode, owned: s.run?.owned ?? null, failed: !!s.run?.combosFailed, found: s.run?.combos ?? [],
      base: [...ctx.commanders.map((c) => c.name), ...ctx.main.map((c) => c.card.name)],
    },
    plan: { text: po.planText.trim() || null, confirmed: !!po.confirmedAt },
    howMany: { room: count.room, nonland: count.nonland, lands: count.lands || Math.min(count.room, landsToAdd(lp, landsTarget)), target: landsTarget, mine: s.lands !== null, have: fmt(lp.have), plan: lp.range },
    run: s.run ? {
      id: s.run.id, at: s.run.at, round: s.run.round, model: s.run.model, want: s.run.want, full: s.run.full, short: s.run.short, reply: s.run.reply,
      items, more, lands, changes: s.run.changes ?? null, dropped: s.run.dropped, buy: s.run.buy ?? null,
    } : null,
    choices: s.choices,
    skipped: s.skipped,
    skippedBefore: s.skippedBefore,
    offer: s.offer,
    turns: s.turns,
    searches: s.searches.filter((x) => x.round === (running && s.pending ? s.pending : s.run?.round ?? 1)).map(({ q, n, round }) => ({ q, n, round })),
    job: job && (running || (job.status === 'failed' && (!s.run || job.startedAt > s.run.at))) ? { status: job.status as 'running' | 'failed', detail: job.detail || null, error: job.status === 'failed' ? job.error ?? 'Claude didn’t finish' : null } : null,
    done: s.done ? { at: s.done.at, added: s.done.added, lands: s.done.lands, size: s.done.size, borrowed: s.done.borrowed, left: s.done.left ?? [], buy: s.done.buy ?? [] } : null,
    cost: roundCosts(),
    noKey: !process.env.ANTHROPIC_API_KEY,
  };
}

export { PROMPT_VERSIONS };
