/**
 * The plan read: one Opus call per deck that reads the deck the way the deck
 * flow evaluation tested (2026-11-10) and says how it wins, its key cards,
 * themes, a role for every card, whether anything is worth asking the owner,
 * and what the commander does for it.
 *
 * It runs only when the owner asks (never on import), after they have had the
 * chance to say what the commander does, set their settings and write notes:
 * the read takes all of that in. The owner can then edit any part of it; an
 * edited part is theirs and is kept exactly on every later read (the prompt
 * says so, and code puts it back if the answer drops it). Answers to the
 * read's questions and anything else the owner tells it are saved as their
 * notes, in their words.
 *
 *   plan_passes  one row per read: the deck's fingerprint at the time, what
 *                went in, what came back
 *   plan_owner   per deck: what the commander does (owner's picks), the
 *                owner's edits, confirmation, "use it anyway" when stale
 *
 * A read goes out of date when STALE_CARDS or more cards changed, the
 * commander changed, or a key card left. Out-of-date reads are not given to
 * later AI steps unless the owner says to use it anyway: in the evaluation a
 * wrong plan scored worse than none. Server only.
 */

import { randomUUID } from 'node:crypto';

import type { JsonModel } from './ai';
import { cardsInList, database, type List } from './db';
import { cardsChanged, deckHash, deckKeys } from './deck-hash';
import { changePlan, noteBy, planFor } from './deck-plan';
import { keeps } from './deck-roles';
import { latestJob } from './jobs';
import { planFacts, type Facts } from './plan-facts';
import {
  COMMANDER_ROLES, isCardRole, isCommanderRole, STALE_CARDS, SUGGEST_COMMANDER_AT,
  type CardRole, type CommanderRole, type DeckState, type OwnerEdits, type PassOutput, type PlanView,
} from './plan-shared';
import { PROMPT_VERSIONS } from './prompt-versions';
import { primaryType } from './deckview';
import { logConversation, quietly } from './suggestion-log';

/** Opus only: a pass made by a smaller model lost the gain, and Haiku raised false alarms on tuned decks. */
export const PASS_MODEL = 'claude-opus-5-5';

let ready = false;
function db() {
  const d = database();
  if (!ready) {
    d.run(`CREATE TABLE IF NOT EXISTS plan_passes (
      id TEXT PRIMARY KEY, listId TEXT NOT NULL, profileId TEXT, at TEXT NOT NULL, model TEXT NOT NULL, promptVersion TEXT NOT NULL,
      deckHash TEXT NOT NULL, deckKeys TEXT NOT NULL, commanderName TEXT, input TEXT NOT NULL, output TEXT NOT NULL)`);
    d.run('CREATE INDEX IF NOT EXISTS idx_plan_passes_list ON plan_passes (listId, at)');
    d.run(`CREATE TABLE IF NOT EXISTS plan_owner (
      listId TEXT PRIMARY KEY, commanderRoles TEXT NOT NULL DEFAULT '[]', edits TEXT NOT NULL DEFAULT '{}',
      confirmedAt TEXT, confirmedPass TEXT, useStalePass TEXT, questionsDone TEXT, ownPlan INTEGER NOT NULL DEFAULT 0, updatedAt TEXT NOT NULL)`);
    ready = true;
  }
  return d;
}

const now = () => new Date().toISOString();
const front = (n: string) => n.split(' // ')[0].trim().toLowerCase();
const parse = <T>(s: string | null | undefined, fallback: T): T => { try { return s ? JSON.parse(s) as T : fallback; } catch { return fallback; } };

// --- the owner's side ------------------------------------------------------------------

interface OwnerRow { listId: string; commanderRoles: string; edits: string; confirmedAt: string | null; confirmedPass: string | null; useStalePass: string | null; questionsDone: string | null; ownPlan: number }
export interface Owner { commanderRoles: CommanderRole[]; edits: OwnerEdits; confirmedAt: string | null; confirmedPass: string | null; useStalePass: string | null; questionsDone: string | null; ownPlan: boolean }

export function owner(listId: string): Owner {
  const r = db().get('SELECT * FROM plan_owner WHERE listId = ?', [listId]) as OwnerRow | null;
  const roles = parse<string[]>(r?.commanderRoles, []).filter(isCommanderRole);
  return {
    // A deck nobody has said anything about is Unsure.
    commanderRoles: roles.length ? roles : ['unsure'],
    edits: parse<OwnerEdits>(r?.edits, {}),
    confirmedAt: r?.confirmedAt ?? null, confirmedPass: r?.confirmedPass ?? null, useStalePass: r?.useStalePass ?? null,
    questionsDone: r?.questionsDone ?? null, ownPlan: !!r?.ownPlan,
  };
}

function saveOwner(listId: string, o: Owner): void {
  db().run(`INSERT INTO plan_owner (listId, commanderRoles, edits, confirmedAt, confirmedPass, useStalePass, questionsDone, ownPlan, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(listId) DO UPDATE SET commanderRoles = excluded.commanderRoles, edits = excluded.edits,
    confirmedAt = excluded.confirmedAt, confirmedPass = excluded.confirmedPass, useStalePass = excluded.useStalePass,
    questionsDone = excluded.questionsDone, ownPlan = excluded.ownPlan, updatedAt = excluded.updatedAt`,
  [listId, JSON.stringify(o.commanderRoles), JSON.stringify(o.edits), o.confirmedAt, o.confirmedPass, o.useStalePass, o.questionsDone, o.ownPlan ? 1 : 0, now()]);
}

function updateOwner(listId: string, fn: (o: Owner) => void): Owner {
  const o = owner(listId);
  fn(o);
  saveOwner(listId, o);
  return o;
}

/** What the commander does: any of the options, or Unsure alone. */
export function setCommanderRoles(listId: string, roles: unknown[]): Owner {
  const picked = [...new Set(roles.filter(isCommanderRole))];
  const clean: CommanderRole[] = picked.includes('unsure') && picked.length > 1 ? picked.filter((r) => r !== 'unsure') : picked;
  return updateOwner(listId, (o) => { o.commanderRoles = clean.length ? clean : ['unsure']; });
}

const cleanList = (xs: unknown, max = 40): string[] => (Array.isArray(xs) ? xs.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim().slice(0, 120)).slice(0, max) : []);
const cleanGroups = (xs: unknown): Array<{ name: string; cards: string[] }> => (Array.isArray(xs) ? xs : [])
  .filter((x): x is { name: unknown; cards: unknown } => !!x && typeof x === 'object')
  .map((x) => ({ name: String(x.name ?? '').trim().slice(0, 80), cards: cleanList(x.cards, 30) })).filter((x) => x.name).slice(0, 12);

/**
 * The owner's edits to the plan: each part given replaces their last edit of
 * it (null clears it, giving it back to the read). Editing unconfirms.
 */
export function setEdits(listId: string, change: { plan?: string | null; winRoutes?: unknown; keyCards?: unknown; themes?: unknown; roles?: Record<string, unknown> | null }): Owner {
  return updateOwner(listId, (o) => {
    const e = o.edits;
    if (change.plan !== undefined) { if (change.plan === null || !change.plan.trim()) delete e.plan; else e.plan = change.plan.trim().slice(0, 2000); }
    if (change.winRoutes !== undefined) { if (change.winRoutes === null) delete e.winRoutes; else e.winRoutes = cleanGroups(change.winRoutes); }
    if (change.keyCards !== undefined) { if (change.keyCards === null) delete e.keyCards; else e.keyCards = cleanList(change.keyCards, 12); }
    if (change.themes !== undefined) { if (change.themes === null) delete e.themes; else e.themes = cleanGroups(change.themes); }
    if (change.roles !== undefined) {
      if (change.roles === null) delete e.roles;
      else e.roles = { ...(e.roles ?? {}), ...Object.fromEntries(Object.entries(change.roles).filter(([, r]) => isCardRole(r)) as Array<[string, CardRole]>) };
    }
    o.confirmedAt = null;
  });
}

export function undoEdits(listId: string): Owner {
  return updateOwner(listId, (o) => { o.edits = {}; o.ownPlan = false; o.confirmedAt = null; });
}

/** The owner writes the plan themselves: their words are the plan. */
export function writeOwnPlan(listId: string, text: string): Owner {
  return updateOwner(listId, (o) => { o.edits = { ...o.edits, plan: text.trim().slice(0, 2000) }; o.ownPlan = true; o.confirmedAt = null; });
}

/**
 * What the owner typed alongside a read or a confirm: answers to the read's
 * questions and anything else, saved as their notes in their words, and
 * logged (answered or skipped) for the suggestion log.
 */
export function takeOwnerInput(listId: string, profileId: string, input: { answers?: Array<{ question: string; answer: string }>; skipped?: string[]; note?: string }): number {
  const answers = (input.answers ?? []).filter((a) => a.answer?.trim()).slice(0, 3);
  const texts = [...answers.map((a) => `${a.question.trim().slice(0, 300)} ${a.answer.trim().slice(0, 600)}`), ...(input.note?.trim() ? [input.note.trim().slice(0, 600)] : [])];
  if (texts.length) changePlan(listId, { notes: { add: texts, by: 'owner' } });
  quietly(() => {
    for (const a of answers) logConversation(profileId, listId, 'plan', 'question_answered', `${a.question}\n${a.answer}`, PROMPT_VERSIONS.planPass);
    for (const q of (input.skipped ?? []).slice(0, 3)) logConversation(profileId, listId, 'plan', 'question_skipped', q, PROMPT_VERSIONS.planPass);
    if (input.note?.trim()) logConversation(profileId, listId, 'plan', 'approach_corrected', input.note.trim(), PROMPT_VERSIONS.planPass);
  });
  const latest = latestPass(listId);
  if (latest && (answers.length || input.skipped?.length)) updateOwner(listId, (o) => { o.questionsDone = latest.id; });
  return texts.length;
}

export function confirmPlan(listId: string): Owner {
  const latest = latestPass(listId);
  return updateOwner(listId, (o) => { o.confirmedAt = now(); o.confirmedPass = latest?.id ?? null; if (latest) o.questionsDone = latest.id; });
}

/** The owner says to use an out-of-date read anyway (until the next read). */
export function keepStalePlan(listId: string): Owner {
  const latest = latestPass(listId);
  return updateOwner(listId, (o) => { o.useStalePass = latest?.id ?? null; });
}

/** Take the read's suggestion for what the commander does. */
export function acceptCommanderSuggestion(listId: string): Owner {
  const s = latestPass(listId)?.output.commander.roles ?? [];
  return s.length ? setCommanderRoles(listId, s) : owner(listId);
}

// --- the read -----------------------------------------------------------------------------

export const PASS_SYSTEM = `You are an experienced Commander deckbuilder inside a deck app. This is the deck's plan read: the owner asks for it before any tuning, and everything the app suggests afterwards reads it. You get the deck's facts (the commander, numbers the app's code worked out on this exact list, and every card with its rules text) and what the owner has told the app.

Decide, for this deck:
- state: "focused" (one clear plan the cards support; it may still be weak), "unfocused" (two or more competing plans, none carried through) or "no_plan" (the cards do not add up to a plan). Whether the lands or card draw are broken is the app's call, not yours.
- plan: 2-4 sentences: how the deck wins, its main engine, and when it wants to do it.
- winRoutes: the ways the deck ends games, each a short name and its cards.
- keyCards: up to 8 cards the deck cannot function without, not counting the commander.
- themes: packages of cards doing one thing, each a short name and its cards.
- cards: one entry for EVERY non-land card except the commander, with a role and a note under 8 words. Roles: "win" ends the game or is part of a game-winning combo; "engine" is repeatable advantage central to the plan; "payoff" rewards the deck for doing its thing; "enabler" makes the plan work (fuel, setup, the pieces payoffs need); "support" is a job every deck needs (ramp, draw, removal, protection) not specific to this plan; "filler" is neither on plan nor doing a needed job well here.
- questions: at most 3, written for THIS deck, only where the cards leave the plan open (competing plans, an unclear way to win, cards whose purpose you cannot tell). Each must be answerable in a sentence or two by someone who knows the deck, and be the kind whose answer would most change what to cut or add. Leave the list empty when the plan is clear. Never ask what the owner has already told the app.
- summary: 2 sentences in plain words for the owner.
- commander: what the commander does for this deck, as one or more of: ${COMMANDER_ROLES.filter((r) => r.id !== 'unsure').map((r) => `"${r.id}" (${r.label}: ${r.tip})`).join('; ')}. Give one sentence why.

How to judge:
- Judge from the rules text and this deck's plan, not from how popular a card is.
- The numbers are facts the code worked out, not judgements; many good decks sit outside the usual ranges on purpose.
- What the owner told the app outranks your own reading. Where the owner fixed a part of the plan, copy it exactly as given and build the rest around it.
- Use card names exactly as they appear in the list.
- Think it through privately; the answer holds only the fields asked for.`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    state: { type: 'STRING', enum: ['focused', 'unfocused', 'no_plan'] },
    plan: { type: 'STRING' },
    winRoutes: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, cards: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['name', 'cards'] } },
    keyCards: { type: 'ARRAY', items: { type: 'STRING' } },
    themes: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, cards: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['name', 'cards'] } },
    cards: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, role: { type: 'STRING', enum: ['win', 'engine', 'payoff', 'enabler', 'support', 'filler'] }, note: { type: 'STRING' } }, required: ['name', 'role', 'note'] } },
    questions: { type: 'ARRAY', items: { type: 'STRING' } },
    summary: { type: 'STRING' },
    commander: { type: 'OBJECT', properties: { roles: { type: 'ARRAY', items: { type: 'STRING' } }, why: { type: 'STRING' } }, required: ['roles', 'why'] },
  },
  required: ['state', 'plan', 'winRoutes', 'keyCards', 'themes', 'cards', 'questions', 'summary', 'commander'],
};

export interface PassInput {
  commanderRoles: CommanderRole[];
  goal: { chips: string[]; text: string };
  bracket: number | null;
  budget: number | null;
  own: boolean;
  rule: string;
  neverCut: string[];
  notes: string[];
  edits: OwnerEdits;
  ownPlan: boolean;
}

/** What the owner has told the app, as the read gets it. */
export function ownerText(i: PassInput): string {
  const L: string[] = ['## What the owner told the app'];
  const roles = i.commanderRoles.filter((r) => r !== 'unsure');
  L.push(`- What the commander does for the deck: ${roles.length ? roles.map((r) => COMMANDER_ROLES.find((x) => x.id === r)!.label).join(', ') : 'not sure yet (suggest it)'}`);
  if (i.goal.chips.length || i.goal.text) L.push(`- Optimizing for: ${[...i.goal.chips, ...(i.goal.text ? [`"${i.goal.text}"`] : [])].join(', ')}`);
  L.push(`- Bracket aimed for: ${i.bracket ?? 'not set'}. Budget per card: ${i.budget ? `$${i.budget}` : 'any'}. Only cards they own: ${i.own ? 'yes' : 'no'}.`);
  if (i.rule) L.push(`- Deck rule: ${i.rule}`);
  if (i.neverCut.length) L.push(`- Never cut: ${i.neverCut.join(', ')}`);
  if (i.notes.length) L.push('', "The owner's notes, in their words:", ...i.notes.map((n) => `- ${n}`));
  const e = i.edits;
  const fixed: string[] = [];
  if (e.plan) fixed.push(`- plan${i.ownPlan ? ' (the owner wrote it)' : ''}: ${e.plan}`);
  if (e.winRoutes) fixed.push(`- winRoutes: ${JSON.stringify(e.winRoutes)}`);
  if (e.keyCards) fixed.push(`- keyCards: ${JSON.stringify(e.keyCards)}`);
  if (e.themes) fixed.push(`- themes: ${JSON.stringify(e.themes)}`);
  if (e.roles && Object.keys(e.roles).length) fixed.push(`- card roles: ${Object.entries(e.roles).map(([n, r]) => `${n} = ${r}`).join('; ')}`);
  if (fixed.length) L.push('', 'Fixed by the owner: copy these exactly as given, and build everything else around them:', ...fixed);
  return L.join('\n');
}

/** The read's answer, kept to cards in the deck and the shapes the app uses. */
export function parsePass(data: unknown, deckNames: string[], nonland: string[]): PassOutput {
  const d = (data ?? {}) as Record<string, unknown>;
  const byFront = new Map(deckNames.map((n) => [front(n), n]));
  const nameOf = (x: unknown) => (typeof x === 'string' ? byFront.get(front(x)) ?? null : null);
  const names = (xs: unknown, max = 40) => [...new Set((Array.isArray(xs) ? xs : []).map(nameOf).filter((x): x is string => !!x))].slice(0, max);
  const groups = (xs: unknown): Array<{ name: string; cards: string[] }> => (Array.isArray(xs) ? xs : [])
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => ({ name: String(x.name ?? '').trim().slice(0, 80), cards: names(x.cards, 30) })).filter((x) => x.name && x.cards.length).slice(0, 10);
  const cards: PassOutput['cards'] = {};
  const nonlandSet = new Set(nonland.map(front));
  for (const c of Array.isArray(d.cards) ? d.cards : []) {
    const x = c as Record<string, unknown>;
    const n = nameOf(x.name);
    if (!n || !nonlandSet.has(front(n)) || !isCardRole(x.role)) continue;
    cards[n] = { role: x.role, note: String(x.note ?? '').slice(0, 80) };
  }
  const state: DeckState = d.state === 'unfocused' || d.state === 'no_plan' ? d.state : 'focused';
  const cmd = (d.commander ?? {}) as Record<string, unknown>;
  return {
    state,
    plan: String(d.plan ?? '').trim().slice(0, 1500),
    winRoutes: groups(d.winRoutes),
    keyCards: names(d.keyCards, 8),
    themes: groups(d.themes),
    cards,
    questions: (Array.isArray(d.questions) ? d.questions : []).filter((q): q is string => typeof q === 'string' && !!q.trim()).map((q) => q.trim().slice(0, 300)).slice(0, 3),
    summary: String(d.summary ?? '').trim().slice(0, 600),
    commander: { roles: (Array.isArray(cmd.roles) ? cmd.roles : []).filter((r): r is CommanderRole => isCommanderRole(r) && r !== 'unsure').slice(0, 4), why: String(cmd.why ?? '').slice(0, 400) },
  };
}

/** The read with the owner's edits on top: every part they set is theirs, whatever the read said. */
export function withEdits(out: PassOutput, e: OwnerEdits): PassOutput {
  const cards = { ...out.cards };
  for (const [n, r] of Object.entries(e.roles ?? {})) cards[n] = { role: r, note: cards[n]?.note ?? '' };
  return {
    ...out,
    plan: e.plan ?? out.plan,
    winRoutes: e.winRoutes ?? out.winRoutes,
    keyCards: e.keyCards ?? out.keyCards,
    themes: e.themes ?? out.themes,
    cards,
  };
}

interface PassRow { id: string; listId: string; profileId: string | null; at: string; model: string; promptVersion: string; deckHash: string; deckKeys: string; commanderName: string | null; input: string; output: string }
export interface Pass { id: string; at: string; model: string; deckHash: string; deckKeys: string[]; commanderName: string | null; input: PassInput & { oneAway?: Array<{ cards: string[]; missing: string[] }> }; output: PassOutput }

export function latestPass(listId: string): Pass | null {
  const r = db().get('SELECT * FROM plan_passes WHERE listId = ? ORDER BY at DESC LIMIT 1', [listId]) as PassRow | null;
  return r ? { id: r.id, at: r.at, model: r.model, deckHash: r.deckHash, deckKeys: parse<string[]>(r.deckKeys, []), commanderName: r.commanderName, input: parse(r.input, {} as Pass['input']), output: parse(r.output, {} as PassOutput) } : null;
}

const isLand = (c: { card: Parameters<typeof primaryType>[0] }) => primaryType(c.card) === 'Lands';

/** Everything the read takes in, gathered from the app. */
export async function gatherInput(list: List): Promise<{ input: PassInput; facts: Facts; md: string }> {
  const main = cardsInList(list.id).filter((c) => c.board === 'main');
  const commanders = [list.commander?.name, ...main.filter((c) => c.slot === 'partner').map((c) => c.card.name)].filter((x): x is string => !!x);
  const { facts, md } = await planFacts(list, list.id, list.name, commanders);
  const plan = planFor(list.id, '', list.commander, main);
  const kept = keeps(list.id);
  const o = owner(list.id);
  const input: PassInput = {
    commanderRoles: o.commanderRoles,
    goal: { chips: plan.goal.chips, text: plan.goal.text },
    bracket: plan.bracket, budget: plan.budget, own: plan.own, rule: plan.rule.text,
    neverCut: main.filter((c) => kept.has(c.card.oracle_id ?? c.card.id)).map((c) => c.card.name),
    notes: plan.notes.filter((n) => noteBy(n) === 'owner').map((n) => n.text),
    edits: o.edits, ownPlan: o.ownPlan,
  };
  return { input, facts: facts as unknown as Facts, md };
}

/**
 * Read the deck, store the answer with the deck's fingerprint, and log its
 * questions. A new read unconfirms the plan and opens its questions.
 */
export async function runPass(model: JsonModel, list: List, profileId: string | null, progress: (s: string) => void = () => {}): Promise<Pass> {
  progress('Gathering the deck’s facts');
  const { input, facts, md } = await gatherInput(list);
  const main = cardsInList(list.id).filter((c) => c.board === 'main');
  const deckNames = [...(list.commander ? [list.commander.name] : []), ...main.map((c) => c.card.name)];
  const nonland = main.filter((c) => !isLand(c) && c.slot !== 'partner').map((c) => c.card.name);
  progress('Claude is reading the deck');
  const answer = await model({
    step: 'read the plan',
    system: PASS_SYSTEM,
    user: `${md}\n${ownerText(input)}\n`,
    schema: SCHEMA,
    promptOnly: true,
    thinking: 'high',
    timeoutMs: 6 * 60_000,
  }, { maxBusy: 1 });
  const output = parsePass(answer.data, deckNames, nonland);
  const pass: Pass = {
    id: randomUUID(), at: now(), model: answer.model, deckHash: deckHash(list.commander, main), deckKeys: deckKeys(list.commander, main),
    commanderName: list.commander?.name ?? null,
    input: { ...input, oneAway: (facts.combos.oneAway ?? []).map((c) => ({ cards: c.cards, missing: c.missing })) },
    output,
  };
  db().run('INSERT INTO plan_passes (id, listId, profileId, at, model, promptVersion, deckHash, deckKeys, commanderName, input, output) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [pass.id, list.id, profileId, pass.at, pass.model, PROMPT_VERSIONS.planPass, pass.deckHash, JSON.stringify(pass.deckKeys), pass.commanderName, JSON.stringify(pass.input), JSON.stringify(output)]);
  updateOwner(list.id, (o) => { o.confirmedAt = null; o.useStalePass = null; o.questionsDone = output.questions.length ? null : pass.id; });
  if (profileId) quietly(() => { for (const q of output.questions) logConversation(profileId, list.id, 'plan', 'question_asked', q, PROMPT_VERSIONS.planPass); });
  return pass;
}

// --- the view -------------------------------------------------------------------------------

/** Whether a read no longer matches the deck, and why. */
export function staleness(pass: Pass, list: Pick<List, 'id' | 'commander'>, keyCards: string[]): NonNullable<PlanView['stale']> | null {
  const main = cardsInList(list.id).filter((c) => c.board === 'main');
  const changed = cardsChanged(pass.deckKeys, deckKeys(list.commander, main));
  const commander = (pass.commanderName ?? null) !== (list.commander?.name ?? null);
  const inDeck = new Set([...main.map((c) => front(c.card.name)), ...(list.commander ? [front(list.commander.name)] : [])]);
  const keyCardsGone = keyCards.filter((k) => !inDeck.has(front(k)));
  if (changed < STALE_CARDS && !commander && !keyCardsGone.length) return null;
  return { changed, commander, keyCardsGone, usingAnyway: owner(list.id).useStalePass === pass.id };
}

export function planView(list: Pick<List, 'id' | 'commander'>): PlanView {
  const o = owner(list.id);
  const main = cardsInList(list.id).filter((c) => c.board === 'main');
  const nonland = main.filter((c) => !isLand(c)).reduce((n, c) => n + c.quantity, 0);
  const job = latestJob('planpass', list.id);
  const latest = latestPass(list.id);
  const notes = planFor(list.id, '', list.commander, main).notes.filter((n) => noteBy(n) === 'owner').length;
  const running = job && (job.status === 'running' || (job.status === 'failed' && (!latest || job.startedAt > latest.at)))
    ? { id: job.id, status: job.status, progress: job.detail || null, error: job.status === 'failed' ? job.error ?? 'The read failed' : null } : null;
  const edits = Object.keys(o.edits).length;
  if (!latest) {
    // A plan the owner wrote with no read yet.
    const ownOnly = o.ownPlan && o.edits.plan ? {
      id: 'own', at: '', model: '', state: 'focused' as DeckState, plan: o.edits.plan, winRoutes: o.edits.winRoutes ?? [], keyCards: o.edits.keyCards ?? [], themes: o.edits.themes ?? [],
      cards: {}, summary: '', yours: { plan: true, routes: (o.edits.winRoutes ?? []).map((r) => r.name), routeCards: [], keyCards: o.edits.keyCards ?? [], themes: (o.edits.themes ?? []).map((t) => t.name) },
      questions: [], oneAway: [], commander: null, ownPlan: true, commanderRolesRead: o.commanderRoles,
    } : null;
    return { commanderRoles: o.commanderRoles, nonland, job: running, pass: ownOnly, edits, confirmed: o.confirmedAt ? { at: o.confirmedAt } : null, stale: null, reads: { notes, commanderRoles: o.commanderRoles.length } };
  }
  const out = latest.output;
  const shown = withEdits(out, o.edits);
  const stale = staleness(latest, list, shown.keyCards);
  const readRoutes = new Set(out.winRoutes.map((r) => r.name));
  const readRouteCards = new Set(out.winRoutes.flatMap((r) => r.cards));
  const routeCards = new Set(shown.winRoutes.flatMap((r) => r.cards).map(front));
  const confirmed = o.confirmedAt ? { at: o.confirmedAt } : null;
  return {
    commanderRoles: o.commanderRoles, nonland, job: running, edits, confirmed, stale,
    reads: { notes, commanderRoles: o.commanderRoles.length },
    pass: {
      id: latest.id, at: latest.at, model: latest.model, state: shown.state, plan: shown.plan, winRoutes: shown.winRoutes, keyCards: shown.keyCards, themes: shown.themes,
      cards: Object.fromEntries(Object.entries(shown.cards).map(([n, c]) => [n, { ...c, yours: !!o.edits.roles?.[n] }])),
      summary: shown.summary,
      yours: {
        plan: !!o.edits.plan,
        routes: o.edits.winRoutes ? shown.winRoutes.filter((r) => !readRoutes.has(r.name)).map((r) => r.name) : [],
        routeCards: o.edits.winRoutes ? shown.winRoutes.flatMap((r) => r.cards).filter((c) => !readRouteCards.has(c)) : [],
        keyCards: o.edits.keyCards ? shown.keyCards.filter((k) => !out.keyCards.includes(k)) : [],
        themes: o.edits.themes ? shown.themes.filter((t) => !out.themes.some((x) => x.name === t.name)).map((t) => t.name) : [],
      },
      questions: !stale && !confirmed && o.questionsDone !== latest.id ? out.questions : [],
      oneAway: (latest.input.oneAway ?? []).filter((c) => c.missing.length === 1 && c.cards.some((n) => routeCards.has(front(n)))).slice(0, 4).map((c) => ({ cards: c.cards, missing: c.missing[0] })),
      commander: o.commanderRoles.includes('unsure') && confirmed && nonland >= SUGGEST_COMMANDER_AT && out.commander.roles.length ? out.commander : null,
      ownPlan: o.ownPlan,
      commanderRolesRead: latest.input.commanderRoles ?? [],
    },
  };
}

/**
 * The plan as later AI steps get it, or null: no read, or one out of date that
 * the owner has not said to use anyway. Owner's notes are added separately
 * (plan-context.ts).
 */
export function planForAi(list: Pick<List, 'id' | 'commander'>): { text: string; passId: string } | null {
  const view = planView(list);
  const p = view.pass;
  if (!p || (view.stale && !view.stale.usingAnyway)) return null;
  const roles = view.commanderRoles.filter((r) => r !== 'unsure').map((r) => COMMANDER_ROLES.find((x) => x.id === r)!.label);
  const byRole = new Map<string, string[]>();
  for (const [n, c] of Object.entries(p.cards)) byRole.set(c.role, [...(byRole.get(c.role) ?? []), n]);
  const L = [
    `The deck's plan (${p.ownPlan ? "the owner's" : `read by ${p.model}`}${view.confirmed ? ', confirmed by the owner' : ', not yet confirmed'}${view.stale ? ', out of date but the owner chose to use it' : ''}):`,
    p.plan,
    ...(roles.length ? [`What the commander does for the deck (the owner's pick): ${roles.join(', ')}`] : []),
    ...(p.winRoutes.length ? [`Ways to win: ${p.winRoutes.map((r) => `${r.name} (${r.cards.join(', ')})`).join('; ')}`] : []),
    ...(p.keyCards.length ? [`Key cards: ${p.keyCards.join(', ')}`] : []),
    ...(p.themes.length ? [`Themes: ${p.themes.map((t) => `${t.name} (${t.cards.length} cards)`).join('; ')}`] : []),
    ...['engine', 'win', 'payoff', 'enabler'].filter((r) => byRole.has(r)).map((r) => `Cards read as ${r}: ${byRole.get(r)!.join(', ')}`),
  ];
  return { text: L.join('\n'), passId: p.id };
}
