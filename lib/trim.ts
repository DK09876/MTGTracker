/**
 * Trim: cutting a deck that is over 100 cards down to 100 (the deck flow
 * plan, step 4a), run as one conversation per cut session. Kept with the
 * deck, so leaving the page loses nothing:
 *
 *   1. What matters for these cuts: one box in the owner's words. It can be
 *      drafted by code from the deck's numbers (free), or Claude can add
 *      bullets below what the owner wrote. It may be empty.
 *   2. A ranked list from Claude: about twice as many cards as the deck is
 *      over, most cuttable first. Its first N are the cuts, already chosen;
 *      the rest are closer calls. (The deck flow evaluation: Opus 0.74 on the
 *      judge with 2% harmful cuts, the rules list 0.48 and 20%.)
 *   3. The owner marks keeps and cuts, with reasons, and says something back;
 *      every call after the first is sent the whole session, oldest first,
 *      and answers with a new list and a reply. Then apply: the cards move to
 *      the section for cards that came out, after a snapshot.
 *
 * A session starts at the first "Find cuts" and ends at apply or reset. Why
 * one conversation (FINDINGS, Session 4): the owner's own words steer the
 * cuts strongly, and two runs with nothing changed share only 40 to 70% of
 * their cuts, so a re-run that is sent the session holds the list steady.
 *
 * Code decides what the model may not: never the commanders or a ★ card,
 * never a land under the land floor, the count. Engines and key cards are
 * flagged, not blocked. What the owner kept or cut, and why, is also
 * remembered for the deck across sessions (`said`). Nothing crosses decks.
 *
 * Everything shown and what became of it goes to the suggestion log. Server
 * only.
 */

import { randomUUID } from 'node:crypto';

import { ModelError, type JsonModel } from './ai';
import { estimateCost } from './ai-estimate';
import { guardCuts } from './cut-guard';
import { cardsInList, database, type List } from './db';
import { deckHash } from './deck-hash';
import { changePlan, planFor } from './deck-plan';
import { keeps, setKeep } from './deck-roles';
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
  chosenCuts, isTrimChip, newMarks, saidSomething, TRIM_MODELS,
  type CutMark, type TrimApproach, type TrimChoice, type TrimDone, type TrimItem, type TrimMark, type TrimModel, type TrimTier, type TrimTurn, type TrimView,
} from './trim-shared';
import type { Board } from './decklist';

const front = (n: string) => n.split(' // ')[0].trim().toLowerCase();
const isLand = (c: ScryfallCard) => /\bLand\b/.test((c.type_line ?? '').split('//')[0]);
const now = () => new Date().toISOString();

/** How many closer calls to ask for beyond the cuts: as many again, between 6 and 15. */
export const extraFor = (over: number) => Math.max(6, Math.min(over, 15));

// --- kept with the deck ---------------------------------------------------------------

interface StoredItem { name: string; tier: TrimTier; why: string; with: string[] }
/** The list before, as code compares the new one with it. */
interface Prev { cuts: string[]; confirmed: string[]; kept: string[]; named: string[] }
interface Run {
  id: string; at: string; model: string; round: number; deckHash: string; planPassId: string | null; over: number;
  notes: string; reply: string; ask: string | null; items: StoredItem[]; prev: Prev | null;
}
/** What the owner said about a card on this deck, kept across lists. */
export interface Said { choice: 'cut' | 'keep'; chip: string | null; text: string; at: string }

export interface TrimStore {
  approach: TrimApproach | null;
  model: TrimModel;
  run: Run | null;
  choices: Record<string, TrimChoice>;
  /** Choices carried over to the list on screen from the one before: already in the session. */
  carried: Record<string, TrimChoice>;
  /** The cut session so far, oldest first; cleared on apply or reset. */
  turns: TrimTurn[];
  said: Record<string, Said>;
  done: TrimDone | null;
}

const EMPTY: TrimStore = { approach: null, model: 'opus', run: null, choices: {}, carried: {}, turns: [], said: {}, done: null };

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

const APPROACH_SYSTEM = `You are an experienced Commander deckbuilder inside a deck app. The owner's deck is over 100 cards and they are about to ask for a cut list. Write the approach for those cuts: 3 to 5 short bullets, each with numbers where they apply, saying where the cuts should come from and what stays protected, for THIS deck. Follow the deck's plan and what the owner has told the app; the owner outranks your own reading. When the owner has already written some lines, those stay exactly as they are: write 2 to 4 bullets that add to them, never repeating or contradicting them. Name a card only as an example. No card-by-card list: that comes next. Plain words a player would say at the table.`;

const APPROACH_SCHEMA = { type: 'OBJECT', properties: { bullets: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['bullets'] };

/**
 * Claude's approach, from the confirmed plan and the deck's numbers. `box`:
 * what the owner has typed so far. It is sent, and kept first, word for word,
 * with Claude's bullets added below it.
 */
export async function writeApproach(model: JsonModel, list: List, profileId: string, box = ''): Promise<TrimApproach> {
  const own = box.trim().slice(0, 2000);
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
    ...(own ? ['', "## What the owner has already written (it stays as it is; add to it)", '"""', own, '"""'] : []),
  ].join('\n');
  const answer = await model({ step: 'trim: write the approach', system: APPROACH_SYSTEM, user, schema: APPROACH_SCHEMA, thinking: 'low' }, { maxBusy: 1 });
  const bullets = ((answer.data as { bullets?: unknown })?.bullets as unknown[] | undefined ?? []).filter((b): b is string => typeof b === 'string' && !!b.trim()).slice(0, 6);
  if (!bullets.length) throw new ModelError('The approach came back empty. Nothing was saved; try again, or write your own.');
  const added = bullets.map((b) => `- ${b.trim().replace(/^[-•]\s*/, '').slice(0, 400)}`).join('\n');
  // The owner's lines and Claude's bullets stay apart: only the owner's are their words in the session and for notes.
  const approach: TrimApproach = own ? { text: `${own}\n${added}`, by: 'both', own, at: now() } : { text: added, by: 'claude', own: '', at: now() };
  update(list.id, (x) => { x.approach = approach; });
  quietly(() => logConversation(profileId, list.id, 'trim', 'approach_shown', approach.text, PROMPT_VERSIONS.trimApproach));
  return approach;
}

/** The approach the owner wrote, the code's draft, or none. */
export async function setApproach(list: List, profileId: string, input: { text?: string; draft?: boolean; clear?: boolean }): Promise<void> {
  if (input.clear || (input.text !== undefined && !input.text.trim() && !input.draft)) { update(list.id, (s) => { s.approach = null; }); return; }
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

export const TRIM_SYSTEM = `You are an experienced Commander deckbuilder inside a deck app, helping the owner trim a deck that is over 100 cards. You get the deck's facts (the commander, numbers the app's code worked out on this exact list, and every card with its rules text); the plan the owner confirmed on the Plan tab (what the commander does, their settings, how the deck wins, ways to win and key cards, with who set each part); what the owner has told the app; what they said matters for these cuts; what they decided on earlier cut lists for this deck; and, after the first list, the whole cut session so far.

This is one conversation. Read the whole session. The owner's latest words outrank their earlier ones, and all of them outrank your own reading.

The owner picks their cuts from your list. Give:
- ranked: the number of cards the task asks for, most cuttable first. Your first N (the number the deck is over) are your own recommended cuts; the rest are the closer calls, in order. For each: "why", one or two short sentences a player would say at the table, about this card in this deck; and "with", the other cards in the deck it works with (empty when none matter to the call).
- keep: up to 5 cards a quick look would cut (over a usual range, weak on their own, expensive) that should stay, each with why. Only where it is not obvious.
- notes (the first list only): 2 or 3 sentences: where the cuts come from and what you protected.
- reply (every list after the first): 2 to 4 sentences to the owner: what changed since your last list and which of their words changed it, or the answer to their question.
- ask: optional, one question for the owner. Leave it empty unless you cannot tell what they want.

On every list after the first:
- Change only what the owner's input changes. A card that was a cut last time and that nothing the owner said touches stays a cut, in the same order where you can. Say so in the reply if you move one anyway.
- Where the owner gave a reason, apply it to similar cards and name them in the reply.
- When the owner asks a question, answer it in the reply. The list may stay the same.
- When two things the owner said conflict, follow the later one and say which you followed. Ask at most one question, and only when you cannot tell.

How to rank:
- Use your own judgement: what the commander and the owner want, the deck's plan and its combos, the curve, and the jobs every deck needs.
- Follow what the owner said matters for these cuts. The owner's own words (that, their notes, their reasons and their messages) outrank your reading of the deck.
- The owner's earlier decisions stand. Don't list a card they kept, unless their latest message asks to cut it: then list it. Where they said why, apply the same reasoning to similar cards.
- Never list a commander or a card marked never cut. List a land only when the task says lands may be cut.
- A combo piece or an engine goes only with a clear reason, said in its "why". Say what breaks.
- The numbers are facts the code worked out, not judgements; many good decks sit outside the usual ranges on purpose.
- Use card names exactly as they appear in the list.
- Think it through privately; the answer holds only the fields asked for.`;

/** The answer's shape: notes on the first list, a reply on every later one; ask is optional on both. */
const trimSchema = (first: boolean) => ({
  type: 'OBJECT',
  properties: {
    ranked: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, why: { type: 'STRING' }, with: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['name', 'why', 'with'] } },
    keep: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, why: { type: 'STRING' } }, required: ['name', 'why'] } },
    ...(first ? { notes: { type: 'STRING' } } : { reply: { type: 'STRING' } }),
    ask: { type: 'STRING' },
  },
  required: ['ranked', 'keep', first ? 'notes' : 'reply'],
});

const APPROACH_BY: Record<TrimApproach['by'], string> = {
  owner: "the owner's own words",
  claude: 'written by you earlier, kept by the owner',
  code: 'drafted by the app from the numbers, kept by the owner',
  both: "the owner's own words first, then bullets you added earlier, kept by the owner",
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
    ...(kept.length ? ['Kept so far (the owner can take one back):', ...kept.slice(-60).map(line)] : []),
    ...(cut.length ? ['Cut:', ...cut.map(line)] : []),
  ];
}

/** Names are joined with "; " for the model: many card names have commas in them. */
const NAMES = '; ';
const quote = (t: string) => `"${t.replace(/\s+/g, ' ').trim()}"`;

/** How many rounds keep their card lists in the session; older rounds keep only the words. */
export const FULL_ROUNDS = 6;

function ownerLine(t: Extract<TrimTurn, { kind: 'owner-reply' }>): string {
  const why = (m: TrimMark) => (reasonOf(m) ? ` (${quote(reasonOf(m))})` : '');
  const parts = [
    ...(t.approach !== undefined ? [`changed what matters for these cuts to: ${t.approach.trim() ? quote(t.approach) : 'nothing'}`] : []),
    ...t.marks.filter((m) => m.choice === 'keep').map((m) => `kept ${m.name}${why(m)}`),
    ...(t.marks.some((m) => m.choice === 'cut') ? [`confirmed cuts: ${t.marks.filter((m) => m.choice === 'cut').map((m) => `${m.name}${why(m)}`).join(NAMES)}`] : []),
    ...(t.message.trim() ? [`said: ${quote(t.message)}`] : []),
  ];
  return parts.length ? parts.join('; ') : 'changed nothing and asked for the list again';
}

/** The whole session, oldest first, in plain lines; nothing before the first list. */
export function sessionLines(turns: TrimTurn[]): string[] {
  const lists = turns.filter((t) => t.kind === 'claude-list');
  if (!lists.length) return [];
  const full = new Set(lists.slice(-FULL_ROUNDS));
  const out = ['', '## This cut session so far'];
  for (const t of turns) {
    if (t.kind === 'owner-start') {
      out.push(`Owner, at the start: ${t.text.trim() ? quote(t.text) : 'said nothing'}`);
      if (t.added?.trim()) out.push(`Bullets you added to it before the first list, kept by the owner: ${quote(t.added)}`);
    }
    else if (t.kind === 'owner-reply') out.push(`Owner: ${ownerLine(t)}`);
    else {
      const words = [...(t.reply.trim() ? [`you said: ${quote(t.reply)}`] : []), ...(t.ask ? [`you asked: ${quote(t.ask)}`] : [])];
      const cards = full.has(t) ? [`cuts: ${t.cuts.join(NAMES) || 'none'}`, `closer calls: ${t.maybes.join(NAMES) || 'none'}`] : ['(its cards are left out here)'];
      out.push(`You, list ${t.round}: ${[...cards, ...words].join(' | ')}`);
    }
  }
  return out;
}

/** Everything the cut list call is sent, and what the parse needs. */
export async function trimMessage(list: List, profileId: string, s: TrimStore = trimStore(list.id)): Promise<{ user: string; ctx: Context; over: number; want: number; ask: number; round: number; planPassId: string | null; landsFree: number }> {
  const ctx = await tuneContext(list, profileId);
  const over = Math.max(0, ctx.size - 100);
  // One more than wanted: runs with no list before came back one short 6 times in 42. parseTrim trims to `want`.
  const want = over + extraFor(over);
  const ask = want + 1;
  const session = sessionLines(s.turns);
  const round = s.turns.filter((t) => t.kind === 'claude-list').length + 1;
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
    ...(never.length ? ['', `## Never cut\n${never.map(([n, w]) => `${n} (${w})`).join(NAMES)}`] : []),
    // The first list reads the box as it is; later ones read it as the session's first line.
    ...(!session.length && s.approach?.text.trim() ? ['', `## What matters for these cuts (${APPROACH_BY[s.approach.by]})`, '"""', s.approach.text.trim(), '"""'] : []),
    ...saidLines(s, main),
    ...session,
    ...(out.length ? ['', `## Cards that came out of this deck before\n${out.slice(0, 60).map((c) => `${c.card.name}${store.cutReasons[c.card.name]?.why ? ` (${store.cutReasons[c.card.name].why.slice(0, 80)})` : ''}`).join('; ')}`] : []),
    ...(ctx.pool.length ? ['', `## Waiting in the owner's maybeboard\n${ctx.pool.slice(0, 60).map((c) => c.card.name).join(NAMES)}`] : []),
    '',
    '## The task',
    `The deck has ${ctx.size} cards including the commander${ctx.commanders.length > 1 ? 's' : ''}; a Commander deck is exactly 100. It is ${over} over.`,
    `${round > 1 ? `This is list ${round}. ` : ''}Rank exactly ${ask} cards, most cuttable first: your first ${over} are your cuts, the other ${ask - over} the closer calls.`,
    round > 1 ? 'Fill reply for the owner, and ask only if you cannot tell what they want.' : 'Fill notes. Leave ask empty unless you cannot tell what the owner wants.',
    landsFree > 0 ? `Lands: at most ${landsFree} may be listed; fewer than ${Math.ceil(landFloor(ctx))} lands is not allowed.` : 'Lands: none may be listed; the deck is at or under the fewest lands it should have.',
  ].join('\n');
  return { user, ctx, over, want, ask, round, planPassId: planOwner(list.id).confirmedAt, landsFree };
}

/**
 * The model's answer as the list the owner sees: names kept to cards in the
 * main deck, the commanders and ★ cards out, lands held to the land floor,
 * the owner's settled choices applied, then the first N as cuts and the rest
 * as closer calls. Throws when too few usable cards came back to make N cuts.
 */
export function parseTrim(data: unknown, ctx: Context, s: TrimStore, over: number, want = over + extraFor(over)): { items: StoredItem[]; notes: string; reply: string; ask: string | null } {
  const d = (data ?? {}) as { ranked?: unknown; keep?: unknown; notes?: unknown; reply?: unknown; ask?: unknown };
  const cards = ctx.main.filter((c) => c.slot !== 'partner');
  const byFront = new Map(cards.map((c) => [front(c.card.name), c.card]));
  const rows = (xs: unknown) => (Array.isArray(xs) ? xs : []).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => ({ card: byFront.get(front(String(x.name ?? ''))), why: String(x.why ?? '').trim().slice(0, 400), with: (Array.isArray(x.with) ? x.with : []).map((w) => byFront.get(front(String(w)))?.name).filter((w): w is string => !!w).slice(0, 6) }))
    .filter((x): x is { card: ScryfallCard; why: string; with: string[] } => !!x.card);
  // The owner's settled choices: kept cards don't come back, cuts stay cuts. A kept card comes back
  // when the owner took the keep back (pressed Cut on it), or their latest message names it.
  const back = takenBack(s);
  const cutNow = new Set(Object.entries(s.choices).filter(([, c]) => c.choice === 'cut').map(([n]) => n));
  const keptByOwner = new Set([...Object.entries(s.choices).filter(([, c]) => c.choice === 'keep').map(([n]) => n), ...Object.entries(s.said).filter(([, v]) => v.choice === 'keep').map(([n]) => n)]
    .filter((n) => !back.has(n) && !cutNow.has(n)));
  const fixed = Object.entries(s.choices).filter(([n, c]) => c.choice === 'cut' && byFront.has(front(n))).map(([n]) => n);
  const ranked = rows(d.ranked).filter((r) => !keptByOwner.has(r.card.name));
  const guarded = guardCuts(ranked.map((r) => ({ name: r.card.name, land: isLand(r.card), row: r })), { count: null, lands: { have: ctx.plan.landNumber.have, floor: landFloor(ctx) }, never: ctx.protectedWhy }).kept.map((k) => k.row);
  const oldWhy = new Map((s.run?.items ?? []).map((i) => [i.name, i]));
  const first = fixed.map((n) => guarded.find((r) => r.card.name === n) ?? { card: byFront.get(front(n))!, why: oldWhy.get(n)?.why ?? 'You chose to cut it.', with: oldWhy.get(n)?.with ?? [] });
  const rest = guarded.filter((r) => !fixed.includes(r.card.name));
  // One more was asked for than is wanted: keep the wanted number (more only when the owner chose more).
  const all = [...first, ...rest].slice(0, Math.max(want, first.length));
  if (all.length < over) throw new ModelError(`The list came back with ${all.length} usable cards for ${over} cuts. Nothing was saved; try again.`);
  const listed = new Set(all.map((r) => r.card.name));
  const items: StoredItem[] = all.map((r, i) => ({ name: r.card.name, tier: i < over ? 'cut' : 'maybe', why: r.why, with: r.with }));
  for (const k of rows(d.keep).filter((r) => !listed.has(r.card.name) && !ctx.protectedWhy.has(r.card.name) && !keptByOwner.has(r.card.name)).slice(0, 5)) items.push({ name: k.card.name, tier: 'kept', why: k.why, with: [] });
  // What the owner has kept is not stored with the list: the view lists it under "Kept by you" (listedItems).
  const text = (x: unknown, n: number) => (typeof x === 'string' ? x.trim().slice(0, n) : '');
  return { items, notes: text(d.notes, 800), reply: text(d.reply, 1200), ask: text(d.ask, 400) || null };
}

/**
 * Kept cards the owner's latest message names: Claude may list them again,
 * because the owner may be taking the keep back ("actually cut X after all").
 */
export function takenBack(s: Pick<TrimStore, 'turns' | 'said' | 'choices'>): Set<string> {
  const last = [...s.turns].reverse().find((t) => t.kind === 'owner-reply') as Extract<TrimTurn, { kind: 'owner-reply' }> | undefined;
  const said = last?.message.toLowerCase() ?? '';
  if (!said) return new Set();
  const kept = new Set([...Object.entries(s.said).filter(([, v]) => v.choice === 'keep').map(([n]) => n), ...Object.entries(s.choices).filter(([, c]) => c.choice === 'keep').map(([n]) => n)]);
  return new Set([...kept].filter((n) => said.includes(front(n))));
}

/**
 * Every row the owner can mark: the list's own rows, then "Kept by you":
 * every card kept on this deck that is still in it and not on the list
 * (this session's keeps fold into `said` at each send), with the owner's
 * reason in place of Claude's.
 */
function listedItems(s: TrimStore, inMain: (name: string) => boolean): StoredItem[] {
  const listed = (s.run?.items ?? []).filter((i) => i.tier !== 'yours');
  const on = new Set(listed.map((i) => i.name));
  const yours = Object.entries(s.said).filter(([n, v]) => v.choice === 'keep' && !on.has(n) && inMain(n))
    .map(([n, v]): StoredItem => ({ name: n, tier: 'yours', why: reasonOf(v), with: [] }));
  return [...listed, ...yours];
}

/** Fold the choices on the list into what is remembered for the deck. A cut on a kept card takes the keep back. */
function remember(list: Pick<List, 'id'>, s: TrimStore): void {
  if (!s.run) return;
  const byName = new Map(listedItems(s, () => true).map((i) => [i.name, i]));
  const main = cardsInList(list.id).filter((c) => c.board === 'main');
  for (const [name, c] of Object.entries(s.choices)) {
    const item = byName.get(name);
    if (!item || !saidSomething(item as TrimItem, c)) continue;
    s.said[name] = { choice: c.choice, chip: c.chip ?? null, text: c.text?.trim().slice(0, 300) ?? '', at: now() };
    // An old "Pet card" choice still means never cut (the ★ now lives in the opened card).
    if (c.choice === 'keep' && c.chip === 'pet_card') {
      const card = main.find((m) => m.card.name === name)?.card;
      if (card) setKeep(list.id, card.oracle_id ?? card.id, true);
    }
  }
}

/** The box text the session last heard: the box at the start (with any bullets Claude added), or the last change sent since. */
function lastBoxText(turns: TrimTurn[]): string | null {
  for (let k = turns.length - 1; k >= 0; k--) {
    const t = turns[k];
    if (t.kind === 'owner-reply' && t.approach !== undefined) return t.approach;
    if (t.kind === 'owner-start') return `${t.text}\n${t.added ?? ''}`.trim();
  }
  return null;
}

/**
 * Ask for the cut list and keep it with the deck. The first call starts a
 * session with what is in the box. `rerun`: the owner's answer to the list on
 * screen (the keeps and cuts marked since, and `message`) joins the session,
 * and the whole session is sent, so with nothing marked or typed the list
 * holds unless something changed.
 */
export async function runTrim(model: JsonModel, list: List, profileId: string, opts: { model: TrimModel; rerun?: boolean; message?: string }, progress: (s: string) => void = () => {}): Promise<{ runId: string; items: number }> {
  progress('Gathering the deck’s facts');
  const before = trimStore(list.id);
  const at = now();
  const rerun = !!opts.rerun && !!before.run;
  const box = before.approach?.text.trim() ?? '';
  // Claude's bullets are kept apart from the owner's own lines.
  const a = before.approach;
  const ownText = a && (a.by === 'claude' || a.by === 'both') && a.own !== undefined ? a.own.trim() : box;
  const added = ownText !== box ? box.slice(ownText.length).trim() : '';
  let turns: TrimTurn[];
  let reply: Extract<TrimTurn, { kind: 'owner-reply' }> | null = null;
  if (!rerun) turns = [{ kind: 'owner-start', text: ownText, ...(added ? { added } : {}), at }];
  else {
    // A list from before sessions were kept: start the session from it.
    turns = before.turns.length ? [...before.turns] : [
      { kind: 'owner-start', text: ownText, ...(added ? { added } : {}), at: before.run!.at },
      { kind: 'claude-list', round: before.run!.round, cuts: before.run!.items.filter((i) => i.tier === 'cut').map((i) => i.name), maybes: before.run!.items.filter((i) => i.tier === 'maybe').map((i) => i.name), reply: before.run!.reply || before.run!.notes, ask: before.run!.ask ?? null, at: before.run!.at },
    ];
    const heard = lastBoxText(turns);
    reply = {
      kind: 'owner-reply',
      marks: newMarks(listedItems(before, () => true), before.choices, before.carried),
      message: (opts.message ?? '').trim().slice(0, 1500),
      ...(heard !== null && heard.trim() !== box ? { approach: box } : {}),
      at,
    };
    turns.push(reply);
  }
  const s: TrimStore = { ...before, choices: rerun ? before.choices : {}, turns };
  const { user, ctx, over, want, round, planPassId } = await trimMessage(list, profileId, s);
  if (over <= 0) throw new ModelError('The deck is at 100 or under: there is nothing to trim.');
  progress(round > 1 ? `Claude is reading your answer (list ${round})` : `Claude is ranking the cuts (${over} to find)`);
  const answer = await model({
    step: `trim: rank the cuts (${opts.model})`,
    system: TRIM_SYSTEM,
    user,
    schema: trimSchema(round === 1),
    promptOnly: true,
    thinking: 'high',
    timeoutMs: 5 * 60_000,
  }, { maxBusy: 1 });
  const parsed = parseTrim(answer.data, ctx, s, over, want);
  const { items } = parsed;
  const prev: Prev | null = rerun ? {
    cuts: before.run!.items.filter((i) => i.tier === 'cut').map((i) => i.name),
    confirmed: Object.entries(before.choices).filter(([, c]) => c.choice === 'cut').map(([n]) => n),
    kept: (reply?.marks ?? []).filter((m) => m.choice === 'keep').map((m) => m.name),
    named: [...Object.keys(before.choices), ...(reply?.marks ?? []).map((m) => m.name)],
  } : null;
  const run: Run = {
    id: randomUUID(), at: now(), model: answer.model, round, deckHash: deckHash(list.commander, ctx.main), planPassId, over,
    notes: round === 1 ? parsed.notes : '', reply: round === 1 ? '' : parsed.reply || parsed.notes, ask: parsed.ask, items, prev,
  };
  const back = takenBack(s);
  update(list.id, (x) => {
    if (rerun) remember(list, x);
    // A kept card the owner's message named and Claude listed again: the keep is taken back.
    for (const n of back) if (items.some((i) => i.name === n && (i.tier === 'cut' || i.tier === 'maybe')) && x.said[n]?.choice === 'keep') delete x.said[n];
    // Choices on cards still listed as cuts carry over with their reasons; the rest start fresh.
    const stays = new Set(items.filter((i) => i.tier === 'cut').map((i) => i.name));
    x.choices = rerun ? Object.fromEntries(Object.entries(x.choices).filter(([n, c]) => c.choice === 'cut' && stays.has(n))) : {};
    x.carried = structuredClone(x.choices);
    x.turns = [...turns, { kind: 'claude-list', round, cuts: items.filter((i) => i.tier === 'cut').map((i) => i.name), maybes: items.filter((i) => i.tier === 'maybe').map((i) => i.name), reply: run.reply || run.notes, ask: run.ask, at: run.at }];
    x.run = run;
    x.model = opts.model;
    x.done = null;
  });
  quietly(() => {
    if (reply?.message) logConversation(profileId, list.id, 'trim', 'owner_said', reply.message, PROMPT_VERSIONS.trim);
    if (run.reply) logConversation(profileId, list.id, 'trim', 'reply_shown', run.reply, PROMPT_VERSIONS.trim);
    if (run.ask) logConversation(profileId, list.id, 'trim', 'question_asked', run.ask, PROMPT_VERSIONS.trim);
    logRun(list, profileId, run);
  });
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

/**
 * The owner's choices on the list, replaced whole (the page sends them as
 * they change). A kept cut is a refusal in the log, with its reason. Cutting
 * a ★ card takes it off the never-cut list.
 */
export function setChoices(listId: string, choices: unknown): void {
  const before = trimStore(listId);
  if (!before.run) return;
  const items = new Map(listedItems(before, () => true).map((i) => [i.name, i]));
  const next: Record<string, TrimChoice> = {};
  for (const [name, v] of Object.entries((choices ?? {}) as Record<string, unknown>).slice(0, 200)) {
    const c = cleanChoice(v);
    if (c && items.has(name)) next[name] = c;
  }
  update(listId, (s) => { s.choices = next; });
  const fresh = Object.entries(next).filter(([n, c]) => c.choice === 'cut' && before.choices[n]?.choice !== 'cut').map(([n]) => n);
  if (fresh.length) {
    const main = cardsInList(listId).filter((c) => c.board === 'main');
    const starred = keeps(listId);
    for (const n of fresh) {
      const card = main.find((m) => m.card.name === n)?.card;
      if (card && starred.has(card.oracle_id ?? card.id)) setKeep(listId, card.oracle_id ?? card.id, false);
    }
  }
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

/** "Mark never cut" from the opened card: the ★ list, where it can be taken off again. The page sets the row to Keep. */
export function setNeverCut(listId: string, name: string, on: boolean): void {
  const card = cardsInList(listId).find((c) => c.board === 'main' && c.card.name === name)?.card;
  if (card) setKeep(listId, card.oracle_id ?? card.id, on);
}

/** Start over: the list, the choices and the session go; the box and what was remembered about cards stay. */
export function resetTrim(listId: string): void {
  quietly(() => closeAll(listId, 'trim:'));
  update(listId, (s) => { s.run = null; s.choices = {}; s.carried = {}; s.turns = []; s.done = null; });
}

/** What the owner said in the session: the box at the start and each message, for "Keep for next time". */
export function sessionMessages(turns: TrimTurn[]): Array<{ id: string; text: string }> {
  return turns.flatMap((t, i) => {
    const text = t.kind === 'owner-start' ? t.text : t.kind === 'owner-reply' ? t.message : '';
    return text.trim() ? [{ id: `t${i}`, text: text.trim() }] : [];
  });
}

/**
 * Apply the chosen cuts: never a commander or a ★ card, never a land under
 * the floor, never past 100. The cards move to the section for cards that
 * came out, each with its reason; the caller takes the snapshot.
 */
export async function applyTrim(list: List, profileId: string, cutsTo?: Board, keepNotes: string[] = []): Promise<TrimDone> {
  const s = trimStore(list.id);
  if (!s.run) throw new Error('There is no cut list to apply');
  const ctx = await tuneContext(list, profileId);
  const over = Math.max(0, ctx.size - 100);
  const inMain = new Map(ctx.main.map((c) => [c.card.name, c.card]));
  const items = listedItems(s, (n) => inMain.has(n)).filter((i) => inMain.has(i.name));
  const names = chosenCuts(items as TrimItem[], s.choices);
  const { kept } = guardCuts(names.map((name) => ({ name, land: isLand(inMain.get(name)!) })), { count: over, lands: { have: ctx.plan.landNumber.have, floor: landFloor(ctx) }, never: ctx.protectedWhy });
  if (!kept.length) throw new Error('Nothing to cut: choose at least one card');
  const byName = new Map(items.map((i) => [i.name, i]));
  const why = (name: string) => reasonOf(s.choices[name] ?? {}) || byName.get(name)?.why || 'Trimmed to 100';
  const moved = await applyCuts(list, kept.map((k) => ({ name: k.name, why: why(k.name) })), cutsTo);
  const cut = new Set(kept.map((k) => k.name));
  const refused = items.filter((i) => i.tier === 'cut' && !cut.has(i.name));
  const reasons = Object.entries(s.choices).filter(([n, c]) => byName.has(n) && (c.chip || c.text?.trim())).length;
  // Only the lines the owner ticked "Keep for next time" become notes on the deck.
  const notes = sessionMessages(s.turns).filter((m) => keepNotes.includes(m.id)).map((m) => m.text.slice(0, 600));
  const noteIds = (): Set<string> => new Set(planFor(list.id, '', list.commander, []).notes.map((n) => n.id));
  const had = noteIds();
  if (notes.length) changePlan(list.id, { notes: { add: notes, by: 'owner' } });
  const added = [...noteIds()].filter((id) => !had.has(id));
  const done: TrimDone = {
    at: now(), cut: moved.cut, size: ctx.size - moved.cut, to: ctx.sections.find((x) => x.id === moved.to)?.name ?? 'Came out', undo: moved.undo,
    logged: { accepted: cut.size, refused: refused.length, left: items.filter((i) => i.tier === 'maybe' && !cut.has(i.name)).length, reasons },
    notes: notes.length, noteIds: added, session: s.turns,
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
    // The session ends here; `said` keeps what remember folded in.
    x.turns = [];
    x.done = done;
  });
  return done;
}

/** Put back what the last apply moved; the list and the choices are as they were. */
export function undoTrim(list: List): { moved: number } {
  const s = trimStore(list.id);
  if (!s.done) return { moved: 0 };
  const result = undoApply(list, s.done.undo as UndoMoves);
  // The notes the apply saved from "Keep for next time" come off again.
  for (const id of s.done.noteIds ?? []) changePlan(list.id, { notes: { remove: id } });
  update(list.id, (x) => {
    for (const [n, v] of Object.entries(x.said)) if (v.choice === 'cut' && v.at === x.done?.at) delete x.said[n];
    // Undo brings the session back with the cards.
    x.turns = x.done?.session ?? [];
    x.done = null;
  });
  return result;
}

// --- the view ----------------------------------------------------------------------------------


export const TRIM_READS = [
  'Every card in the deck with its rules text, and the counts the app worked out',
  'The plan you confirmed, with who set each part: what the commander does, your settings, how the deck wins, ways to win and key cards',
  'Your notes, word for word',
  'Every category on the deck with its cards and who added it',
  'What you wrote under "What matters for these cuts"',
  'Everything said in this cut session: each list, what you kept and cut with your reasons, and your messages',
  'Your never-cut cards',
  'What you kept or cut on this deck before, with your reasons',
  'The names in the sections for cards that came out, and in your maybeboard',
];

/**
 * The new list against the one before, by code: each cut is the owner's
 * (they confirmed it), the same as before, or new; what they kept; and the
 * cuts that dropped off without the owner naming them.
 */
export function compare(run: Pick<Run, 'prev'>, items: Array<Pick<TrimItem, 'name' | 'tier'>>): { marks: Record<string, CutMark> | null; changed: NonNullable<TrimView['run']>['changed'] } {
  const p = run.prev;
  if (!p) return { marks: null, changed: null };
  const cuts = items.filter((i) => i.tier === 'cut').map((i) => i.name);
  const marks: Record<string, CutMark> = Object.fromEntries(cuts.map((n) => [n, p.confirmed.includes(n) ? 'yours' : p.cuts.includes(n) ? 'same' : 'new']));
  const now = new Set(cuts);
  const named = new Set(p.named);
  const count = (m: CutMark) => Object.values(marks).filter((x) => x === m).length;
  return { marks, changed: { kept: p.kept, dropped: p.cuts.filter((n) => !now.has(n) && !named.has(n)), yours: count('yours'), same: count('same'), fresh: count('new') } };
}

export async function trimView(list: List, profileId: string): Promise<TrimView> {
  const ctx = await tuneContext(list, profileId);
  const s = trimStore(list.id);
  const over = Math.max(0, ctx.size - 100);
  const po = planOwner(list.id);
  const planState = po.confirmedAt ? 'current' : 'none';
  const inMain = new Map(ctx.main.filter((c) => c.slot !== 'partner').map((c) => [c.card.name, c.card]));
  const hash = deckHash(list.commander, ctx.main);
  const items: TrimItem[] = (s.run ? listedItems(s, (n) => inMain.has(n)) : []).filter((i) => inMain.has(i.name)).map((i) => {
    const card = inMain.get(i.name)!;
    const f = ctx.flags.get(i.name);
    return {
      key: itemKey(i.name), name: i.name, tier: i.tier, why: i.tier === 'yours' ? '' : i.why, with: i.with,
      ...(i.tier === 'yours' ? { mine: i.why } : {}),
      star: ctx.protectedWhy.get(i.name) === '★ never cut',
      jobs: ctx.jobs.filter((j) => j.cards.includes(i.name)).map((j) => j.label),
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
    approach: s.approach,
    model: 'opus',
    costs: {
      opus: estimateCost(list.id, 'trim: rank the cuts (opus)'),
      approach: estimateCost(list.id, 'trim: write the approach'),
    },
    run: s.run ? { id: s.run.id, at: s.run.at, model: s.run.model, round: s.run.round, notes: s.run.notes, reply: s.run.reply ?? '', ask: s.run.ask ?? null, items, ...compare(s.run, items), stale: !s.done && s.run.deckHash !== hash } : null,
    choices,
    carried: Object.fromEntries(Object.entries(s.carried ?? {}).filter(([n]) => inMain.has(n))),
    turns: s.turns ?? [],
    messages: sessionMessages(s.turns ?? []),
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
