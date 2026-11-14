/**
 * Upgrades (handoff 10, Part A): what would make a finished deck better,
 * from the owner's boxes or to buy, and what each card replaces. One
 * conversation per deck, built like Finish's (lib/finish.ts):
 *
 *   1. Claude is sent the commander, the confirmed plan with the owner's
 *      notes, every category and the job counts (planContext), the main deck
 *      with rules text and Finish's reason on each card it picked, the combos
 *      the deck is one card away from, the "Not for me" list and how many
 *      suggestions are wanted.
 *   2. Source one, the owner's cards: Finish's search over finishPool (the
 *      deck's copies setting; lands apart). Source two, cards they don't
 *      have: named from memory. Off when the plan says only cards I own, or
 *      the owner chose "from my cards".
 *   3. One tool call answers: an overall read, then the suggestions, most
 *      important first, each with the job, why, and the deck card it replaces.
 *   4. Code checks every name before the owner sees it (checkUpgrades): the
 *      card exists, Tune's checks with the replaced card leaving, where the
 *      copy is (never the model's word), the price (none is "no price", not
 *      free), the replaced card may come out, and what the swap does to the
 *      job counts. A name that fails is dropped and counted.
 *   5. The owner marks each Swap in, Rethink or Not for me; a later round
 *      keeps what is on Swap in and refills the open slots. "Not for me" is
 *      remembered per deck, apart from Finish's skipped list (the owner's
 *      call, 2026-11-13).
 *   6. Apply: a snapshot first (the route), each card into the main deck and
 *      the replaced card to the cuts section, or the card to the Maybeboard
 *      ("Maybeboard instead"). Cards to buy go straight into the main deck.
 *      Undo puts every touched row back exactly.
 *
 * Nothing crosses decks. Server only.
 */

import { randomUUID } from 'node:crypto';

import type Anthropic from '@anthropic-ai/sdk';

import { ModelError } from './ai';
import type { ClaudeParams } from './ai-claude';
import { cardPrices } from './card-price';
import { addCardToList, aiCalls, cardsInList, database, getSetting, setQuantity, setSetting, updateListCard, type CardBefore, type List } from './db';
import { cardsNamed } from './cards-named';
import { finishStore } from './finish';
import { finishPool, heldCards, isLand, type Held } from './finish-pool';
import { averageRounds, colourWords, parseQuery, searchLines, searchText, type MeasuredRound } from './finish-shared';
import { latestJob } from './jobs';
import { planContext } from './plan-context';
import { owner as planOwner } from './plan-help';
import { imageOf, manaCostOf, oracleTextOf, typeLineOf, type ScryfallCard } from './scryfall';
import { sectionsOf } from './sections';
import { cutBoard } from './sections-shared';
import { combosInDeck } from './spellbook';
import { gcRoomOf, swapEffects, tuneContext, whyNotAddable, type Context } from './tune';
import {
  asksForLands, chosenIn, UPGRADE_DEFAULT, UPGRADE_SEARCHES, UPGRADE_SEARCHES_LATER,
  type UpgradeChanges, type UpgradeChoice, type UpgradeItem, type UpgradeOwn, type UpgradeSources, type UpgradesView, type UpgradeWhere,
} from './upgrades-shared';

const front = (n: string) => n.split(' // ')[0].trim().toLowerCase();
const keyOf = (c: ScryfallCard) => c.oracle_id ?? c.id;
const now = () => new Date().toISOString();
const NAMES = '; ';
const quote = (t: string) => `"${t.replace(/\s+/g, ' ').trim()}"`;

// --- kept with the deck ---------------------------------------------------------------

interface StoredItem extends Omit<UpgradeItem, 'card' | 'out'> { cardId: string; out: { name: string; id: string; why: string } | null }
type Turn =
  | { kind: 'claude'; round: number; names: string[]; read: string; at: string }
  | { kind: 'owner'; marks: Array<{ name: string; choice: UpgradeChoice; text: string }>; message: string; at: string };
interface Run { id: string; at: string; model: string; round: number; want: number; read: string; items: StoredItem[]; dropped: Array<{ name: string; why: string }>; changes?: UpgradeChanges }
interface Done {
  at: string; swapped: number; maybe: number; size: number; cutsTo: string; buy: Array<{ name: string; price: number | null }>;
  remembered: string[];
  undo: Array<{ cardId: string; before: CardBefore }>;
  session: Pick<UpgradesStore, 'run' | 'choices' | 'skipped' | 'turns' | 'searches' | 'seen'>;
}

export interface UpgradesStore {
  count: number;
  sources: UpgradeSources;
  run: Run | null;
  choices: UpgradesView['choices'];
  /** "Not for me" in this conversation. */
  skipped: string[];
  /** "Not for me" on this deck before, with the owner's reason: never offered again on this deck. */
  notForMe: Array<{ name: string; why: string }>;
  seen: string[];
  searches: Array<{ q: string; n: number; round: number; names: string[] }>;
  turns: Turn[];
  offer: UpgradesView['offer'];
  done: Done | null;
  pending: number | null;
}

const EMPTY: UpgradesStore = { count: UPGRADE_DEFAULT, sources: 'both', run: null, choices: {}, skipped: [], notForMe: [], seen: [], searches: [], turns: [], offer: null, done: null, pending: null };

let ready = false;
function db() {
  const d = database();
  if (!ready) {
    d.run(`CREATE TABLE IF NOT EXISTS deck_upgrades (listId TEXT PRIMARY KEY, state TEXT NOT NULL DEFAULT '{}', updatedAt TEXT NOT NULL)`);
    ready = true;
  }
  return d;
}

export function upgradesStore(listId: string): UpgradesStore {
  const r = db().get('SELECT state FROM deck_upgrades WHERE listId = ?', [listId]) as { state: string } | null;
  if (!r) return structuredClone(EMPTY);
  try { return { ...structuredClone(EMPTY), ...(JSON.parse(r.state) as Partial<UpgradesStore>) }; } catch { return structuredClone(EMPTY); }
}

function update(listId: string, change: (s: UpgradesStore) => void): UpgradesStore {
  const s = upgradesStore(listId);
  change(s);
  db().run(`INSERT INTO deck_upgrades (listId, state, updatedAt) VALUES (?, ?, ?)
    ON CONFLICT(listId) DO UPDATE SET state = excluded.state, updatedAt = excluded.updatedAt`, [listId, JSON.stringify(s), now()]);
  return s;
}

/** This list's "Not for me" rows join the deck's list, with the owner's reason. */
function remember(s: UpgradesStore): string[] {
  if (!s.run) return [];
  const have = new Set(s.notForMe.map((x) => front(x.name)));
  const added: string[] = [];
  for (const i of s.run.items) {
    const c = s.choices[i.name];
    if (c?.choice !== 'skip') continue;
    const why = (c.text ?? '').trim().slice(0, 300);
    const had = s.notForMe.find((y) => front(y.name) === front(i.name));
    if (had) { if (why) had.why = why; continue; }
    s.notForMe.push({ name: i.name, why });
    have.add(front(i.name));
    added.push(i.name);
  }
  s.notForMe = s.notForMe.slice(-300);
  return added;
}

export function unskipUpgrade(listId: string, name: string): void {
  update(listId, (s) => { s.notForMe = s.notForMe.filter((x) => front(x.name) !== front(name)); s.skipped = s.skipped.filter((x) => front(x) !== front(name)); });
}

/** Start over: the list, the choices and the conversation go; the settings and the "Not for me" list stay. */
export function resetUpgrades(listId: string): void {
  update(listId, (s) => { remember(s); s.run = null; s.choices = {}; s.skipped = []; s.seen = []; s.searches = []; s.turns = []; s.done = null; });
}

export function setUpgrades(listId: string, input: { count?: unknown; sources?: unknown }): void {
  update(listId, (s) => {
    if (typeof input.count === 'number' && Number.isFinite(input.count) && input.count >= 1) s.count = Math.min(30, Math.round(input.count));
    if (input.sources === 'both' || input.sources === 'mine' || input.sources === 'buy') s.sources = input.sources;
  });
}

export function setUpgradeChoices(listId: string, choices: unknown): void {
  const s = upgradesStore(listId);
  if (!s.run) return;
  const names = new Set(s.run.items.map((i) => i.name));
  const next: UpgradesStore['choices'] = {};
  for (const [name, v] of Object.entries((choices ?? {}) as Record<string, unknown>).slice(0, 100)) {
    const c = v as { choice?: unknown; text?: unknown; where?: unknown } | null;
    if (!names.has(name) || !c || (c.choice !== 'in' && c.choice !== 'ask' && c.choice !== 'skip')) continue;
    const text = typeof c.text === 'string' ? c.text.slice(0, 300) : '';
    const where = c.where === 'maybe' ? 'maybe' as const : undefined;
    if (c.choice === 'in' && !text.trim() && !where) continue;
    next[name] = { choice: c.choice, text, ...(where ? { where } : {}) };
  }
  update(listId, (x) => { x.choices = next; });
}

// --- the call ---------------------------------------------------------------------------

export const UPGRADES_SYSTEM = `You help a Magic: The Gathering player improve a Commander deck that is already at 100 cards. For each card you suggest, you name the card in the deck it should replace.
You get the deck's plan (each part with who set it, the owner's notes word for word, every category and the job counts against the plan's ranges), every card in the main deck with its rules text (and, for cards an earlier Finish picked, why), the combos the deck is one card away from, cards the owner said "not for me" with their reasons, and how many suggestions to give.

Two sources, as the task says:
- The owner's cards: find them with the search tool. It searches only the owner's cards that may go in this deck (in its colours, legal, within the budget, deck rule and bracket). Words must all match the name, type line or rules text; add t:<type>, mv<=N, mv>=N or mv=N to narrow, -word or -t:<type> to leave cards out. Nothing else is understood. A search with t:land looks only at the owner's lands. Searches are limited; when none are left, give your answer. Search by name for the well-known staples in these colours and the commander's best-known partners: owned copies of those are easy to miss.
- Cards the owner doesn't have: name well-known cards from memory, by their exact name. The app checks every name (colours, legality, budget, bracket, whether the owner has it) and drops any that don't pass, so name only real cards you are sure of.

Give your answer with give_upgrades, once:
- "read": two or three sentences on the deck as it stands: what works, and where it is short ("the engine is fine; the deck is short of ways to end the game").
- Up to the number asked for, the most important first. Each: the exact card name; the job it does in this deck; one sentence why, as a player would say it at the table; the card in the main deck it replaces, by its exact name, with one short clause why that one goes. Never the commander, never a card the owner marked never cut.
- Weigh real upgrades: a card that does the job better, fixes a job under its range, completes a combo the plan wants, or plays to the plan's themes. A like-for-like trade is only worth it when the new card is clearly stronger.
- No lands unless the owner asks for them; a land replaces a land.
- Say "mine" for a card a search returned and "buy" for one you named from memory. The app works out the truth either way.

This is one conversation. On a list after the first: cards the owner kept stay (don't suggest them again); never suggest a card they said is not for them; weigh their reason when they asked you to rethink one; follow what they said, and apply their reasons to similar cards. Reply in "read" with what you changed and which of their words changed it.`;

export function upgradeTools(search: boolean): Anthropic.Beta.BetaTool[] {
  return [
    ...(search ? [{
      name: 'search',
      description: 'Search the owner\'s cards that may go in this deck. Words match the name, type line and rules text (all must match). t:<type>, -t:<type>, mv<=N, mv>=N, mv=N and -word. Returns up to 40 cards with rules text and the total count.',
      input_schema: { type: 'object' as const, properties: { query: { type: 'string' } }, required: ['query'] },
    }] : []),
    {
      name: 'give_upgrades',
      description: 'Your answer: the overall read and the suggestions, most important first. Ends the turn.',
      input_schema: {
        type: 'object' as const,
        properties: {
          read: { type: 'string', description: 'Two or three sentences on the deck as it stands; on a later list, what changed and why.' },
          suggestions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' }, job: { type: 'string', description: 'The job it does in this deck, in a few words.' }, why: { type: 'string' },
                replaces: { type: 'string', description: 'The exact name of the main-deck card it replaces.' }, replaces_why: { type: 'string' },
                source: { type: 'string', enum: ['mine', 'buy'] },
              },
              required: ['name', 'job', 'why', 'replaces', 'replaces_why'],
            },
          },
        },
        required: ['read', 'suggestions'],
      },
    },
  ];
}

export type Call = (params: ClaudeParams, step: string) => Promise<Anthropic.Beta.BetaMessage>;

/** Where the owner's copy of a card is, by the app; null for a card they don't have. */
export function ownOf(h: Held | undefined): Exclude<UpgradeOwn, { kind: 'buy' }> | null {
  if (!h) return null;
  if (h.boxes > 0) return { kind: 'spare' };
  if (h.here) return { kind: 'section', section: h.sections[0] ?? 'Maybeboard' };
  if (h.decks.length) return { kind: 'deck', deck: h.decks[0] };
  return null;
}

interface Raw { name?: unknown; job?: unknown; why?: unknown; replaces?: unknown; replaces_why?: unknown; source?: unknown }

/**
 * Claude's suggestions, checked by the app (items 8 to 12). Every name is resolved (stored cards, then the card
 * data) and run through Tune's checks with the card it replaces leaving; ownership and price are the app's; a
 * replaced card that is the commander, never cut, or not in the main deck turns the row into an add. A name that
 * fails is dropped with why, and the count is shown; nothing is padded.
 */
export function checkUpgrades(raw: unknown, input: {
  ctx: Context; held: Map<string, Held>; need: number; taken: Set<string>; outsTaken: Set<string>;
  notForMe: Set<string>; sources: UpgradeSources; landsOk: boolean; resolve?: (names: string[]) => Map<string, ScryfallCard>;
}): { items: Array<Omit<StoredItem, 'mark'> & { card: ScryfallCard; outCard: ScryfallCard | null }>; dropped: Array<{ name: string; why: string }> } {
  const { ctx } = input;
  const list = (Array.isArray((raw as { suggestions?: unknown })?.suggestions) ? (raw as { suggestions: unknown[] }).suggestions : []) as Raw[];
  const names = list.map((s) => String(s?.name ?? '').trim()).filter(Boolean);
  const found = (input.resolve ?? cardsNamed)(names);
  const byFront = new Map<string, ScryfallCard>();
  for (const c of ctx.main.map((x) => x.card)) byFront.set(front(c.name), c);
  const items: Array<Omit<StoredItem, 'mark'> & { card: ScryfallCard; outCard: ScryfallCard | null }> = [];
  const dropped: Array<{ name: string; why: string }> = [];
  const used = new Set(input.taken);
  const outUsed = new Set(input.outsTaken);
  const owned = new Map([...input.held.values()].map((h) => [keyOf(h.card), h]));
  let gcRoom = gcRoomOf(ctx);
  const commanders = new Set(ctx.commanders.map((c) => front(c.name)));
  for (const s of list) {
    const name = String(s?.name ?? '').trim();
    if (!name) continue;
    const card = found.get(front(name));
    if (!card) { dropped.push({ name, why: 'not a card the app could find' }); continue; }
    const k = front(card.name);
    if (used.has(k)) continue;
    if (input.notForMe.has(k)) { dropped.push({ name: card.name, why: 'you said it’s not for you' }); continue; }
    if (isLand(card) && !input.landsOk) { dropped.push({ name: card.name, why: 'a land, and lands weren’t asked for' }); continue; }
    // The card it replaces: in the main deck, not the commander, not never cut, not already replaced by another row.
    const outName = String(s.replaces ?? '').trim();
    const outCard0 = outName ? byFront.get(front(outName)) ?? null : null;
    let outCard: ScryfallCard | null = outCard0;
    let outNote: string | undefined;
    if (outName && !outCard0) outNote = commanders.has(front(outName)) ? `Claude named ${outName}, the commander` : `Claude named ${outName}, which isn’t in the main deck`;
    else if (outCard0 && ctx.protectedWhy.has(outCard0.name)) { outNote = `Claude named ${outCard0.name}, which is ${ctx.protectedWhy.get(outCard0.name) === 'commander' ? 'the commander' : 'never cut'}`; outCard = null; }
    else if (outCard0 && outUsed.has(front(outCard0.name))) { outNote = `Claude named ${outCard0.name}, which another suggestion already replaces`; outCard = null; }
    else if (outCard0 && isLand(card) !== isLand(outCard0)) { outNote = `Claude named ${outCard0.name}; ${isLand(card) ? 'a land replaces a land' : 'a land is replaced only by a land'}`; outCard = null; }
    else if (!outName) outNote = 'Claude didn’t name a card to take out';
    const why = whyNotAddable(ctx, card, outCard);
    if (why) { dropped.push({ name: card.name, why: why.replace(`${card.name} `, '') }); continue; }
    const mine = ownOf(owned.get(keyOf(card)));
    if (!mine && input.sources === 'mine') { dropped.push({ name: card.name, why: 'not one of your cards, and this run is from your cards only' }); continue; }
    if (card.game_changer && gcRoom !== null) {
      const room = gcRoom + (outCard?.game_changer ? 1 : 0);
      if (room <= 0) { dropped.push({ name: card.name, why: `would put the deck past bracket ${ctx.plan.bracket}` }); continue; }
      gcRoom = room - 1;
    } else if (outCard?.game_changer && gcRoom !== null) gcRoom += 1;
    if (items.length >= input.need) continue;
    used.add(k);
    if (outCard) outUsed.add(front(outCard.name));
    items.push({
      name: card.name, cardId: card.id, card, outCard,
      job: String(s.job ?? '').trim().slice(0, 60) || 'upgrade',
      why: String(s.why ?? '').trim().slice(0, 300) || 'Claude’s pick',
      own: mine ?? { kind: 'buy', price: null },
      ...(mine && s.source === 'buy' ? { wasBuy: true } : {}),
      out: outCard ? { name: outCard.name, id: outCard.id, why: String(s.replaces_why ?? '').trim().slice(0, 200) } : null,
      ...(outNote && !outCard ? { outNote } : {}),
      warn: swapEffects(ctx, card, outCard),
    });
  }
  // Prices for the cards to buy, one helper for every screen (item 26). With a budget per card, a card with no
  // price can't be shown as within it (item 11): dropped and said.
  const buys = items.filter((i) => i.own.kind === 'buy');
  const prices = cardPrices(buys.map((i) => i.card), owned);
  const out: typeof items = [];
  for (const i of items) {
    if (i.own.kind !== 'buy') { out.push(i); continue; }
    const p = prices.get(keyOf(i.card)) ?? null;
    if (p === null && ctx.plan.budget !== null) { dropped.push({ name: i.name, why: `has no price, so it can’t be checked against your $${ctx.plan.budget} budget` }); continue; }
    out.push({ ...i, own: { kind: 'buy', price: p } });
  }
  return { items: out, dropped };
}

/** The conversation so far, in plain lines; nothing before the first list. */
function sessionLines(turns: Turn[]): string[] {
  if (!turns.some((t) => t.kind === 'claude')) return [];
  const out = ['', '## This conversation so far'];
  for (const t of turns) {
    if (t.kind === 'claude') out.push(`You, list ${t.round}: ${t.names.join(NAMES)}.${t.read ? ` You said: ${quote(t.read)}` : ''}`);
    else {
      const why = (m: { text: string }) => (m.text.trim() ? ` (${quote(m.text)})` : '');
      const parts = [
        ...t.marks.filter((m) => m.choice === 'ask').map((m) => `asked you to rethink ${m.name}${why(m) || ' (no reason given)'}`),
        ...t.marks.filter((m) => m.choice === 'skip').map((m) => `said not for me to ${m.name}${why(m)}`),
        ...t.marks.filter((m) => m.choice === 'in' && m.text.trim()).map((m) => `kept ${m.name}${why(m)}`),
        ...(t.message.trim() ? [`said: ${quote(t.message)}`] : []),
      ];
      out.push(`Owner: ${parts.length ? parts.join('; ') : 'asked for the list again'}.`);
    }
  }
  return out;
}

/** The combos the deck is one card away from, as findGroups looks them up: a time limit, failing soft. */
async function almostCombos(ctx: Context): Promise<Array<{ cards: string[]; produces: string[]; missing: string }>> {
  if (!ctx.list.commander) return [];
  try {
    const r = await Promise.race([
      combosInDeck({ commanders: ctx.commanders.map((c) => c.name), main: ctx.main.filter((c) => !ctx.commanders.includes(c.card)).map((c) => ({ name: c.card.name, quantity: 1 })) }),
      new Promise<null>((res) => setTimeout(() => res(null), 6000)),
    ]);
    return (r?.almost ?? []).filter((c) => c.missing.length === 1).slice(0, 25).map((c) => ({ cards: c.cards.filter((n) => n !== c.missing[0]), produces: c.produces.slice(0, 2), missing: c.missing[0] }));
  } catch { return []; }
}

/** The deck as Upgrades sends it: every main-deck card with its rules text, and Finish's reason on its picks. */
export function deckLines(ctx: Context, finishWhy: Map<string, string>): string[] {
  return ctx.main.filter((c) => c.slot !== 'partner').map((c) => {
    const why = finishWhy.get(c.card.name);
    const never = ctx.protectedWhy.get(c.card.name);
    return `- ${c.quantity > 1 ? `${c.quantity} ` : ''}${c.card.name} ${manaCostOf(c.card)} - ${typeLineOf(c.card)} - ${oracleTextOf(c.card).replace(/\n+/g, ' / ') || '(no text)'}${never ? ` [${never}]` : ''}${why ? ` (Finish picked it: ${why})` : ''}`;
  });
}

/**
 * One round: the first list, or (`rerun`) the owner's answer and the slots it opened. The searches are written
 * to the store as they run, for the page.
 */
export async function runUpgrades(call: Call, model: string, list: List, profileId: string, opts: { rerun?: boolean; message?: string } = {}, progress: (s: string) => void = () => {}): Promise<{ runId: string; items: number }> {
  progress('Reading the deck');
  const before = upgradesStore(list.id);
  const rerun = !!opts.rerun && !!before.run;
  const hadNot = new Set(before.notForMe.map((x) => front(x.name)));
  if (rerun) remember(before);
  const newNot = before.notForMe.filter((x) => !hadNot.has(front(x.name)));
  const ctx = await tuneContext(list, profileId);
  if (!list.commander) throw new ModelError('Set the commander first: what may go in follows its colours.');
  const held = heldCards(profileId, list.id);
  const ownOnly = ctx.plan.own;
  const sources: UpgradeSources = ownOnly ? 'mine' : before.sources;
  const notForMe = new Set(before.notForMe.map((x) => front(x.name)));
  const copies = finishStore(list.id).copies;
  const pool = sources === 'buy' ? null : finishPool(ctx, copies, held, { leaveOut: notForMe });
  const canSearch = !!pool && (pool.lines.length > 0 || pool.lands.lines.length > 0);
  if (sources === 'mine' && !canSearch) throw new ModelError(ownOnly ? 'None of your cards can go in this deck, and the plan says only cards you own. Check the budget and deck rule on the Plan tab.' : 'None of your cards can go in this deck. Try “Both” to include cards to buy.');
  const round = rerun ? before.run!.round + 1 : 1;
  const at = now();

  // What the owner's answer changes: the rows on Swap in stay, the rest open their slots.
  let turns: Turn[];
  let kept: StoredItem[] = [];
  let reply: Extract<Turn, { kind: 'owner' }> | null = null;
  const skipped = new Set(rerun ? before.skipped.map(front) : []);
  if (!rerun) turns = [];
  else {
    const items = before.run!.items;
    const choiceOf = (n: string) => before.choices[n]?.choice ?? 'in';
    reply = {
      kind: 'owner', at, message: (opts.message ?? '').trim().slice(0, 1500),
      marks: items.filter((i) => choiceOf(i.name) !== 'in' || before.choices[i.name]?.text?.trim()).map((i) => ({ name: i.name, choice: choiceOf(i.name), text: (before.choices[i.name]?.text ?? '').trim().slice(0, 300) })),
    };
    turns = [...before.turns, reply];
    kept = items.filter((i) => choiceOf(i.name) === 'in').map((i) => ({ ...i, mark: null }));
    for (const i of items) if (choiceOf(i.name) === 'skip') skipped.add(front(i.name));
  }
  // A kept row whose card is now in the deck, or whose replaced card left it, opens its slot.
  const inMain = new Set(ctx.main.map((c) => front(c.card.name)));
  kept = kept.filter((i) => !inMain.has(front(i.name)) && (!i.out || inMain.has(front(i.out.name))));
  const want = rerun ? before.run!.want : Math.max(1, Math.min(30, before.count));
  const need = Math.max(0, want - kept.length);
  if (rerun && !need && !reply?.message) throw new ModelError('Nothing to change: every suggestion is on Swap in. Mark one Rethink or Not for me, or say something.');
  const landsOk = asksForLands([opts.message ?? '', ...before.turns.filter((t): t is Extract<Turn, { kind: 'owner' }> => t.kind === 'owner').map((t) => t.message)].join(' '));

  progress('Looking up combos one card away');
  const combos = await almostCombos(ctx);
  const fs = finishStore(list.id);
  const finishWhy = new Map((fs.run?.items ?? fs.done?.session.run?.items ?? []).map((i) => [i.name, i.why] as const));
  const leaveOut = [...new Set([...before.notForMe.map((x) => x.name), ...(rerun ? [...before.skipped, ...(reply?.marks ?? []).filter((m) => m.choice === 'skip').map((m) => m.name)] : [])])];
  const deck = [
    `Commander: ${list.commander.name} ${manaCostOf(list.commander)} - ${typeLineOf(list.commander)}: ${oracleTextOf(list.commander).replace(/\n+/g, ' | ')}`,
    '',
    await planContext(list).catch(() => ''),
    '',
    `## The main deck (${ctx.size} with the commander), with rules text`,
    ...deckLines(ctx, finishWhy),
    ...(combos.length ? ['', '## Combos the deck is one card away from (found by the app)', ...combos.map((c) => `- ${c.missing} completes ${c.cards.join(' + ')} => ${c.produces.join(', ')}`)] : []),
    ...(before.notForMe.length ? ['', '## Not for me on this deck, with the owner\'s reasons (never suggest these; apply the reasons to similar cards)', ...before.notForMe.map((x) => `- ${x.name}${x.why ? `: ${quote(x.why)}` : ''}`)] : []),
  ].join('\n');
  const limit = round === 1 ? UPGRADE_SEARCHES : UPGRADE_SEARCHES_LATER;
  const sourceLine = sources === 'mine'
    ? (ownOnly ? 'Only the owner\'s cards: the plan says only cards they own. Don\'t name cards to buy.' : 'Only the owner\'s cards: they asked for suggestions from their cards. Don\'t name cards to buy.')
    : sources === 'buy' ? 'Only cards to buy, named from memory: no search this time.'
      : 'Both sources: the owner\'s cards (search) and cards they don\'t have (named from memory).';
  const task = [
    ...sessionLines(turns),
    ...(rerun ? [
      '',
      kept.length ? `## Kept (they stay; don't suggest them again, and don't replace the cards they replace)\n${kept.map((i) => `${i.name}${i.out ? ` for ${i.out.name}` : ''}`).join(NAMES)}` : '## Kept\nNothing.',
      ...(leaveOut.length ? ['', `## Not for me: never suggest these\n${leaveOut.join(NAMES)}`] : []),
    ] : []),
    '',
    '## The task',
    sourceLine,
    rerun
      ? `This is list ${round}. Give up to ${need} more suggestion${need === 1 ? '' : 's'} for the slots that opened.${canSearch && sources !== 'buy' ? ` You have ${limit} searches.` : ''}`
      : `Give up to ${want} suggestions, the most important first, each with the card it replaces.${canSearch && sources !== 'buy' ? ` You have ${limit} searches.` : ''}`,
    landsOk ? 'The owner asked about lands: land suggestions are welcome, each replacing a land.' : 'No lands.',
  ].join('\n').trim();

  const offer = { n: pool ? pool.lines.length : 0, colours: colourWords(ctx.identity), searched: canSearch && sources !== 'buy' };
  update(list.id, (s) => { if (!rerun) { s.searches = []; s.seen = []; } s.done = null; s.pending = round; s.offer = offer; });
  progress(rerun ? `Claude is reading your answer (list ${round})` : offer.searched ? 'Claude is searching your cards' : 'Claude is reading the deck');

  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: task }];
  const tools = upgradeTools(offer.searched);
  let used = 0;
  let answer: unknown = null;
  for (let step = 0; step < limit + 4 && answer === null; step++) {
    const message = await call({
      model, max_tokens: 16_000,
      system: [{ type: 'text', text: UPGRADES_SYSTEM }, { type: 'text', text: deck, cache_control: { type: 'ephemeral' } }],
      thinking: { type: 'adaptive' }, tools, messages,
    } as ClaudeParams, step === 0 ? `upgrades: ${round === 1 ? 'first list' : 'later list'}` : 'upgrades: search');
    const uses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    const give = uses.find((u) => u.name === 'give_upgrades');
    if (give) { answer = give.input; break; }
    if (message.stop_reason !== 'tool_use' || !uses.length) {
      const text = message.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n');
      const m = text.match(/\{[\s\S]*"suggestions"[\s\S]*\}/);
      if (m) { try { answer = JSON.parse(m[0]); } catch { /* not JSON */ } }
      break;
    }
    messages.push({ role: 'assistant', content: message.content as Anthropic.Beta.BetaContentBlockParam[] });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of uses) {
      const q = String((use.input as { query?: unknown })?.query ?? '').trim().slice(0, 200);
      if (use.name !== 'search' || !pool) { results.push({ type: 'tool_result', tool_use_id: use.id, content: 'Unknown tool.', is_error: true }); continue; }
      if (used >= limit) { results.push({ type: 'tool_result', tool_use_id: use.id, content: 'No searches left, give your answer now.' }); continue; }
      used += 1;
      const landAsk = parseQuery(q).types.some((t) => t.startsWith('land'));
      const r = searchLines(landAsk ? pool.lands.lines : pool.lines, q);
      const names = r.lines.map((l) => l.name);
      update(list.id, (s) => { s.searches.push({ q, n: r.total, round, names }); s.seen = [...new Set([...s.seen, ...names])]; });
      progress(`Search ${used} of ${limit}: ${q}`);
      results.push({ type: 'tool_result', tool_use_id: use.id, content: searchText(r) + (used >= limit ? '\n\nThat was your last search: give your answer now.' : '') });
    }
    // The newest result is the cache point, as in Finish: each call reads everything before it from the cache.
    for (const m of messages) if (m.role === 'user' && Array.isArray(m.content)) for (const b of m.content) delete (b as { cache_control?: unknown }).cache_control;
    if (results.length) results[results.length - 1] = { ...results[results.length - 1], cache_control: { type: 'ephemeral' } };
    messages.push({ role: 'user', content: results });
  }
  if (answer === null) throw new ModelError('Claude didn’t give its suggestions. Nothing was changed; try again.');

  const checked = checkUpgrades(answer, {
    ctx, held, need, taken: new Set(kept.map((i) => front(i.name))), outsTaken: new Set(kept.filter((i) => i.out).map((i) => front(i.out!.name))),
    notForMe: new Set([...notForMe, ...skipped]), sources, landsOk,
  });
  if (!checked.items.length && !kept.length) {
    throw new ModelError(`None of Claude’s suggestions could be used${checked.dropped.length ? ` (${checked.dropped.slice(0, 4).map((d) => `${d.name}: ${d.why}`).join('; ')})` : ''}. Nothing was saved; try again.`);
  }
  const asked = new Set((reply?.marks ?? []).filter((m) => m.choice === 'ask').map((m) => front(m.name)));
  const fresh: StoredItem[] = checked.items.map((x) => { const { card, outCard, ...i } = x; void card; void outCard; return { ...i, mark: rerun ? (asked.has(front(i.name)) ? 'back' as const : 'new' as const) : null }; });
  const items = [...kept, ...fresh];
  const read = String((answer as { read?: unknown }).read ?? '').trim().slice(0, 1200);
  let changes: UpgradeChanges | undefined;
  if (rerun) {
    const nowSet = new Set(items.map((i) => front(i.name)));
    const was = new Set(before.run!.items.map((i) => front(i.name)));
    const because = (n: string): UpgradeChanges['out'][number]['because'] => {
      const c = before.choices[n]?.choice ?? 'in';
      return c === 'skip' ? 'skipped' : c === 'ask' ? 'rethink' : 'gone';
    };
    changes = {
      round,
      out: before.run!.items.filter((i) => !nowSet.has(front(i.name))).map((i) => ({ name: i.name, because: because(i.name) })),
      in: fresh.filter((i) => !was.has(front(i.name))).map((i) => i.name),
      back: fresh.filter((i) => i.mark === 'back').map((i) => i.name),
    };
  }
  const run: Run = { id: randomUUID(), at: now(), model, round, want, read, items, dropped: checked.dropped, ...(changes ? { changes } : {}) };
  update(list.id, (s) => {
    s.run = run;
    s.choices = {};
    s.notForMe = [...s.notForMe, ...newNot.filter((x) => !s.notForMe.some((y) => front(y.name) === front(x.name)))];
    s.skipped = rerun ? [...new Set([...before.skipped, ...(reply?.marks ?? []).filter((m) => m.choice === 'skip').map((m) => m.name)])] : [];
    s.turns = [...turns, { kind: 'claude', round, names: items.map((i) => i.name), read, at: run.at }];
    s.done = null;
    s.pending = null;
  });
  recordRound(round === 1 ? 'first' : 'later', at, profileId, list.name);
  return { runId: run.id, items: items.length };
}

// --- apply and undo ---------------------------------------------------------------------

/** The card itself, for a row: stored first (any printing the app holds), then the card data. */
function cardFor(item: StoredItem): ScryfallCard | null {
  const r = database().get('SELECT data FROM cards WHERE id = ?', [item.cardId]) as { data: string } | null;
  return r ? JSON.parse(r.data) as ScryfallCard : cardsNamed([item.name]).get(front(item.name)) ?? null;
}

/**
 * Apply: each row on Swap in goes into the main deck (from the section it waits in, else as a new row: a card to
 * buy goes straight in, the owner's call) and the card it replaces moves to the cuts section; a row set to
 * "Maybeboard instead" goes to the Maybeboard and nothing comes out. Every touched row's state before is kept, so
 * Undo is exact. The caller takes the snapshot.
 */
export async function applyUpgrades(list: List, profileId: string): Promise<NonNullable<UpgradesView['done']>> {
  const s = upgradesStore(list.id);
  if (!s.run) throw new Error('There are no suggestions to apply');
  const names = new Set(chosenIn(s.run.items, s.choices));
  const rows = s.run.items.filter((i) => names.has(i.name));
  if (!rows.length) throw new Error('Nothing to apply: put at least one card on Swap in');
  const ctx = await tuneContext(list, profileId);
  const sections = sectionsOf(list.id);
  const cutsTo = cutBoard(sections);
  const maybeTo = sections.find((x) => x.purpose === 'in')?.id ?? 'maybe';
  const undo: Done['undo'] = [];
  const touched = new Set<string>();
  const keep = (cardId: string, before: CardBefore) => { if (!touched.has(cardId)) { touched.add(cardId); undo.push({ cardId, before }); } };
  let swapped = 0;
  let maybe = 0;
  const buy: Done['buy'] = [];
  for (const i of rows) {
    const card = cardFor(i);
    if (!card) continue;
    const where: UpgradeWhere = s.choices[i.name]?.where ?? 'swap';
    const all = cardsInList(list.id);
    if (where === 'maybe') {
      if (all.some((c) => front(c.card.name) === front(card.name))) continue;
      keep(card.id, addCardToList(list.id, card, 1, 'nonfoil', maybeTo));
      maybe += 1;
      continue;
    }
    if (all.some((c) => c.board === 'main' && front(c.card.name) === front(card.name))) continue;
    // In: from the section it waits in, as it is; anything else a new row.
    const row = all.find((c) => front(c.card.name) === front(card.name) && c.board !== 'main');
    if (row) { keep(row.card.id, { quantity: row.quantity, board: row.board }); updateListCard(list.id, row.card.id, { board: 'main' }); }
    else keep(card.id, addCardToList(list.id, card, 1, 'nonfoil', 'main'));
    // Out: to the cuts section (one copy of a card held in several just lowers the count).
    if (i.out && !ctx.protectedWhy.has(i.out.name)) {
      const o = cardsInList(list.id).find((c) => c.board === 'main' && front(c.card.name) === front(i.out!.name));
      if (o) {
        keep(o.card.id, { quantity: o.quantity, board: 'main' });
        if (o.quantity > 1) setQuantity(list.id, o.card.id, o.quantity - 1);
        else updateListCard(list.id, o.card.id, { board: cutsTo });
      }
    }
    swapped += 1;
    if (i.own.kind === 'buy') buy.push({ name: i.name, price: i.own.price });
  }
  const size = cardsInList(list.id).filter((c) => c.board === 'main').reduce((n, c) => n + c.quantity, 0) + (list.commander ? 1 : 0);
  const done: Done = {
    at: now(), swapped, maybe, size, cutsTo: sections.find((x) => x.id === cutsTo)?.name ?? 'Sideboard', buy, remembered: [], undo,
    session: { run: s.run, choices: s.choices, skipped: s.skipped, turns: s.turns, searches: s.searches, seen: s.seen },
  };
  update(list.id, (x) => { done.remembered = remember(x); x.done = done; x.run = null; x.choices = {}; x.turns = []; x.skipped = []; x.searches = []; x.seen = []; });
  return { at: done.at, swapped, maybe, size, cutsTo: done.cutsTo, buy };
}

/** Put every row the apply touched back exactly as it was, and bring the conversation back. */
export function undoUpgrades(list: List): { moved: number } {
  const s = upgradesStore(list.id);
  if (!s.done) return { moved: 0 };
  for (const u of [...s.done.undo].reverse()) {
    const row = cardsInList(list.id).find((c) => c.card.id === u.cardId);
    if (u.before === null) { if (row) setQuantity(list.id, u.cardId, 0); continue; }
    if (!row) continue;
    if (row.board !== u.before.board) updateListCard(list.id, u.cardId, { board: u.before.board });
    if (row.quantity !== u.before.quantity) setQuantity(list.id, u.cardId, u.before.quantity);
  }
  const moved = s.done.undo.length;
  update(list.id, (x) => {
    const back = new Set((x.done!.remembered ?? []).map(front));
    x.notForMe = x.notForMe.filter((y) => !back.has(front(y.name)));
    Object.assign(x, x.done!.session);
    x.done = null;
  });
  return { moved };
}

// --- the view -------------------------------------------------------------------------------

/**
 * What a round costs. No real run exists yet: a guess from Finish's real numbers (a first list of 62 with 25
 * searches $0.41-0.48; a later round $0.05-0.16), scaled for 10 searches and 10 suggestions; the measured average
 * of this app's own rounds takes over after three of a kind, as Finish does.
 */
const GUESS = { first: { base: 0.12, perCard: 0.012 }, later: { base: 0.04, perCard: 0.006 } };
const ROUNDS_KEY = 'upgrades.rounds';
const measured = (): MeasuredRound[] => { try { return JSON.parse(getSetting(ROUNDS_KEY) ?? '[]') as MeasuredRound[]; } catch { return []; } };
function recordRound(kind: 'first' | 'later', since: string, profileId: string, label: string): void {
  const cost = aiCalls(since, 500).filter((c) => c.profileId === profileId && c.label === label && c.step.startsWith('upgrades:') && c.outcome === 'ok').reduce((n, c) => n + c.cost, 0);
  if (cost <= 0) return;
  setSetting(ROUNDS_KEY, JSON.stringify([...measured(), { kind, cost, at: now() }].slice(-60)));
}
function roundCosts(): UpgradesView['cost'] {
  const m = averageRounds(measured().filter((r) => Date.parse(r.at) > Date.now() - 30 * 86400_000));
  const one = (k: 'first' | 'later') => (m[k] !== null ? { usd: m[k]!, measured: true } : { usd: GUESS[k].base + GUESS[k].perCard * UPGRADE_DEFAULT, measured: false, ...GUESS[k] });
  return { first: one('first'), later: one('later') };
}

export async function upgradesView(list: List, profileId: string): Promise<UpgradesView> {
  const s = upgradesStore(list.id);
  const job = latestJob('upgrades', list.id);
  const running = job?.status === 'running';
  const ctx = await tuneContext(list, profileId);
  const po = planOwner(list.id);
  const byId = new Map<string, ScryfallCard>();
  if (s.run) {
    const ids = [...new Set(s.run.items.map((i) => i.cardId))];
    for (const r of database().all(`SELECT id, data FROM cards WHERE id IN (${ids.map(() => '?').join(',') || "''"})`, ids) as Array<{ id: string; data: string }>) byId.set(r.id, JSON.parse(r.data) as ScryfallCard);
    const missing = s.run.items.filter((i) => !byId.has(i.cardId));
    if (missing.length) for (const [, c] of cardsNamed(missing.map((i) => i.name))) { const i = missing.find((x) => front(x.name) === front(c.name)); if (i) byId.set(i.cardId, c); }
  }
  const items: UpgradeItem[] = (s.run?.items ?? []).map(({ cardId, ...i }) => {
    const c = byId.get(cardId);
    const o = i.out ? ctx.main.find((m) => front(m.card.name) === front(i.out!.name))?.card : undefined;
    return { ...i, out: i.out ? { ...i.out, image: o ? imageOf(o, 'normal') : null } : null, card: { id: cardId, image: c ? imageOf(c, 'normal') : null, manaCost: c ? manaCostOf(c) : '', typeLine: c ? typeLineOf(c) : '', text: c ? oracleTextOf(c) : '', cmc: c?.cmc ?? 0, land: c ? isLand(c) : false } };
  });
  return {
    size: ctx.size,
    count: s.count,
    sources: ctx.plan.own ? 'mine' : s.sources,
    ownOnly: ctx.plan.own,
    plan: { text: po.planText.trim() || null, confirmed: !!po.confirmedAt, budget: ctx.plan.budget },
    run: s.run ? { id: s.run.id, at: s.run.at, round: s.run.round, model: s.run.model, want: s.run.want, read: s.run.read, items, dropped: s.run.dropped, changes: s.run.changes ?? null } : null,
    choices: s.choices,
    notForMe: s.notForMe,
    offer: s.offer,
    searches: s.searches.filter((x) => x.round === (running && s.pending ? s.pending : s.run?.round ?? 1)).map(({ q, n, round }) => ({ q, n, round })),
    job: job && (running || (job.status === 'failed' && (!s.run || job.startedAt > s.run.at))) ? { status: job.status as 'running' | 'failed', detail: job.detail || null, error: job.status === 'failed' ? job.error ?? 'Claude didn’t finish' : null } : null,
    done: s.done ? { at: s.done.at, swapped: s.done.swapped, maybe: s.done.maybe, size: s.done.size, cutsTo: s.done.cutsTo, buy: s.done.buy } : null,
    cost: roundCosts(),
    noKey: !process.env.ANTHROPIC_API_KEY,
  };
}
