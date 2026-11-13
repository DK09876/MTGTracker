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
import { addCardToList, aiCalls, cardsInList, database, setQuantity, updateListCard, type CardBefore, type List } from './db';
import { planFor } from './deck-plan';
import { latestJob } from './jobs';
import { ownedCombos } from './finish-combos';
import { BASIC, finishLands, finishPool, heldCards, isLand, sourceOf, type Held, type LandPick, type Pool } from './finish-pool';
import { localCards } from './card-store';
import {
  chosenAdds, finishCount, FINISH_GROUPS, measuredRounds, SEARCH_LIMIT, SEARCH_LIMIT_LATER, searchLines, searchText,
  type Copies, type FinishChoice, type FinishGroup, type FinishItem, type FinishMark, type FinishTurn, type FinishView, type OwnedCombo, type Source,
} from './finish-shared';
import { planContext } from './plan-context';
import { owner as planOwner } from './plan-help';
import { PROMPT_VERSIONS } from './prompt-versions';
import { imageOf, manaCostOf, oracleTextOf, typeLineOf, type ScryfallCard } from './scryfall';
import { combosInDeck } from './spellbook';
import { gcRoomOf, landPlan, tuneContext, type Context } from './tune';

const front = (n: string) => n.split(' // ')[0].trim().toLowerCase();
const fmt = (x: number) => String(Math.round(x * 10) / 10);
/** Lands to add for the deck to hold `target` lands (a double-faced card counts as part of one, as the land number does). */
export const landsToAdd = (lp: { have: number }, target: number) => Math.max(0, Math.ceil(target - lp.have));
const keyOf = (c: ScryfallCard) => c.oracle_id ?? c.id;
const now = () => new Date().toISOString();
/** Names are joined with "; " for the model: many card names have commas in them. */
const NAMES = '; ';

// --- kept with the deck ---------------------------------------------------------------

interface StoredItem extends Omit<FinishItem, 'card'> { cardId: string }
interface StoredSearch { q: string; n: number; round: number; names: string[] }
interface Run {
  id: string; at: string; model: string; round: number; want: number; full: boolean; short: number; reply: string;
  items: StoredItem[]; dropped: number;
  /** The combos complete among the commander, the deck and every pick this round (the app's check). */
  combos: OwnedCombo[];
  owned: number | null; combosFailed: boolean;
  /** Lands in the deck when this fill is done (a full fill). */
  landsTarget?: number;
}
interface Done {
  at: string; added: number; lands: number; size: number; borrowed: string[];
  /** Picks on Add that were no longer on offer at apply time, so not added. */
  left?: string[];
  /** Each row the apply touched, and how it was before. */
  undo: Array<{ cardId: string; before: CardBefore }>;
  session: Pick<FinishStore, 'run' | 'choices' | 'skipped' | 'turns' | 'searches' | 'seen'>;
}

export interface FinishStore {
  copies: Copies;
  /** The number asked for; null is a full fill. */
  want: number | null;
  /** Lands in the deck when a fill to 100 is done, the owner's number; null is the plan's land number. */
  lands: number | null;
  /** The owner's changes to the app's lands for this list: duals left out, and how many of each basic. */
  landPicks: { skip: string[]; basics: Record<string, number> };
  run: Run | null;
  choices: Record<string, { choice: FinishChoice; text: string }>;
  /** Never offered again in this conversation. */
  skipped: string[];
  /** Every name a search returned in this conversation: a pick must be one of them. */
  seen: string[];
  searches: StoredSearch[];
  turns: FinishTurn[];
  done: Done | null;
  /** The round running now, for its searches on the page. */
  pending: number | null;
}

const EMPTY: FinishStore = { copies: 'spare', want: null, lands: null, landPicks: { skip: [], basics: {} }, run: null, choices: {}, skipped: [], seen: [], searches: [], turns: [], done: null, pending: null };

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

/** Start over: the picks, the choices and the conversation go; the copies setting and the number stay. */
export function resetFinish(listId: string): void {
  update(listId, (s) => { s.run = null; s.choices = {}; s.skipped = []; s.seen = []; s.searches = []; s.turns = []; s.done = null; s.landPicks = { skip: [], basics: {} }; });
}

/** The copies setting and the number, per deck. A new commander starts the conversation over. */
export function setFinish(listId: string, input: { copies?: unknown; want?: unknown; lands?: unknown }): void {
  update(listId, (s) => {
    if (input.copies === 'spare' || input.copies === 'any') s.copies = input.copies;
    if (input.lands === null) s.lands = null;
    else if (typeof input.lands === 'number' && Number.isFinite(input.lands) && input.lands >= 0) s.lands = Math.min(99, Math.round(input.lands));
    if (input.want === null) s.want = null;
    else if (typeof input.want === 'number' && Number.isFinite(input.want) && input.want >= 1) s.want = Math.min(500, Math.round(input.want));
  });
}

// --- the call --------------------------------------------------------------------------

export const FINISH_SYSTEM = `You help a Magic: The Gathering player finish their Commander deck from cards they own.
You get the deck's plan (each part with who set it), the cards already in the deck, and how many cards to pick. After the first list, you also get the conversation so far.

Find cards with the search tool. It searches only the owner's cards that may go in this deck: in its colours, legal, within the owner's budget, deck rule and bracket. Words are matched in the name, type line and rules text, and all words must match; add t:<type>, mv<=N, mv>=N or mv=N to narrow, and -word to leave cards out. Nothing else is understood (no colour or other filters): a word it can't use is ignored, and the result says so. Each search returns up to 40 cards with their rules text and the total count. Searches are limited; when none are left, give your picks.

Give your picks with give_picks, sorted into groups: ramp, draw (real card draw, not cantrips), interaction (removal, counterspells, board wipes), theme (name the theme), wins (ways to end the game), protection.
- Pick only cards a search returned, by their exact name. A card a search didn't return can't be used.
- No lands: the app chooses the lands.
- Exactly the number of cards asked for, each once. If the searches truly can't fill it, give fewer and say so in the reply.
- Give every card one short sentence why, as a player would say it at the table, about this card in this deck.
- A line that ends "(in <deck>)" is a card the owner has only in another deck. Pick it only when it is clearly better than what their spare copies offer.
- Judge by the plan first and by what the owner wants. Think it through privately.

This is one conversation. On every list after the first:
- Cards the owner kept stay; don't pick them again.
- Never pick a card the owner skipped.
- When the owner asked you to rethink a card, weigh their reason: pick it again with a better argument, or pick something else, and say which in the reply.
- Where the owner said something, follow it, and apply their reasons to similar cards. If what they said means a kept card should go, name it in "out" and pick its replacement too.
- Reply in 2 to 4 sentences: what you changed and which of their words changed it.`;

export const FINISH_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'search',
    description: 'Search the owner\'s cards that may go in this deck. Words match the name, type line and rules text (all must match). t:<type> narrows by type; mv<=N, mv>=N or mv=N by mana value; -word leaves out cards with that word. Returns up to 40 cards with rules text and the total count.',
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
  const ctx = await tuneContext(list, profileId);
  if (!list.commander) throw new ModelError('Set the commander first: the cards on offer follow its colours.');
  const held = heldCards(profileId, list.id);
  const pool = finishPool(ctx, before.copies, held);
  if (!pool.lines.length) throw new ModelError('None of your cards can go in this deck under these settings. Try “Take from other decks too”, or check the budget and deck rule on the Plan tab.');
  const lp = landPlan(ctx);
  const landsTarget = before.lands ?? lp.range[0];
  const count = finishCount(ctx.size, landsToAdd(lp, landsTarget), before.want);
  const at = now();
  const round = rerun ? before.run!.round + 1 : 1;

  // What the owner's answer changes: the picks on Add stay, the rest open their slots.
  let turns: FinishTurn[];
  let kept: StoredItem[] = [];
  let skipped = new Set(rerun ? before.skipped.map(front) : []);
  let reply: Extract<FinishTurn, { kind: 'owner-reply' }> | null = null;
  if (!rerun) turns = [{ kind: 'owner-start', want: count.want, copies: before.copies, at }];
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
  // The pool may have changed since (the deck, the setting): what is no longer on offer opens its slot too.
  kept = kept.filter((i) => pool.cards.has(i.name.toLowerCase()) || pool.cards.has(front(i.name)));
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
  ].join('\n');
  const task = [
    ...sessionLines(turns),
    ...(rerun ? [
      '',
      kept.length ? `## Kept (they stay; don't pick them again)\n${kept.map((i) => i.name).join(NAMES)}` : '## Kept\nNothing.',
      ...(skipped.size ? ['', `## Skipped by the owner: never pick these\n${[...before.skipped, ...(reply?.marks ?? []).filter((m) => m.choice === 'skip').map((m) => m.name)].filter((n, i, a) => a.indexOf(n) === i).join(NAMES)}`] : []),
    ] : []),
    '',
    '## The task',
    rerun
      ? `This is list ${round}. Pick exactly ${need} more non-land card${need === 1 ? '' : 's'} for the slots that opened${reply?.message ? ' (and the replacements for any you name in "out")' : ''}, in groups. No lands. You have ${limit} searches.`
      : `Pick exactly ${count.want} non-land cards, in groups. No lands${count.full ? `: the app adds ${count.lands} lands to bring the deck to 100, so it will hold ${landsTarget} lands when done (${before.lands !== null ? 'the number the owner chose' : "the plan's land number"}). Weigh ramp and mana costs with that in mind` : ''}. You have ${limit} searches.`,
  ].join('\n').trim();

  update(list.id, (s) => { if (!rerun) { s.searches = []; s.seen = []; } s.done = null; s.pending = round; });
  progress(rerun ? `Claude is reading your answer (list ${round})` : `Claude is searching your cards (${count.want} to find)`);

  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: task }];
  let used = 0;
  let answer: unknown = null;
  const seen = new Set(rerun ? before.seen.map(front) : []);
  for (let step = 0; step < limit + 6 && answer === null; step++) {
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
      used += 1;
      const r = searchLines(pool.lines, q);
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
  const need2 = Math.max(0, count.want - kept.length);
  const checked = checkPicks(answer, {
    pool, seen, skipped, taken: new Set(kept.map((i) => front(i.name))), need: need2,
    gcRoom: (() => { const r = gcRoomOf(ctx); return r === null ? null : Math.max(0, r - kept.filter((i) => pool.cards.get(i.name.toLowerCase())?.game_changer).length); })(),
  });
  if (!checked.picks.length && !kept.length) throw new ModelError(`None of Claude’s ${checked.dropped} picks could be used (not among your cards on offer, or not from its searches). Nothing was saved; try again.`);
  const fresh = checked.picks.map((p) => toItem(p.card, held.get(keyOf(p.card)), before.copies, { group: p.group, ...(p.theme ? { theme: p.theme } : {}), why: p.why, mark: rerun ? 'new' : null }));
  const items = [...kept, ...fresh];
  const found = await combosFound(ctx, items.map((i) => i.name));
  const run: Run = {
    id: randomUUID(), at: now(), model, round, want: count.want, full: count.full, short: checked.short, reply: checked.reply,
    items, dropped: checked.dropped, combos: found ?? [], owned: owned?.length ?? null, combosFailed: combosFailed || found === null, ...(count.full ? { landsTarget } : {}),
  };
  update(list.id, (s) => {
    s.run = run;
    s.choices = {};
    if (!rerun) s.landPicks = { skip: [], basics: {} };
    s.skipped = rerun ? [...new Set([...before.skipped, ...(reply?.marks ?? []).filter((m) => m.choice === 'skip').map((m) => m.name)])] : [];
    s.turns = [...turns, { kind: 'claude-picks', round, picks: items.map((i) => i.name), short: checked.short, searches: used, reply: checked.reply, at: run.at }];
    s.done = null;
    s.pending = null;
  });
  return { runId: run.id, picks: items.length };
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
    if (found) x.run.combos = found;
  });
}

/**
 * The app's lands for a fill to 100 (Part D), and the owner's changes to them:
 * duals left out, and any number of each basic (every colour of the deck is
 * offered, at 0 when the split gave it none). Nothing else is added for a
 * dual left out: the owner sets the basics.
 */
export function landsFor(ctx: Context, held: Map<string, Held>, s: Pick<FinishStore, 'copies' | 'lands' | 'landPicks' | 'run'>, lp: { have: number; range: [number, number] }, adds: number, costs: string[]): { suggested: LandPick[]; chosen: LandPick[] } {
  const target = s.run?.landsTarget ?? s.lands ?? lp.range[0];
  const n = Math.max(0, Math.min(100 - ctx.size - adds, landsToAdd(lp, target)));
  const suggested = finishLands(ctx, held, s.copies, n, costs);
  const isBasic = (c: ScryfallCard) => /\bBasic\b/.test(c.type_line ?? '');
  const basics = new Map(suggested.filter((l) => isBasic(l.card)).map((l) => [l.card.name, l]));
  const more = localCards([...ctx.identity].map((c) => BASIC[c]).filter((b) => b && !basics.has(b)));
  for (const c of more) basics.set(c.name, { card: ctx.main.find((x) => x.card.name === c.name)?.card ?? c, n: 0, src: 'spare' });
  const picks = s.landPicks ?? { skip: [], basics: {} };
  const chosen = [
    ...suggested.filter((l) => !isBasic(l.card) && !picks.skip.includes(l.card.name)),
    ...[...basics.values()].map((l) => ({ ...l, n: picks.basics[l.card.name] ?? l.n })).filter((l) => l.n > 0),
  ];
  return { suggested: [...suggested.filter((l) => !isBasic(l.card)), ...basics.values()], chosen };
}

/** The owner's changes to the app's lands: a dual in or out, a basic's count. */
export function setLands(listId: string, input: { skip?: unknown; basics?: unknown }): void {
  update(listId, (s) => {
    if (Array.isArray(input.skip)) s.landPicks.skip = input.skip.filter((x): x is string => typeof x === 'string').slice(0, 100);
    if (input.basics && typeof input.basics === 'object') {
      for (const [k, v] of Object.entries(input.basics as Record<string, unknown>)) {
        if (typeof v === 'number' && Number.isFinite(v) && v >= 0) s.landPicks.basics[k] = Math.min(99, Math.round(v));
      }
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
  const cards = names.map((n) => pool.cards.get(n.toLowerCase()) ?? pool.cards.get(front(n))).filter((c): c is ScryfallCard => !!c);
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
  const borrowed = s.run.items.filter((i) => i.src === 'other' && added.has(pool.cards.get(i.name.toLowerCase())?.name ?? pool.cards.get(front(i.name))?.name ?? '')).map((i) => `${i.name} (in ${i.deck})`);
  const left = names.filter((n) => !pool.cards.has(n.toLowerCase()) && !pool.cards.has(front(n)));
  const done: Done = {
    at: now(), added: cards.length, lands: landCount, size: ctx.size + cards.length + landCount, borrowed, left, undo,
    session: { run: s.run, choices: s.choices, skipped: s.skipped, turns: s.turns, searches: s.searches, seen: s.seen },
  };
  update(list.id, (x) => { x.done = done; x.run = null; x.choices = {}; x.turns = []; x.skipped = []; x.searches = []; x.seen = []; });
  return { at: done.at, added: done.added, lands: done.lands, size: done.size, borrowed, left };
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
  update(list.id, (x) => { Object.assign(x, x.done!.session); x.done = null; });
  return { moved };
}

// --- the view ----------------------------------------------------------------------------------

/**
 * What a round costs. Measured: the average of the app's own rounds this week
 * (lib/finish-shared.ts measuredRounds; a round is several calls, mostly
 * searches, so one call's average would not say it). Until there are three of
 * a kind, a guess from the one real Opus run (2026-11-13: a first list of 43
 * picks $0.41, a later round $0.05) that grows with the cards asked for, so
 * 5 cards no longer show the price of a fill.
 */
const GUESS = { first: { base: 0.06, perCard: 0.008 }, later: { base: 0.04, perCard: 0.004 } };
function roundCosts(): FinishView['cost'] {
  const m = measuredRounds(aiCalls(new Date(Date.now() - 7 * 86400_000).toISOString(), 5000).filter((c) => c.step.startsWith('finish:')));
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
    const { suggested, chosen } = landsFor(ctx, heldCards(profileId, list.id), s, lp, adds.length, items.filter((i) => adds.includes(i.name)).map((i) => i.card.manaCost));
    const basic = (l: { card: ScryfallCard }) => /\bBasic\b/.test(l.card.type_line ?? '');
    lands = {
      duals: suggested.filter((l) => !basic(l)).map((l) => ({ name: l.card.name, on: !s.landPicks.skip.includes(l.card.name) })),
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
      items, more, lands, dropped: s.run.dropped,
    } : null,
    choices: s.choices,
    skipped: s.skipped,
    turns: s.turns,
    searches: s.searches.filter((x) => x.round === (running && s.pending ? s.pending : s.run?.round ?? 1)).map(({ q, n, round }) => ({ q, n, round })),
    job: job && (running || (job.status === 'failed' && (!s.run || job.startedAt > s.run.at))) ? { status: job.status as 'running' | 'failed', detail: job.detail || null, error: job.status === 'failed' ? job.error ?? 'Claude didn’t finish' : null } : null,
    done: s.done ? { at: s.done.at, added: s.done.added, lands: s.done.lands, size: s.done.size, borrowed: s.done.borrowed, left: s.done.left ?? [] } : null,
    cost: roundCosts(),
    noKey: !process.env.ANTHROPIC_API_KEY,
  };
}

export { PROMPT_VERSIONS };
