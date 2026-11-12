/**
 * Trim: cutting a deck that is over 100 cards down to 100 (the deck flow
 * plan, step 4a). Three steps, each kept with the deck so leaving the page
 * loses nothing:
 *
 *   1. An approach: a few lines on where the cuts come from and what is
 *      protected. Drafted by code from the deck's numbers (free), written by
 *      Claude from the saved plan, or written by the owner. Skippable.
 *   2. A ranked list from Claude: about twice as many cards as the deck is
 *      over, most cuttable first. Its first N are the cuts, already chosen;
 *      the rest are closer calls. The method the deck flow evaluation
 *      measured (a ranked 2N list read against the plan pass): Opus 0.74 on
 *      the judge with 2% harmful cuts, Haiku on the Opus plan 0.66 and 6%,
 *      the rules list 0.48 and 20%.
 *   3. The owner's choices, each with an optional reason, then apply: the
 *      cards move to the section for cards that came out, after a snapshot.
 *
 * Code decides what the model may not: never the commanders or a ★ card,
 * never a land under the land floor, the count. Engines and key cards from
 * the plan read are flagged, not blocked. What the owner kept or cut, and
 * why, is remembered for the deck and sent with every later list; a rerun
 * sends the choices made so far and leaves the approach as it is.
 *
 * Everything shown and what became of it goes to the suggestion log. Server
 * only.
 */

import { randomUUID } from 'node:crypto';

import { ModelError, type JsonModel } from './ai';
import { guardCuts } from './cut-guard';
import { cardsInList, database, type List } from './db';
import { deckHash } from './deck-hash';
import { changePlan } from './deck-plan';
import { setKeep } from './deck-roles';
import { latestJob } from './jobs';
import { planContext } from './plan-context';
import { owner as planOwner } from './plan-help';
import { planFacts } from './plan-facts';
import { PROMPT_VERSIONS } from './prompt-versions';
import { cutBoard } from './sections-shared';
import { imageOf, manaCostOf, oracleTextOf, typeLineOf, type ScryfallCard } from './scryfall';
import { clearOutcome, closeAll, logConversation, logOutcome, logShown, quietly, type ReasonChip } from './suggestion-log';
import { applyCuts, cutImpact, landFloor, tuneContext, undoApply, type Context, type UndoMoves } from './tune';
import { tuneStore } from './tune-store';
import {
  chosenCuts, isTrimChip, saidSomething, TRIM_COST_GUESS, TRIM_MODELS,
  type TrimApproach, type TrimChoice, type TrimDone, type TrimItem, type TrimModel, type TrimTier, type TrimView,
} from './trim-shared';
import type { Board } from './decklist';

const front = (n: string) => n.split(' // ')[0].trim().toLowerCase();
const isLand = (c: ScryfallCard) => /\bLand\b/.test((c.type_line ?? '').split('//')[0]);
const now = () => new Date().toISOString();

/** How many closer calls to ask for beyond the cuts: as many again, between 6 and 15. */
export const extraFor = (over: number) => Math.max(6, Math.min(over, 15));

// --- kept with the deck ---------------------------------------------------------------

interface StoredItem { name: string; tier: TrimTier; why: string; with: string[] }
interface Run { id: string; at: string; model: string; round: number; deckHash: string; planPassId: string | null; over: number; notes: string; items: StoredItem[] }
/** What the owner said about a card on this deck, kept across lists. */
export interface Said { choice: 'cut' | 'keep'; chip: string | null; text: string; at: string }

export interface TrimStore {
  approach: TrimApproach | null;
  correction: string;
  model: TrimModel;
  run: Run | null;
  choices: Record<string, TrimChoice>;
  said: Record<string, Said>;
  done: TrimDone | null;
}

const EMPTY: TrimStore = { approach: null, correction: '', model: 'opus', run: null, choices: {}, said: {}, done: null };

let ready = false;
function db() {
  const d = database();
  if (!ready) {
    d.run(`CREATE TABLE IF NOT EXISTS deck_trim (listId TEXT PRIMARY KEY, state TEXT NOT NULL DEFAULT '{}', updatedAt TEXT NOT NULL)`);
    ready = true;
  }
  return d;
}

export function trimStore(listId: string): TrimStore {
  const r = db().get('SELECT state FROM deck_trim WHERE listId = ?', [listId]) as { state: string } | null;
  if (!r) return structuredClone(EMPTY);
  try { return { ...structuredClone(EMPTY), ...(JSON.parse(r.state) as Partial<TrimStore>) }; } catch { return structuredClone(EMPTY); }
}

function update(listId: string, change: (s: TrimStore) => void): TrimStore {
  const s = trimStore(listId);
  change(s);
  db().run(`INSERT INTO deck_trim (listId, state, updatedAt) VALUES (?, ?, ?)
    ON CONFLICT(listId) DO UPDATE SET state = excluded.state, updatedAt = excluded.updatedAt`, [listId, JSON.stringify(s), now()]);
  return s;
}

export function dropTrim(listId: string): void {
  db().run('DELETE FROM deck_trim WHERE listId = ?', [listId]);
}

// --- the approach -----------------------------------------------------------------------

/**
 * An approach from the deck's own numbers and its plan read, no model: where
 * the deck is over its usual ranges, where it is short, what the plan says
 * to look at last. Untested against a Claude-written one; it is a starting
 * point the owner can edit.
 */
export function draftApproach(ctx: Context): string {
  const over = Math.max(0, ctx.size - 100);
  const n = (x: number) => String(Math.round(x * 10) / 10);
  const jobs = ctx.jobs.filter((j) => j.range && j.id !== 'impulse' && j.id !== 'wipe');
  const high = jobs.filter((j) => j.count > j.range![1]).sort((a, b) => (b.count - b.range![1]) - (a.count - a.range![1]));
  const low = jobs.filter((j) => j.count < j.range![0]);
  const L: string[] = [];
  high.forEach((j, i) => L.push(`${j.label}: ${n(j.count)}, usual ${j.range![0]} to ${j.range![1]}. ${i === 0 ? 'Most cuts come from here.' : `Up to ${Math.max(1, Math.floor(j.count - j.range![1]))} from here.`}`));
  for (const j of low) L.push(`${j.label}: ${n(j.count)}, usual ${j.range![0]} to ${j.range![1]}. None from here.`);
  const lands = ctx.plan.landNumber.have;
  const [lo, hi] = ctx.plan.lands;
  L.push(lands > hi ? `Lands: ${n(lands)}, usual ${lo} to ${hi}. Up to ${Math.floor(lands - hi)} from here.` : `Lands: ${n(lands)}, usual ${lo} to ${hi}. None.`);
  if (!high.length) L.push('No job is over its usual range, so the cuts are the cards that do least for the plan.');
  const strong = [...ctx.flags.values()].filter((f) => f.strong);
  const engines = strong.filter((f) => f.flag.startsWith('Engine')).length;
  if (strong.length) L.push(`Looked at last: the ${engines ? `${engines} engine card${engines === 1 ? '' : 's'} and ` : ''}${strong.length - engines} key card${strong.length - engines === 1 ? '' : 's'} in the plan.`);
  const starred = [...ctx.protectedWhy.values()].filter((w) => w.startsWith('★')).length;
  L.push(`Never offered: the commander${ctx.commanders.length > 1 ? 's' : ''}${starred ? ` and your ${starred} ★ card${starred === 1 ? '' : 's'}` : ''}.`);
  return [`Cut ${over} to reach 100.`, ...L].map((l) => `- ${l}`).join('\n');
}

const APPROACH_SYSTEM = `You are an experienced Commander deckbuilder inside a deck app. The owner's deck is over 100 cards and they are about to ask for a cut list. Write the approach for those cuts: 3 to 5 short bullets, each with numbers where they apply, saying where the cuts should come from and what stays protected, for THIS deck. Follow the deck's plan and what the owner has told the app; the owner outranks your own reading. Name a card only as an example. No card-by-card list: that comes next. Plain words a player would say at the table.`;

const APPROACH_SCHEMA = { type: 'OBJECT', properties: { bullets: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['bullets'] };

/** Claude's approach, from the plan as later AI steps read it (the plan read when current) and the deck's numbers. */
export async function writeApproach(model: JsonModel, list: List, profileId: string): Promise<TrimApproach> {
  const ctx = await tuneContext(list, profileId);
  const over = Math.max(0, ctx.size - 100);
  const read = planOwner(list.id).planText.trim();
  const s = trimStore(list.id);
  const user = [
    `The deck has ${ctx.size} cards including the commander: ${over} to cut.`,
    '',
    await planContext(list),
    // With no current plan read, the cards themselves are the only way to tell what the deck does.
    ...(read ? [] : ['', 'Every card in the deck:', ...ctx.main.map((c) => `- ${c.card.name} ${manaCostOf(c.card)} - ${typeLineOf(c.card)} - ${oracleTextOf(c.card).replace(/\n+/g, ' / ') || '(no text)'}`)]),
    ...saidLines(s, new Set(ctx.main.map((c) => c.card.name))),
  ].join('\n');
  const answer = await model({ step: 'trim: write the approach', system: APPROACH_SYSTEM, user, schema: APPROACH_SCHEMA, thinking: 'low' }, { maxBusy: 1 });
  const bullets = ((answer.data as { bullets?: unknown })?.bullets as unknown[] | undefined ?? []).filter((b): b is string => typeof b === 'string' && !!b.trim()).slice(0, 6);
  if (!bullets.length) throw new ModelError('The approach came back empty. Nothing was saved; try again, or write your own.');
  const approach: TrimApproach = { text: bullets.map((b) => `- ${b.trim().replace(/^[-•]\s*/, '').slice(0, 400)}`).join('\n'), by: 'claude', at: now() };
  update(list.id, (x) => { x.approach = approach; });
  quietly(() => logConversation(profileId, list.id, 'trim', 'approach_shown', approach.text, PROMPT_VERSIONS.trimApproach));
  return approach;
}

/** The approach the owner wrote, the code's draft, or none. */
export async function setApproach(list: List, profileId: string, input: { text?: string; draft?: boolean; clear?: boolean }): Promise<void> {
  if (input.clear) { update(list.id, (s) => { s.approach = null; }); return; }
  if (input.draft) {
    const text = draftApproach(await tuneContext(list, profileId));
    update(list.id, (s) => { s.approach = { text, by: 'code', at: now() }; });
    quietly(() => logConversation(profileId, list.id, 'trim', 'approach_shown', text, 'code'));
    return;
  }
  const text = (input.text ?? '').trim().slice(0, 2000);
  if (!text) return;
  const before = trimStore(list.id).approach;
  // Editing a draft or Claude's approach makes it the owner's; the log keeps that they corrected it.
  update(list.id, (s) => { s.approach = { text, by: 'owner', at: now() }; });
  if (before?.text !== text) quietly(() => logConversation(profileId, list.id, 'trim', 'approach_corrected', text, before?.by === 'claude' ? PROMPT_VERSIONS.trimApproach : null));
}

// --- the cut list --------------------------------------------------------------------------

export const TRIM_SYSTEM = `You are an experienced Commander deckbuilder inside a deck app, helping the owner trim a deck that is over 100 cards. You get the deck's facts (the commander, numbers the app's code worked out on this exact list, and every card with its rules text); the deck's plan when one has been read (how it wins, key cards, themes and a role for cards: a strong starting point, not infallible); what the owner has told the app; the approach for these cuts when there is one; and what the owner decided on earlier lists.

The owner picks their cuts from your list. Give:
- ranked: the number of cards the task asks for, most cuttable first. Your first N (the number the deck is over) are your own recommended cuts; the rest are the closer calls, in order. For each: "why", one or two short sentences a player would say at the table, about this card in this deck; and "with", the other cards in the deck it works with (empty when none matter to the call).
- keep: up to 5 cards a quick look would cut (over a usual range, weak on their own, expensive) that should stay, each with why. Only where it is not obvious.
- notes: 2 or 3 sentences: where the cuts come from and what you protected.

How to rank:
- Use your own judgement: what the commander and the owner want, the deck's plan and its combos, the curve, and the jobs every deck needs.
- Where an approach is given, follow it. The owner's own words (their approach, notes and reasons) outrank your reading of the deck.
- The owner's earlier decisions stand. Never list a card they chose to keep. Where they said why, apply the same reasoning to similar cards.
- Never list a commander or a card marked never cut. List a land only when the task says lands may be cut.
- A combo piece or an engine goes only with a clear reason, said in its "why". Say what breaks.
- The numbers are facts the code worked out, not judgements; many good decks sit outside the usual ranges on purpose.
- Use card names exactly as they appear in the list.
- Think it through privately; the answer holds only the fields asked for.`;

const TRIM_SCHEMA = {
  type: 'OBJECT',
  properties: {
    ranked: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, why: { type: 'STRING' }, with: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['name', 'why', 'with'] } },
    keep: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, why: { type: 'STRING' } }, required: ['name', 'why'] } },
    notes: { type: 'STRING' },
  },
  required: ['ranked', 'keep', 'notes'],
};

const CHIP_WORDS: Record<string, string> = { pet_card: 'a pet card', part_of_plan: 'part of my plan', already_tried: 'I tried cutting it before', too_slow: 'too slow', off_plan: 'off-plan', have_better: 'I have better' };
const reasonOf = (c: { chip?: string | null; text?: string }) => [c.chip ? CHIP_WORDS[c.chip] ?? c.chip : '', c.text?.trim() ?? ''].filter(Boolean).join(': ');

/** What the owner decided before on this deck, for the model: cards still in the deck they kept, and cards they cut. */
function saidLines(s: TrimStore, main: Set<string>): string[] {
  const kept = Object.entries(s.said).filter(([n, v]) => v.choice === 'keep' && main.has(n));
  const cut = Object.entries(s.said).filter(([, v]) => v.choice === 'cut').slice(-40);
  if (!kept.length && !cut.length) return [];
  const line = ([n, v]: [string, Said]) => `- ${n}${reasonOf(v) ? ` ("${reasonOf(v)}")` : ''}`;
  return [
    '', '## What the owner decided on earlier cut lists for this deck',
    ...(kept.length ? ['Kept, not to be listed again:', ...kept.slice(-60).map(line)] : []),
    ...(cut.length ? ['Cut:', ...cut.map(line)] : []),
  ];
}

/** The choices made on the list on screen, for a rerun. */
function choiceLines(s: TrimStore): string[] {
  if (!s.run) return [];
  const byName = new Map(s.run.items.map((i) => [i.name, i]));
  const rows = Object.entries(s.choices).filter(([n]) => byName.has(n));
  if (!rows.length) return [];
  return [
    '', '## The list you gave last, and what the owner did with it',
    `Your cuts were: ${s.run.items.filter((i) => i.tier === 'cut').map((i) => i.name).join(', ')}.`,
    ...rows.map(([n, c]) => `- ${n}: the owner ${c.choice === 'keep' ? 'keeps it' : 'cuts it'}${reasonOf(c) ? ` ("${reasonOf(c)}")` : ''}`),
    'Give a new list with these choices taken as settled.',
  ];
}

/** Everything the cut list call is sent, and what the parse needs. */
export async function trimMessage(list: List, profileId: string, s: TrimStore = trimStore(list.id)): Promise<{ user: string; ctx: Context; over: number; ask: number; planPassId: string | null; landsFree: number }> {
  const ctx = await tuneContext(list, profileId);
  const over = Math.max(0, ctx.size - 100);
  const ask = over + extraFor(over);
  const { md } = await planFacts(list, list.id, list.name, ctx.commanders.map((c) => c.name));
  const main = new Set(ctx.main.map((c) => c.card.name));
  const store = tuneStore(list.id);
  const out = ctx.all.filter((c) => ctx.sections.find((x) => x.id === c.board)?.purpose === 'out');
  const landsFree = Math.max(0, Math.floor(ctx.plan.landNumber.have - landFloor(ctx)));
  const never = [...ctx.protectedWhy.entries()].filter(([, w]) => w !== 'commander');
  const user = [
    md,
    '',
    // The block every AI step reads: the confirmed plan with who set each part, never-cut, every category with who added it, and the rules.
    await planContext(list),
    ...(never.length ? ['', `## Never cut\n${never.map(([n, w]) => `${n} (${w})`).join(', ')}`] : []),
    ...(s.approach ? ['', `## The approach for these cuts (${s.approach.by === 'owner' ? "the owner's own words" : s.approach.by === 'claude' ? 'written by you earlier, seen by the owner' : "drafted by the app from the numbers, seen by the owner"})`, s.approach.text] : []),
    ...(s.correction.trim() ? ['', `## The owner adds\n"""\n${s.correction.trim()}\n"""`] : []),
    ...saidLines(s, main),
    ...choiceLines(s),
    ...(out.length ? ['', `## Cards that came out of this deck before\n${out.slice(0, 60).map((c) => `${c.card.name}${store.cutReasons[c.card.name]?.why ? ` (${store.cutReasons[c.card.name].why.slice(0, 80)})` : ''}`).join('; ')}`] : []),
    ...(ctx.pool.length ? ['', `## Waiting in the owner's maybeboard\n${ctx.pool.slice(0, 60).map((c) => c.card.name).join(', ')}`] : []),
    '',
    '## The task',
    `The deck has ${ctx.size} cards including the commander${ctx.commanders.length > 1 ? 's' : ''}; a Commander deck is exactly 100. It is ${over} over.`,
    `Rank exactly ${ask} cards, most cuttable first: your first ${over} are your cuts, the other ${ask - over} the closer calls.`,
    landsFree > 0 ? `Lands: at most ${landsFree} may be listed; fewer than ${Math.ceil(landFloor(ctx))} lands is not allowed.` : 'Lands: none may be listed; the deck is at or under the fewest lands it should have.',
  ].join('\n');
  return { user, ctx, over, ask, planPassId: planOwner(list.id).confirmedAt, landsFree };
}

/**
 * The model's answer as the list the owner sees: names kept to cards in the
 * main deck, the commanders and ★ cards out, lands held to the land floor,
 * the owner's settled choices applied, then the first N as cuts and the rest
 * as closer calls. Throws when too few usable cards came back to make N cuts.
 */
export function parseTrim(data: unknown, ctx: Context, s: TrimStore, over: number): { items: StoredItem[]; notes: string } {
  const d = (data ?? {}) as { ranked?: unknown; keep?: unknown; notes?: unknown };
  const cards = ctx.main.filter((c) => c.slot !== 'partner');
  const byFront = new Map(cards.map((c) => [front(c.card.name), c.card]));
  const rows = (xs: unknown) => (Array.isArray(xs) ? xs : []).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => ({ card: byFront.get(front(String(x.name ?? ''))), why: String(x.why ?? '').trim().slice(0, 400), with: (Array.isArray(x.with) ? x.with : []).map((w) => byFront.get(front(String(w)))?.name).filter((w): w is string => !!w).slice(0, 6) }))
    .filter((x): x is { card: ScryfallCard; why: string; with: string[] } => !!x.card);
  // The owner's settled choices on the list before: kept cards never come back, cuts stay cuts.
  const keptByOwner = new Set([...Object.entries(s.choices).filter(([, c]) => c.choice === 'keep').map(([n]) => n), ...Object.entries(s.said).filter(([, v]) => v.choice === 'keep').map(([n]) => n)]);
  const fixed = Object.entries(s.choices).filter(([n, c]) => c.choice === 'cut' && byFront.has(front(n))).map(([n]) => n);
  const ranked = rows(d.ranked).filter((r) => !keptByOwner.has(r.card.name));
  const guarded = guardCuts(ranked.map((r) => ({ name: r.card.name, land: isLand(r.card), row: r })), { count: null, lands: { have: ctx.plan.landNumber.have, floor: landFloor(ctx) }, never: ctx.protectedWhy }).kept.map((k) => k.row);
  const oldWhy = new Map((s.run?.items ?? []).map((i) => [i.name, i]));
  const first = fixed.map((n) => guarded.find((r) => r.card.name === n) ?? { card: byFront.get(front(n))!, why: oldWhy.get(n)?.why ?? 'You chose to cut it.', with: oldWhy.get(n)?.with ?? [] });
  const rest = guarded.filter((r) => !fixed.includes(r.card.name));
  const all = [...first, ...rest];
  if (all.length < over) throw new ModelError(`The list came back with ${all.length} usable cards for ${over} cuts. Nothing was saved; try again.`);
  const listed = new Set(all.map((r) => r.card.name));
  const items: StoredItem[] = all.map((r, i) => ({ name: r.card.name, tier: i < over ? 'cut' : 'maybe', why: r.why, with: r.with }));
  for (const k of rows(d.keep).filter((r) => !listed.has(r.card.name) && !ctx.protectedWhy.has(r.card.name) && !keptByOwner.has(r.card.name)).slice(0, 5)) items.push({ name: k.card.name, tier: 'kept', why: k.why, with: [] });
  // What the owner kept from the list before stays in view, under its own heading.
  if (s.run) for (const [n, c] of Object.entries(s.choices)) if (c.choice === 'keep' && byFront.has(front(n)) && oldWhy.has(n)) items.push({ name: n, tier: 'yours', why: oldWhy.get(n)!.why, with: oldWhy.get(n)!.with });
  return { items, notes: String(d.notes ?? '').trim().slice(0, 800) };
}

/** Fold the choices on the list into what is remembered for the deck, and ★ the pet cards. */
function remember(list: Pick<List, 'id'>, s: TrimStore): void {
  if (!s.run) return;
  const byName = new Map(s.run.items.map((i) => [i.name, i]));
  const main = cardsInList(list.id).filter((c) => c.board === 'main');
  for (const [name, c] of Object.entries(s.choices)) {
    const item = byName.get(name);
    if (!item || !saidSomething(item as TrimItem, c)) continue;
    s.said[name] = { choice: c.choice, chip: c.chip ?? null, text: c.text?.trim().slice(0, 300) ?? '', at: now() };
    // "Pet card" is the owner saying never cut it: it joins the ★ list, where it can be taken off again.
    if (c.choice === 'keep' && c.chip === 'pet_card') {
      const card = main.find((m) => m.card.name === name)?.card;
      if (card) setKeep(list.id, card.oracle_id ?? card.id, true);
    }
  }
}

/**
 * Ask for the cut list and keep it with the deck. `rerun`: the list on
 * screen and the owner's choices on it go with the request, taken as
 * settled; the approach is left as it is.
 */
export async function runTrim(model: JsonModel, list: List, profileId: string, opts: { model: TrimModel; rerun?: boolean }, progress: (s: string) => void = () => {}): Promise<{ runId: string; items: number }> {
  progress('Gathering the deck’s facts');
  // A fresh list starts from what is remembered; a rerun keeps the choices on screen in play.
  const before = trimStore(list.id);
  const s: TrimStore = opts.rerun ? before : { ...before, choices: {} };
  const { user, ctx, over, planPassId } = await trimMessage(list, profileId, s);
  if (over <= 0) throw new ModelError('The deck is at 100 or under: there is nothing to trim.');
  progress(`Claude is ranking the cuts (${over} to find)`);
  const answer = await model({
    step: `trim: rank the cuts (${opts.model})`,
    system: TRIM_SYSTEM,
    user,
    schema: TRIM_SCHEMA,
    promptOnly: true,
    thinking: 'high',
    timeoutMs: 5 * 60_000,
  }, { maxBusy: 1 });
  const { items, notes } = parseTrim(answer.data, ctx, s, over);
  const run: Run = { id: randomUUID(), at: now(), model: answer.model, round: (before.run && opts.rerun ? before.run.round : 0) + 1, deckHash: deckHash(list.commander, ctx.main), planPassId, over, notes, items };
  update(list.id, (x) => {
    if (opts.rerun) remember(list, x);
    // Choices on cards still listed as cuts carry over with their reasons; the rest start fresh.
    const stays = new Set(items.filter((i) => i.tier === 'cut').map((i) => i.name));
    x.choices = opts.rerun ? Object.fromEntries(Object.entries(x.choices).filter(([n, c]) => c.choice === 'cut' && stays.has(n))) : {};
    x.run = run;
    x.model = opts.model;
    x.done = null;
  });
  quietly(() => {
    if (s.correction.trim()) logConversation(profileId, list.id, 'trim', 'approach_corrected', s.correction.trim(), PROMPT_VERSIONS.trim);
    logRun(list, profileId, run);
  });
  // A line added to the approach is the owner's note on the deck from here on.
  if (s.correction.trim() && !opts.rerun) changePlan(list.id, { notes: { add: [s.correction.trim().slice(0, 600)], by: 'owner' } });
  return { runId: run.id, items: items.length };
}

const itemKey = (name: string) => `trim:cut:${name}`;

/** The list as the suggestion log keeps it: one batch per round, cuts marked as preselected. A new round leaves the last one's untouched cards ignored. */
function logRun(list: Pick<List, 'id' | 'commander'>, profileId: string, run: Run): void {
  const main = cardsInList(list.id).filter((c) => c.board === 'main');
  const oracle = new Map(main.map((c) => [c.card.name, c.card.oracle_id ?? null]));
  logShown(profileId, list.id, 'trim:', [{
    key: `trim:list@${run.id}`, task: 'trim', method: 'ai', model: run.model, promptVersion: PROMPT_VERSIONS.trim, planVersion: run.planPassId, deckHash: run.deckHash,
    items: run.items.filter((i) => i.tier === 'cut' || i.tier === 'maybe').map((i) => ({ key: itemKey(i.name), cardOut: { oracleId: oracle.get(i.name) ?? null, name: i.name }, reasonShown: i.why, preselected: i.tier === 'cut' })),
  }]);
}

// --- the owner's side ----------------------------------------------------------------------

const cleanChoice = (v: unknown): TrimChoice | null => {
  const c = v as Partial<TrimChoice> | null;
  if (!c || (c.choice !== 'cut' && c.choice !== 'keep')) return null;
  return { choice: c.choice, chip: isTrimChip(c.chip) ? c.chip : null, text: typeof c.text === 'string' ? c.text.slice(0, 300) : '' };
};

/** The owner's choices on the list, replaced whole (the page sends them as they change). A kept cut is a refusal in the log, with its reason. */
export function setChoices(listId: string, choices: unknown): void {
  const before = trimStore(listId);
  if (!before.run) return;
  const items = new Map(before.run.items.map((i) => [i.name, i]));
  const next: Record<string, TrimChoice> = {};
  for (const [name, v] of Object.entries((choices ?? {}) as Record<string, unknown>).slice(0, 200)) {
    const c = cleanChoice(v);
    if (c && items.has(name)) next[name] = c;
  }
  update(listId, (s) => { s.choices = next; });
  quietly(() => {
    for (const [name, item] of items) {
      const was = before.choices[name];
      const is = next[name];
      if (JSON.stringify(was) === JSON.stringify(is)) continue;
      if (is?.choice === 'keep' && item.tier === 'cut') logOutcome(listId, [itemKey(name)], 'refused', { chip: (is.chip ?? null) as ReasonChip | null, text: is.text ?? null });
      else if (was?.choice === 'keep' && item.tier === 'cut') clearOutcome(listId, [itemKey(name)]);
    }
  });
}

export function setCorrection(listId: string, text: unknown): void {
  update(listId, (s) => { s.correction = typeof text === 'string' ? text.slice(0, 600) : ''; });
}

/** Start over: the list and the choices go, what was remembered about cards stays. */
export function resetTrim(listId: string): void {
  quietly(() => closeAll(listId, 'trim:'));
  update(listId, (s) => { s.run = null; s.choices = {}; s.done = null; });
}

/**
 * Apply the chosen cuts: never a commander or a ★ card, never a land under
 * the floor, never past 100. The cards move to the section for cards that
 * came out, each with its reason; the caller takes the snapshot.
 */
export async function applyTrim(list: List, profileId: string, cutsTo?: Board): Promise<TrimDone> {
  const s = trimStore(list.id);
  if (!s.run) throw new Error('There is no cut list to apply');
  const ctx = await tuneContext(list, profileId);
  const over = Math.max(0, ctx.size - 100);
  const inMain = new Map(ctx.main.map((c) => [c.card.name, c.card]));
  const items = s.run.items.filter((i) => inMain.has(i.name));
  const names = chosenCuts(items as TrimItem[], s.choices);
  const { kept } = guardCuts(names.map((name) => ({ name, land: isLand(inMain.get(name)!) })), { count: over, lands: { have: ctx.plan.landNumber.have, floor: landFloor(ctx) }, never: ctx.protectedWhy });
  if (!kept.length) throw new Error('Nothing to cut: choose at least one card');
  const byName = new Map(items.map((i) => [i.name, i]));
  const why = (name: string) => reasonOf(s.choices[name] ?? {}) || byName.get(name)?.why || 'Trimmed to 100';
  const moved = await applyCuts(list, kept.map((k) => ({ name: k.name, why: why(k.name) })), cutsTo);
  const cut = new Set(kept.map((k) => k.name));
  const refused = items.filter((i) => i.tier === 'cut' && !cut.has(i.name));
  const reasons = Object.entries(s.choices).filter(([n, c]) => byName.has(n) && (c.chip || c.text?.trim())).length;
  const done: TrimDone = {
    at: now(), cut: moved.cut, size: ctx.size - moved.cut, to: ctx.sections.find((x) => x.id === moved.to)?.name ?? 'Came out', undo: moved.undo,
    logged: { accepted: cut.size, refused: refused.length, left: items.filter((i) => i.tier === 'maybe' && !cut.has(i.name)).length, reasons },
  };
  quietly(() => {
    for (const name of cut) logOutcome(list.id, [itemKey(name)], 'accepted', { chip: (s.choices[name]?.chip ?? null) as ReasonChip | null, text: s.choices[name]?.text ?? null });
    for (const i of refused) logOutcome(list.id, [itemKey(i.name)], 'refused', { chip: (s.choices[i.name]?.chip ?? null) as ReasonChip | null, text: s.choices[i.name]?.text ?? null });
    // Whatever was shown and left untouched was ignored.
    closeAll(list.id, 'trim:');
  });
  update(list.id, (x) => {
    remember(list, x);
    for (const name of cut) x.said[name] = { choice: 'cut', chip: x.choices[name]?.chip ?? null, text: x.choices[name]?.text?.trim() ?? '', at: done.at };
    x.done = done;
  });
  return done;
}

/** Put back what the last apply moved; the list and the choices are as they were. */
export function undoTrim(list: List): { moved: number } {
  const s = trimStore(list.id);
  if (!s.done) return { moved: 0 };
  const result = undoApply(list, s.done.undo as UndoMoves);
  update(list.id, (x) => {
    for (const [n, v] of Object.entries(x.said)) if (v.choice === 'cut' && v.at === x.done?.at) delete x.said[n];
    x.done = null;
  });
  return result;
}

// --- the view ----------------------------------------------------------------------------------

/** What a step has cost lately, from the AI usage trail (kept a week), else the estimate. */
function costOf(stepLike: string, guess: number): { usd: number; measured: boolean } {
  try {
    const r = database().get(`SELECT AVG(cost) AS usd, COUNT(*) AS n FROM ai_calls WHERE step LIKE ? AND outcome = 'ok' AND cost > 0`, [stepLike]) as { usd: number | null; n: number } | null;
    if (r?.n && r.usd) return { usd: r.usd, measured: true };
  } catch { /* no usage trail yet */ }
  return { usd: guess, measured: false };
}

export const TRIM_READS = [
  'Every card in the deck with its rules text, and the counts the app worked out',
  'The plan you confirmed, with who set each part: what the commander does, your settings, how the deck wins, ways to win and key cards',
  'Your notes, word for word',
  'Every category on the deck with its cards and who added it',
  'The approach, and anything you add to it',
  'Your never-cut cards',
  'What you kept or cut on this deck before, with your reasons',
  'The names in the sections for cards that came out, and in your maybeboard',
];

export async function trimView(list: List, profileId: string): Promise<TrimView> {
  const ctx = await tuneContext(list, profileId);
  const s = trimStore(list.id);
  const over = Math.max(0, ctx.size - 100);
  const po = planOwner(list.id);
  const planState = po.confirmedAt ? 'current' : 'none';
  const inMain = new Map(ctx.main.filter((c) => c.slot !== 'partner').map((c) => [c.card.name, c.card]));
  const hash = deckHash(list.commander, ctx.main);
  const items: TrimItem[] = (s.run?.items ?? []).filter((i) => inMain.has(i.name)).map((i) => {
    const card = inMain.get(i.name)!;
    const f = ctx.flags.get(i.name);
    return {
      key: itemKey(i.name), name: i.name, tier: i.tier, why: i.why, with: i.with,
      flag: f?.flag ?? null,
      warn: i.tier === 'kept' ? 'Claude left this in on purpose.' : f?.strong ? `${f.flag}: cutting it may break what the deck is built on.` : null,
      card: { id: card.id, image: imageOf(card, 'normal'), manaCost: manaCostOf(card), typeLine: typeLineOf(card), text: oracleTextOf(card), land: isLand(card) },
    };
  });
  const choices = Object.fromEntries(Object.entries(s.choices).filter(([n]) => inMain.has(n)));
  const impact = await cutImpact(ctx, s.run && !s.done ? chosenCuts(items, choices) : []);
  const cutsJob = latestJob('trim', list.id);
  const approachJob = latestJob('trimapproach', list.id);
  const live = (j: ReturnType<typeof latestJob>, kind: 'approach' | 'cuts', since: string | null) => (j && (j.status === 'running' || (j.status === 'failed' && (!since || j.startedAt > since)))
    ? { kind, status: j.status as 'running' | 'failed', detail: j.detail || null, error: j.status === 'failed' ? j.error ?? 'Claude didn’t finish' : null } : null);
  const job = live(cutsJob, 'cuts', s.run?.at ?? null) ?? live(approachJob, 'approach', s.approach?.at ?? null);
  const cutsTo = cutBoard(ctx.sections);
  return {
    size: ctx.size, over,
    plan: { state: planState, text: po.planText.trim() || null, at: po.confirmedAt, confirmed: !!po.confirmedAt },
    approach: s.approach, correction: s.correction,
    model: 'opus',
    costs: {
      opus: costOf('trim: rank the cuts (opus)', TRIM_COST_GUESS.opus),
      approach: costOf('trim: write the approach', TRIM_COST_GUESS.approach),
    },
    run: s.run ? { id: s.run.id, at: s.run.at, model: s.run.model, round: s.run.round, notes: s.run.notes, items, stale: !s.done && s.run.deckHash !== hash } : null,
    choices,
    impact: { rows: impact.rows, size: impact.size },
    lands: { have: ctx.plan.landNumber.have, floor: landFloor(ctx), range: ctx.plan.lands },
    reads: TRIM_READS,
    cutsTo: { id: cutsTo, name: ctx.sections.find((x) => x.id === cutsTo)?.name ?? 'Sideboard' },
    job,
    done: s.done,
    noKey: !process.env.ANTHROPIC_API_KEY,
  };
}

export { TRIM_MODELS };
