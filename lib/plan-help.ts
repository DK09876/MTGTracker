/**
 * The Plan tab: what the owner wants the deck to be. They set what they
 * know and leave the rest on Not sure. The optional AI helper (one Opus
 * call, prompt "plan-help-3") suggests what is missing - a commander role
 * and a bracket while those are on Not sure, how the deck wins (or a fuller
 * version of the owner's words), ways to win and key cards not yet listed,
 * up to three questions, and for a pile with no plan, two or three
 * directions to pick from. Nothing it returns is part of the plan until the
 * owner taps Accept.
 *
 *   plan_owner  per deck: commander roles and who set them, how the deck
 *               wins and who wrote it, the picked direction, answers typed
 *               so far, questions skipped before, confirmation
 *   plan_helps  one row per AI run: the input and the answer as the code
 *               kept it
 *
 * Ways to win and key cards are categories (lib/categories.ts), the same
 * records the Tags tab shows. Settings (goal, bracket, budget, rule,
 * notes) live in the deck's plan (deck-plan.ts); never-cut is the deck's
 * keep list (deck-roles.ts). Server only.
 */

import { randomUUID } from 'node:crypto';

import { ModelError, type JsonModel } from './ai';
import {
  addCategory, cardMark, categories, clearSkips, ensurePlanColumns, fromKeys, goneKeys, keyCategoryId, markFrom, markSkipped, setCategoryCard, skippedKeys,
  type Category,
} from './categories';
import { cardsInList, database, type List } from './db';
import { deckHash } from './deck-hash';
import { changePlan, GOALS, noteBy, planFor } from './deck-plan';
import { jobCards, keeps, setKeep } from './deck-roles';
import { latestJob } from './jobs';
import { planFacts } from './plan-facts';
import {
  COMMANDER_ROLES, MAX_KEY_SUGGESTIONS, MAX_QUESTIONS, type CommanderRole, type DeckState, type HelpAnswer, type PlanAction, type PlanState, type Who,
} from './plan-help-shared';
import { isCommanderRole } from './plan-shared';
import { PROMPT_VERSIONS } from './prompt-versions';
import { primaryType } from './deckview';
import { estimateCost } from './ai-estimate';
import { clearOutcome, logConversation, logOutcome, logShown, quietly } from './suggestion-log';
import { tagKey } from './tags';

/** Opus only on the deck pages: no cheaper model (FINDINGS, Session 3). */
export const HELP_MODEL = 'claude-opus-5-5';

let ready = false;
function db() {
  const d = database();
  if (!ready) {
    ensurePlanColumns();
    const cols = (d.all('PRAGMA table_info(plan_owner)') as Array<{ name: string }>).map((c) => c.name);
    for (const [col, def] of [['skippedQuestions', "TEXT NOT NULL DEFAULT '[]'"], ['confirmedCommander', 'TEXT'], ['helpDone', 'TEXT']] as const) {
      if (!cols.includes(col)) d.run(`ALTER TABLE plan_owner ADD COLUMN ${col} ${def}`);
    }
    d.run(`CREATE TABLE IF NOT EXISTS plan_helps (
      id TEXT PRIMARY KEY, listId TEXT NOT NULL, profileId TEXT, at TEXT NOT NULL, model TEXT NOT NULL, promptVersion TEXT NOT NULL,
      deckHash TEXT NOT NULL, commanderName TEXT, input TEXT NOT NULL, output TEXT NOT NULL)`);
    d.run('CREATE INDEX IF NOT EXISTS idx_plan_helps_list ON plan_helps (listId, at)');
    ready = true;
  }
  return d;
}

const now = () => new Date().toISOString();
const front = (n: string) => n.split(' // ')[0].trim().toLowerCase();
const parse = <T>(s: string | null | undefined, fallback: T): T => { try { return s ? JSON.parse(s) as T : fallback; } catch { return fallback; } };
const low = (s: string) => s.trim().toLowerCase();

// --- the owner's side ----------------------------------------------------------------

/** saved: questions whose answer already went to the notes (on a confirmed plan); they leave the list. */
interface Drafts { helpId: string | null; answers: Record<string, string>; skipped: string[]; saved?: string[] }
interface Owner {
  commanderRoles: CommanderRole[]; commanderBy: Who; planText: string; planBy: Who; direction: string | null;
  confirmedAt: string | null; confirmedCommander: string | null; drafts: Drafts | null; skippedQuestions: string[]; helpDone: string | null;
}

export function owner(listId: string): Owner {
  const r = db().get('SELECT * FROM plan_owner WHERE listId = ?', [listId]) as Record<string, string | null> | null;
  const roles = parse<string[]>(r?.commanderRoles, []).filter(isCommanderRole);
  return {
    commanderRoles: roles.length ? roles : ['unsure'], commanderBy: r?.commanderBy === 'ai' ? 'ai' : 'owner',
    planText: r?.planText ?? '', planBy: r?.planBy === 'ai' ? 'ai' : 'owner', direction: r?.direction ?? null,
    confirmedAt: r?.confirmedAt ?? null, confirmedCommander: r?.confirmedCommander ?? null,
    drafts: parse<Drafts | null>(r?.drafts, null), skippedQuestions: parse<string[]>(r?.skippedQuestions, []), helpDone: r?.helpDone ?? null,
  };
}

function saveOwner(listId: string, o: Owner): void {
  db().run(`INSERT INTO plan_owner (listId, commanderRoles, edits, updatedAt) VALUES (?, '[]', '{}', ?) ON CONFLICT(listId) DO NOTHING`, [listId, now()]);
  db().run(`UPDATE plan_owner SET commanderRoles = ?, commanderBy = ?, planText = ?, planBy = ?, direction = ?, confirmedAt = ?, confirmedCommander = ?,
    drafts = ?, skippedQuestions = ?, helpDone = ?, updatedAt = ? WHERE listId = ?`,
  [JSON.stringify(o.commanderRoles), o.commanderBy, o.planText, o.planBy, o.direction, o.confirmedAt, o.confirmedCommander,
    o.drafts ? JSON.stringify(o.drafts) : null, JSON.stringify(o.skippedQuestions.slice(-30)), o.helpDone, now(), listId]);
}

function update(listId: string, fn: (o: Owner) => void): Owner {
  const o = owner(listId);
  fn(o);
  saveOwner(listId, o);
  return o;
}

/** Copy the plan's own row to a duplicated deck: how it wins, the commander's role, who set each, and the confirmation. */
export function copyPlanOwner(fromId: string, toId: string): void {
  const d = db();
  const cols = (d.all('PRAGMA table_info(plan_owner)') as Array<{ name: string }>).map((c) => c.name).filter((c) => c !== 'listId');
  d.run(`INSERT OR IGNORE INTO plan_owner (listId, ${cols.join(', ')}) SELECT ?, ${cols.join(', ')} FROM plan_owner WHERE listId = ?`, [toId, fromId]);
}

/** What the commander does: any of the roles, or Not sure alone. */
const cleanRoles = (roles: unknown[]): CommanderRole[] => {
  const picked = [...new Set(roles.filter(isCommanderRole))];
  const clean = picked.includes('unsure') && picked.length > 1 ? picked.filter((r) => r !== 'unsure') : picked;
  return clean.length ? clean : ['unsure'];
};

/** Whether the owner has confirmed the plan: Tune opens then. */
export function isConfirmed(listId: string): boolean {
  return !!owner(listId).confirmedAt;
}

// --- the AI helper -------------------------------------------------------------------

export const HELP_SYSTEM = `You are an experienced Commander deckbuilder inside a deck app. The owner pressed "Get AI suggestions" on the deck's Plan page.

The Plan page holds the owner's intent for the deck: what it is meant to do. Your job is to help them state that intent. You do not judge the deck, change it, or sort its cards.

You get the deck's facts (worked out by the app's code on this exact list) and everything the owner has set on the page.

Return only these fields:
- state: "focused" (the cards as they are support one clear plan), "unfocused" (two or more plans compete) or "no_plan" (the cards do not add up to a plan). This describes the list. It is not a verdict on what the owner set.
- fill: values for the fields the owner left as "not sure yet", and only those. commander: one or more roles and one sentence why. bracket: 1 to 5 and one sentence why. plan: 2-4 sentences on how the deck wins, its main engine and when. Leave out any field the owner set.
- fuller: only when the owner wrote how the deck wins. Their text made fuller, in 2-4 sentences: keep everything they said and add only what they left out (the main engine, when it happens, how it closes). Never change their meaning. Leave it out when theirs is already complete.
- winRoutes: ways to win the owner has not listed. Each has a short name, one sentence on how it wins, and its cards. Do not repeat, reword or correct the owner's.
- keyCards: cards the deck cannot function without that the owner has not listed. Suggest at most 5, however many the owner listed. Never the commander. Each has the card and one sentence on what the deck loses without it.
- questions: at most 3, written for THIS deck, each answerable in a sentence or two. Ask (a) where something the owner set and the cards point different ways, and (b) where the cards leave the owner's intent open. For (a), ask what they mean; never propose changing the setting. Put (a) first, and mark each (a) question with "aboutSetting": true. Ask only what would most change what to cut or add; a deck with one clear plan usually needs none. For (a), a list that plays below the bracket the owner set counts as much as one that plays above it. Never ask what the owner already told the app, or a question they skipped before.
- directions: only when state is "unfocused" or "no_plan" and the owner has not written a plan. Two or three directions these cards could support. Each has a short name, a plan of one or two sentences, and up to 8 cards already in the list that fit it. When you return directions, leave out fill.plan, winRoutes and keyCards: the owner picks a direction first.
- summary: 2 sentences in plain words for the owner.

Rules:
- What the owner set is given. Write everything for the deck they describe, even where the list today looks different.
- Do not give cards roles or categories. A later step does that.
- Do not suggest cuts, adds or swaps. Tune does that.
- Do not judge the counts (lands, ramp, draw). The app's code does that.
- Judge from the rules text and this deck, not from how popular a card is.
- Use card names exactly as they appear in the list.
- Think it through privately; the answer holds only the fields asked for.

Commander roles (use these ids): ${COMMANDER_ROLES.filter((r) => r.id !== 'unsure').map((r) => `"${r.id}" (${r.label}: ${r.tip})`).join('; ')}.

Brackets: 1 Exhibition: themes first, no Game Changers; 2 Core: like a precon, no Game Changers; 3 Upgraded: up to three Game Changers; 4 Optimized: anything goes but cEDH; 5 cEDH: built to win fast.

Answer with one JSON object, nothing else:
{"state": "focused|unfocused|no_plan",
 "fill": {"commander": {"roles": ["id"], "why": "..."}, "bracket": {"level": 3, "why": "..."}, "plan": "..."},
 "fuller": "...",
 "winRoutes": [{"name": "...", "how": "...", "cards": ["..."]}],
 "keyCards": [{"card": "...", "why": "..."}],
 "questions": [{"text": "...", "aboutSetting": false}],
 "directions": [{"name": "...", "plan": "...", "cards": ["..."]}],
 "summary": "..."}
"fuller" and any part of "fill" are left out when they do not apply; lists are empty when there is nothing to return.`;

/** What the owner has set, as the helper reads it: a field on Not sure says so. */
export interface HelpInput {
  commanderRoles: CommanderRole[];
  goal: { chips: string[]; text: string };
  bracket: number | null;
  budget: number | null;
  own: boolean;
  rule: string;
  neverCut: string[];
  plan: string;
  wins: Array<{ name: string; cards: string[] }>;
  keyCards: string[];
  notes: string[];
  skippedQuestions: string[];
}

export function ownerText(i: HelpInput): string {
  const roles = i.commanderRoles.filter((r) => r !== 'unsure');
  const goal = [...i.goal.chips, ...(i.goal.text ? [`"${i.goal.text}"`] : [])];
  const L = [
    '## What the owner set on the Plan page',
    `- What the commander does for the deck: ${roles.length ? roles.map((r) => COMMANDER_ROLES.find((x) => x.id === r)!.label).join(', ') : 'not sure yet (work it out)'}`,
    `- What they want from the deck: ${goal.length ? goal.join(', ') : 'nothing said'}`,
    `- Bracket aimed for: ${i.bracket ?? 'not sure yet (work it out)'}`,
    `- Budget per card: ${i.budget ? `$${i.budget}` : 'any'}. Only cards they own: ${i.own ? 'yes' : 'no'}.${i.rule ? ` Deck rule: ${i.rule}` : ''}`,
    `- Never cut: ${i.neverCut.join(', ') || 'nothing marked'}`,
    `- How the deck wins, in their words: ${i.plan ? `"${i.plan}"` : 'not written yet (work it out)'}`,
    `- Ways to win they listed: ${i.wins.length ? i.wins.map((w) => `${w.name} (${w.cards.join(', ') || 'no cards yet'})`).join('; ') : 'none'}`,
    `- Key cards they listed: ${i.keyCards.join(', ') || 'none'}`,
  ];
  if (i.notes.length) L.push('', "The owner's notes, in their words:", ...i.notes.map((n) => `- ${n}`));
  if (i.skippedQuestions.length) L.push('', 'Questions the owner skipped before (do not ask them again):', ...i.skippedQuestions.map((q) => `- ${q}`));
  return L.join('\n');
}

/** An answer that came back unusable: the run fails and nothing is stored. */
export class BadHelp extends ModelError {
  constructor(why: string) { super(`The AI answer came back unusable: ${why}. Nothing was saved; try again.`); }
}

/**
 * The helper's answer, kept to the deck and to what the owner left open:
 * unknown card names dropped, a field the owner set dropped even if AI filled
 * it, at most 5 key cards and 3 questions, and nothing but directions for a
 * pile with no plan written.
 */
export function parseHelp(data: unknown, deckNames: string[], commanders: string[], set: { commander: boolean; bracket: boolean; plan: boolean }): HelpAnswer {
  const d = (data ?? {}) as Record<string, unknown>;
  if (d.state !== 'focused' && d.state !== 'unfocused' && d.state !== 'no_plan') throw new BadHelp('it didn’t say whether the deck has a plan');
  const byFront = new Map(deckNames.map((n) => [front(n), n]));
  const cmd = new Set(commanders.map(front));
  const nameOf = (x: unknown) => (typeof x === 'string' ? byFront.get(front(x)) ?? null : null);
  const names = (xs: unknown, max: number) => [...new Set((Array.isArray(xs) ? xs : []).map(nameOf).filter((x): x is string => !!x))].slice(0, max);
  const str = (x: unknown, max: number) => (typeof x === 'string' ? x.trim().slice(0, max) : '');
  const fillIn = (d.fill ?? {}) as Record<string, unknown>;
  const fill: HelpAnswer['fill'] = {};
  const c = (fillIn.commander ?? null) as Record<string, unknown> | null;
  const cRoles = c && Array.isArray(c.roles) ? c.roles.filter((r): r is CommanderRole => isCommanderRole(r) && r !== 'unsure').slice(0, 3) : [];
  if (!set.commander && cRoles.length) fill.commander = { roles: cRoles, why: str(c!.why, 400) };
  const b = (fillIn.bracket ?? null) as Record<string, unknown> | null;
  if (!set.bracket && b && [1, 2, 3, 4, 5].includes(Number(b.level))) fill.bracket = { level: Number(b.level), why: str(b.why, 400) };
  const directions = (Array.isArray(d.directions) ? d.directions : []).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => ({ name: str(x.name, 80), plan: str(x.plan, 600), cards: names(x.cards, 8) })).filter((x) => x.name && x.plan).slice(0, 3);
  const pile = d.state !== 'focused' && !set.plan && directions.length > 0;
  const planText = str(fillIn.plan, 1500);
  if (!set.plan && planText && !pile) fill.plan = planText;
  const fuller = set.plan ? str(d.fuller, 1500) : '';
  const winRoutes = pile ? [] : (Array.isArray(d.winRoutes) ? d.winRoutes : []).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => ({ name: str(x.name, 80), how: str(x.how, 300), cards: names(x.cards, 12) })).filter((x) => x.name && x.cards.length).slice(0, 6);
  // Key cards: {card, why} (plan-help-3), or plain names.
  const keyIn = (Array.isArray(d.keyCards) ? d.keyCards : []).map((x) => (typeof x === 'string' ? { card: x, why: '' } : x && typeof x === 'object' ? { card: (x as Record<string, unknown>).card ?? (x as Record<string, unknown>).name, why: str((x as Record<string, unknown>).why, 300) } : null)).filter((x): x is { card: unknown; why: string } => !!x);
  const keyWhy: Record<string, string> = {};
  for (const k of keyIn) { const n = nameOf(k.card); if (n && k.why && !keyWhy[n]) keyWhy[n] = k.why; }
  const keyCards = pile ? [] : names(keyIn.map((k) => k.card), 20).filter((n) => !cmd.has(front(n))).slice(0, MAX_KEY_SUGGESTIONS);
  const questions = (Array.isArray(d.questions) ? d.questions : [])
    .map((q) => (typeof q === 'string' ? { text: q.trim(), about: false } : q && typeof q === 'object' ? { text: str((q as Record<string, unknown>).text, 300), about: (q as Record<string, unknown>).aboutSetting === true } : null))
    .filter((q): q is { text: string; about: boolean } => !!q && !!q.text);
  // A question about something the owner set comes first.
  const ordered = [...questions.filter((q) => q.about), ...questions.filter((q) => !q.about)].slice(0, MAX_QUESTIONS).map((q) => ({ ...q, text: q.text.slice(0, 300) }));
  return {
    state: d.state, fill, ...(fuller ? { fuller } : {}), winRoutes, keyCards, keyWhy: Object.fromEntries(keyCards.filter((n) => keyWhy[n]).map((n) => [n, keyWhy[n]])), questions: ordered,
    directions: pile ? directions : [], summary: str(d.summary, 600),
  };
}

interface HelpRow { id: string; at: string; model: string; input: string; output: string; commanderName: string | null }
export interface Help { id: string; at: string; model: string; input: HelpInput; output: HelpAnswer }

export function latestHelp(listId: string): Help | null {
  const r = db().get('SELECT id, at, model, input, output, commanderName FROM plan_helps WHERE listId = ? ORDER BY at DESC LIMIT 1', [listId]) as HelpRow | null;
  return r ? { id: r.id, at: r.at, model: r.model, input: parse(r.input, {} as HelpInput), output: parse(r.output, {} as HelpAnswer) } : null;
}

const isLand = (c: { card: Parameters<typeof primaryType>[0] }) => primaryType(c.card) === 'Lands';

function commandersOf(list: Pick<List, 'id' | 'commander'>): string[] {
  const main = cardsInList(list.id).filter((c) => c.board === 'main');
  return [list.commander?.name, ...main.filter((c) => c.slot === 'partner').map((c) => c.card.name)].filter((x): x is string => !!x);
}

/** Everything the helper reads, from the page as it is. */
async function gather(list: List): Promise<{ input: HelpInput; md: string }> {
  const main = cardsInList(list.id).filter((c) => c.board === 'main');
  const commanders = commandersOf(list);
  const { md } = await planFacts(list, list.id, list.name, commanders);
  const plan = planFor(list.id, '', list.commander, main);
  const o = owner(list.id);
  const cats = await categories(list);
  const kept = keeps(list.id);
  return {
    md,
    input: {
      commanderRoles: o.commanderRoles, goal: { chips: plan.goal.chips, text: plan.goal.text }, bracket: plan.bracket, budget: plan.budget, own: plan.own, rule: plan.rule.text,
      neverCut: [...commanders.map((n) => `${n} (the commander)`), ...main.filter((c) => kept.has(tagKey(c.card))).map((c) => c.card.name)],
      plan: o.planText.trim(),
      wins: cats.filter((c) => c.kind === 'win').map((w) => ({ name: w.name, cards: w.cards.map((x) => x.name) })),
      keyCards: cats.find((c) => c.kind === 'key')?.cards.map((x) => x.name) ?? [],
      notes: plan.notes.filter((n) => noteBy(n) === 'owner').map((n) => n.text),
      skippedQuestions: o.skippedQuestions,
    },
  };
}

/**
 * Ask the helper, store what it suggested, and open it on the page. A new
 * run brings back what was skipped last time and starts the questions
 * afresh; what was accepted stays. A confirmed plan stays confirmed (Tune
 * stays open): nothing AI returns is part of the plan until it is accepted.
 */
export async function runHelp(model: JsonModel, list: List, profileId: string | null, progress: (s: string) => void = () => {}): Promise<Help> {
  progress('Gathering the deck’s facts');
  const { input, md } = await gather(list);
  const main = cardsInList(list.id).filter((c) => c.board === 'main');
  const deckNames = [...(list.commander ? [list.commander.name] : []), ...main.map((c) => c.card.name)];
  progress('AI is reading the deck');
  const answer = await model({
    step: 'plan suggestions', system: HELP_SYSTEM, user: `${md}\n${ownerText(input)}\n`, schema: { type: 'OBJECT' }, promptOnly: true, thinking: 'high', timeoutMs: 6 * 60_000,
  }, { maxBusy: 1 });
  const set = { commander: input.commanderRoles.some((r) => r !== 'unsure'), bracket: input.bracket !== null, plan: !!input.plan };
  const output = parseHelp(answer.data, deckNames, commandersOf(list), set);
  const help: Help = { id: randomUUID(), at: now(), model: answer.model, input, output };
  db().run('INSERT INTO plan_helps (id, listId, profileId, at, model, promptVersion, deckHash, commanderName, input, output) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [help.id, list.id, profileId, help.at, help.model, PROMPT_VERSIONS.planHelp, deckHash(list.commander, main), list.commander?.name ?? null, JSON.stringify(input), JSON.stringify(output)]);
  clearSkips(list.id, 'plan');
  update(list.id, (o) => { o.drafts = null; o.helpDone = null; });
  if (profileId) quietly(() => { for (const q of output.questions) logConversation(profileId, list.id, 'plan', 'question_asked', q.text, PROMPT_VERSIONS.planHelp); });
  return help;
}

// --- the view ------------------------------------------------------------------------

/** What a run has cost lately, from the AI usage trail, or null. */

const qId = (helpId: string, i: number) => `${helpId.slice(0, 8)}-q${i}`;

interface Open {
  commander: HelpAnswer['fill']['commander'] | null;
  bracket: HelpAnswer['fill']['bracket'] | null;
  plan: string | null;
  fuller: string | null;
  wins: HelpAnswer['winRoutes'];
  keys: Array<{ key: string; name: string; why: string }>;
}

/** The last run's suggestions still waiting: not set since, not skipped, not accepted, not removed before. */
function openOf(listId: string, help: Help | null, o: Owner, bracket: number | null, cats: Category[], deckKey: Map<string, string>, skip: Set<string> = skippedKeys(listId, 'plan')): Open {
  const none: Open = { commander: null, bracket: null, plan: null, fuller: null, wins: [], keys: [] };
  if (!help) return none;
  const out = help.output;
  const gone = goneKeys(listId);
  const from = fromKeys(listId);
  const wins = cats.filter((c) => c.kind === 'win');
  const key = cats.find((c) => c.kind === 'key');
  return {
    commander: out.fill?.commander && o.commanderRoles.includes('unsure') && !skip.has('commander') ? out.fill.commander : null,
    bracket: out.fill?.bracket && bracket === null && !skip.has('bracket') ? out.fill.bracket : null,
    plan: out.fill?.plan && !o.planText.trim() && !skip.has('plan') ? out.fill.plan : null,
    fuller: out.fuller && o.planBy === 'owner' && o.planText.trim() && !skip.has('fuller') ? out.fuller : null,
    // Matched by the suggestion's own key, so one accepted and then renamed doesn't come back as new.
    wins: (out.winRoutes ?? []).filter((w) => !skip.has(`win:${low(w.name)}`) && !gone.has(`win:${low(w.name)}`) && !from.has(`win:${low(w.name)}`) && !wins.some((c) => low(c.name) === low(w.name))),
    keys: (out.keyCards ?? []).map((n) => ({ key: deckKey.get(front(n)) ?? '', name: n, why: out.keyWhy?.[n] ?? '' }))
      .filter((k) => k.key && !skip.has(`key:${k.key}`) && !gone.has(cardMark('key:key cards', k.key)) && !key?.cards.some((x) => x.key === k.key)),
  };
}

export async function planState(list: Pick<List, 'id' | 'commander'>, profileId?: string): Promise<PlanState> {
  const main = cardsInList(list.id).filter((c) => c.board === 'main');
  const plan = planFor(list.id, '', list.commander, main);
  const o = owner(list.id);
  const cats = await categories(list, jobCards);
  const help = latestHelp(list.id);
  const deckKey = new Map<string, string>([...main.map((c) => [front(c.card.name), tagKey(c.card)] as [string, string]), ...(list.commander ? [[front(list.commander.name), tagKey(list.commander)] as [string, string]] : [])]);
  const open = openOf(list.id, help, o, plan.bracket, cats, deckKey);
  // What would still be waiting but was skipped: kept in view under "Show N skipped", each with Bring back.
  const all = openOf(list.id, help, o, plan.bracket, cats, deckKey, new Set());
  const roleWords = (roles: string[]) => roles.map((r) => COMMANDER_ROLES.find((x) => x.id === r)?.label ?? r).join(', ');
  const skipped: Array<{ what: string; label: string; text: string }> = [
    ...(all.commander && !open.commander ? [{ what: 'commander', label: 'What the commander does', text: roleWords(all.commander.roles) }] : []),
    ...(all.bracket && !open.bracket ? [{ what: 'bracket', label: 'Bracket', text: `Bracket ${all.bracket.level}` }] : []),
    ...(all.plan && !open.plan ? [{ what: 'plan', label: 'How the deck wins', text: all.plan }] : []),
    ...(all.fuller && !open.fuller ? [{ what: 'fuller', label: 'A fuller version of your plan', text: all.fuller }] : []),
    ...all.wins.filter((w) => !open.wins.some((x) => x.name === w.name)).map((w) => ({ what: `win:${low(w.name)}`, label: 'Way to win', text: w.name })),
    ...all.keys.filter((k) => !open.keys.some((x) => x.key === k.key)).map((k) => ({ what: `key:${k.key}`, label: 'Key card', text: k.name })),
  ];
  const drafts = help && o.drafts?.helpId === help.id ? o.drafts : { helpId: null, answers: {}, skipped: [] };
  const saved = new Set(drafts.saved ?? []);
  const questions = help && o.helpDone !== help.id ? (help.output.questions ?? []).map((q, i) => {
    const id = qId(help.id, i);
    return { id, text: q.text, about: q.about, answer: drafts.answers[id] ?? '', skipped: drafts.skipped.includes(id) };
  }).filter((q) => !saved.has(q.id)) : [];
  const openQ = questions.filter((q) => !q.skipped && !q.answer.trim()).length;
  const suggestions = (open.commander ? 1 : 0) + (open.bracket ? 1 : 0) + (open.plan ? 1 : 0) + (open.fuller ? 1 : 0) + open.wins.length + open.keys.length;
  const kept = keeps(list.id);
  const job = latestJob('planhelp', list.id);
  const running = job && (job.status === 'running' || (job.status === 'failed' && (!help || job.startedAt > help.at)))
    ? { id: job.id, status: job.status, progress: job.detail || null, error: job.status === 'failed' ? job.error ?? 'The AI suggestions failed' : null } : null;
  const commanders = commandersOf(list);
  const keyCat = cats.find((c) => c.kind === 'key') ?? null;
  const state: PlanState = {
    commanderNames: commanders.join(' and ') || 'The commander',
    commander: { roles: o.commanderRoles, by: o.commanderBy },
    bracket: { value: plan.bracket, by: plan.stored.bracket?.by === 'claude' ? 'ai' : 'owner' },
    goal: { chips: plan.goal.chips, text: plan.goal.text },
    goals: [...GOALS],
    neverCut: { commanders, cards: main.filter((c) => kept.has(tagKey(c.card)) && !commanders.includes(c.card.name)).map((c) => ({ key: tagKey(c.card), name: c.card.name })) },
    notes: plan.notes.filter((n) => noteBy(n) === 'owner').map((n) => ({ id: n.id, text: n.text })),
    plan: { text: o.planText, by: o.planBy, direction: o.direction },
    wins: cats.filter((c) => c.kind === 'win'),
    key: keyCat,
    cardNames: [...new Set([...commanders, ...main.filter((c) => !isLand(c) || true).map((c) => c.card.name)])].sort(),
    help: help ? {
      id: help.id, at: help.at, state: help.output.state, summary: help.output.summary, directions: help.output.directions ?? [],
      commander: open.commander ?? null, bracket: open.bracket ?? null, plan: open.plan, fuller: open.fuller, wins: open.wins, keys: open.keys, questions, skipped,
    } : null,
    open: { suggestions, questions: openQ },
    bulk: (open.commander ? 1 : 0) + (open.bracket ? 1 : 0) + (open.plan ? 1 : 0) + open.wins.length + open.keys.length,
    confirmed: o.confirmedAt ? { at: o.confirmedAt } : null,
    commanderChanged: !!o.confirmedAt && !!o.confirmedCommander && o.confirmedCommander !== (list.commander?.name ?? ''),
    job: running,
    hasKey: !!process.env.ANTHROPIC_API_KEY,
    cost: estimateCost(list.id, 'plan suggestions'),
    categoryCount: cats.filter((c) => c.kind !== 'key' || c.cards.length).length,
    jobs: cats.filter((c) => c.kind === 'job').map((c) => c.name),
    generatedAccepted: cats.some((c) => (c.kind === 'tag' || c.kind === 'own' || c.kind === 'job') && c.by !== 'owner'),
  };
  if (profileId && help) quietly(() => logShown(profileId, list.id, 'plan:help', [{
    key: 'plan:help', task: 'plan', method: 'ai', model: help.model, promptVersion: PROMPT_VERSIONS.planHelp, deckHash: deckHash(list.commander, main),
    items: [
      ...(open.commander ? [{ key: 'plan:commander', reasonShown: open.commander.why }] : []),
      ...(open.bracket ? [{ key: 'plan:bracket', reasonShown: open.bracket.why }] : []),
      ...(open.plan ? [{ key: 'plan:text', reasonShown: open.plan }] : []),
      ...(open.fuller ? [{ key: 'plan:fuller', reasonShown: open.fuller }] : []),
      ...open.wins.map((w) => ({ key: `plan:win:${low(w.name)}`, reasonShown: w.how })),
      ...open.keys.map((k) => ({ key: `plan:key:${k.key}`, cardIn: { oracleId: k.key, name: k.name }, reasonShown: k.why || 'Key card' })),
    ],
  }]));
  return state;
}

// --- changes -------------------------------------------------------------------------

/** A refusal the page shows as is. */
export class PlanRefused extends Error {}

const outcome = (listId: string, keys: string[], how: 'accepted' | 'refused') => quietly(() => logOutcome(listId, keys, how));

/** Add up to three of a direction's cards as AI key cards, replacing the last direction's. */
function pickDirection(list: Pick<List, 'id' | 'commander'>, d: { name: string; plan: string; cards: string[] }, deckKey: Map<string, string>) {
  const keyId = keyCategoryId(list.id);
  const prior = owner(list.id).direction;
  if (prior) {
    const help = latestHelp(list.id);
    const was = help?.output.directions?.find((x) => x.name === prior);
    for (const n of was?.cards.slice(0, 3) ?? []) {
      const key = deckKey.get(front(n));
      const row = key ? database().get(`SELECT source FROM deck_card_tags WHERE listId = ? AND tagId = ? AND cardKey = ?`, [list.id, keyId, key]) as { source: string } | null : null;
      if (key && row?.source === 'ai') database().run('DELETE FROM deck_card_tags WHERE listId = ? AND tagId = ? AND cardKey = ?', [list.id, keyId, key]);
    }
  }
  for (const n of d.cards.slice(0, 3)) { const key = deckKey.get(front(n)); if (key) setCategoryCard(list.id, keyId, { key, name: n }, true, 'ai'); }
  update(list.id, (o) => { o.planText = d.plan; o.planBy = 'ai'; o.direction = d.name; });
}

export async function act(list: Pick<List, 'id' | 'commander'>, profileId: string, a: PlanAction): Promise<void> {
  const id = list.id;
  const main = cardsInList(id).filter((c) => c.board === 'main');
  const deckKey = new Map<string, string>([...main.map((c) => [front(c.card.name), tagKey(c.card)] as [string, string]), ...(list.commander ? [[front(list.commander.name), tagKey(list.commander)] as [string, string]] : [])]);
  const keyOf = (name: string) => { const k = deckKey.get(front(name)); if (!k) throw new PlanRefused(`${name} is not in the deck`); return k; };
  const help = latestHelp(id);
  const plan = planFor(id, '', list.commander, main);
  const o = owner(id);
  const cats = await categories(list);
  const open = openOf(id, help, o, plan.bracket, cats, deckKey);
  const acceptWin = (w: { name: string; how: string; cards: string[] }) => {
    const catId = addCategory(id, { kind: 'win', name: w.name, by: 'ai', how: w.how, cards: w.cards.map((n) => ({ key: deckKey.get(front(n)) ?? '', name: n, by: 'ai' as const })).filter((c) => c.key) });
    markFrom(id, catId, `win:${low(w.name)}`);
    outcome(id, [`plan:win:${low(w.name)}`], 'accepted');
  };
  const acceptKey = (k: { key: string; name: string }) => { setCategoryCard(id, keyCategoryId(id), { key: k.key, name: k.name }, true, 'ai'); outcome(id, [`plan:key:${k.key}`], 'accepted'); };
  switch (a.action) {
    case 'commander':
      update(id, (x) => { x.commanderRoles = cleanRoles(Array.isArray(a.roles) ? a.roles : []); x.commanderBy = 'owner'; });
      return;
    case 'acceptCommander':
      if (!open.commander) throw new PlanRefused('Nothing to accept');
      update(id, (x) => { x.commanderRoles = open.commander!.roles; x.commanderBy = 'ai'; });
      outcome(id, ['plan:commander'], 'accepted');
      return;
    case 'skip': {
      const on = a.on !== false;
      markSkipped(id, 'plan', String(a.what), on);
      const k = a.what === 'plan' ? 'plan:text' : `plan:${a.what}`;
      // Bring back undoes the skip, and the refusal with it.
      if (on) outcome(id, [k], 'refused');
      else quietly(() => clearOutcome(id, [k]));
      return;
    }
    case 'goal':
      changePlan(id, { goal: { chips: (Array.isArray(a.chips) ? a.chips : []).filter((c) => (GOALS as readonly string[]).includes(c)), text: String(a.text ?? '').slice(0, 300) } });
      return;
    case 'bracket':
      changePlan(id, { bracket: a.value === null ? null : [1, 2, 3, 4, 5].includes(Number(a.value)) ? Number(a.value) : null });
      return;
    case 'acceptBracket':
      if (!open.bracket) throw new PlanRefused('Nothing to accept');
      changePlan(id, { bracket: open.bracket.level, by: 'claude' });
      outcome(id, ['plan:bracket'], 'accepted');
      return;
    case 'neverCut':
      if (a.add) setKeep(id, keyOf(a.add), true);
      if (a.remove) setKeep(id, keyOf(a.remove), false);
      return;
    case 'note':
      changePlan(id, { notes: { add: a.add?.trim() ? [a.add] : [], remove: a.remove, edit: a.edit, by: 'owner' } });
      return;
    case 'planText':
      update(id, (x) => { x.planText = String(a.text ?? '').slice(0, 2000); x.planBy = 'owner'; x.direction = null; });
      return;
    case 'acceptPlan':
      if (!open.plan) throw new PlanRefused('Nothing to accept');
      update(id, (x) => { x.planText = open.plan!; x.planBy = 'ai'; x.direction = null; });
      outcome(id, ['plan:text'], 'accepted');
      return;
    case 'acceptFuller':
      if (!open.fuller) throw new PlanRefused('Nothing to accept');
      update(id, (x) => { x.planText = open.fuller!; x.planBy = 'ai'; x.direction = null; });
      markSkipped(id, 'plan', 'fuller');
      outcome(id, ['plan:fuller'], 'accepted');
      return;
    case 'direction': {
      const d = help?.output.directions?.find((x) => x.name === a.name);
      if (!d) throw new PlanRefused('That direction is not on offer');
      pickDirection(list, d, deckKey);
      return;
    }
    case 'addWin':
      if (!String(a.name ?? '').trim()) throw new PlanRefused('Name the way to win first');
      addCategory(id, { kind: 'win', name: a.name, by: 'owner' });
      return;
    case 'acceptWin': {
      const w = open.wins.find((x) => x.name === a.name);
      if (!w) throw new PlanRefused('Nothing to accept');
      acceptWin(w);
      return;
    }
    case 'acceptAllWins':
      open.wins.forEach(acceptWin);
      return;
    case 'skipAllWins': {
      // Every suggested way to win still waiting, skipped at once; each stays under "Show N skipped".
      const what = open.wins.map((w) => `win:${low(w.name)}`);
      for (const w of what) markSkipped(id, 'plan', w);
      outcome(id, what.map((w) => `plan:${w}`), 'refused');
      return;
    }
    case 'acceptKey': {
      const k = open.keys.find((x) => x.name === a.name);
      if (!k) throw new PlanRefused('Nothing to accept');
      acceptKey(k);
      return;
    }
    case 'acceptAllKeys':
      open.keys.forEach(acceptKey);
      return;
    case 'skipAllKeys': {
      const what = open.keys.map((k) => `key:${k.key}`);
      for (const w of what) markSkipped(id, 'plan', w);
      outcome(id, what.map((w) => `plan:${w}`), 'refused');
      return;
    }
    case 'addKey':
      setCategoryCard(id, keyCategoryId(id), { key: keyOf(a.name), name: a.name }, true, 'owner');
      return;
    case 'acceptAll':
      // Everything but the fuller version (it replaces the owner's words) and the questions.
      if (open.commander) { update(id, (x) => { x.commanderRoles = open.commander!.roles; x.commanderBy = 'ai'; }); outcome(id, ['plan:commander'], 'accepted'); }
      if (open.bracket) { changePlan(id, { bracket: open.bracket.level, by: 'claude' }); outcome(id, ['plan:bracket'], 'accepted'); }
      if (open.plan) { update(id, (x) => { x.planText = open.plan!; x.planBy = 'ai'; x.direction = null; }); outcome(id, ['plan:text'], 'accepted'); }
      open.wins.forEach(acceptWin);
      open.keys.forEach(acceptKey);
      return;
    case 'skipAll': {
      // Everything still waiting: suggestions skipped (back on the next run), open questions skipped.
      const what = [
        ...(open.commander ? ['commander'] : []), ...(open.bracket ? ['bracket'] : []), ...(open.plan ? ['plan'] : []), ...(open.fuller ? ['fuller'] : []),
        ...open.wins.map((w) => `win:${low(w.name)}`), ...open.keys.map((k) => `key:${k.key}`),
      ];
      for (const w of what) markSkipped(id, 'plan', w);
      outcome(id, what.map((w) => (w === 'plan' ? 'plan:text' : `plan:${w}`)), 'refused');
      if (help && o.helpDone !== help.id) {
        const qs = (help.output.questions ?? []).map((_, i) => qId(help.id, i));
        update(id, (x) => {
          const d = x.drafts?.helpId === help.id ? x.drafts : { helpId: help.id, answers: {}, skipped: [] };
          d.skipped = [...new Set([...d.skipped, ...qs.filter((q) => !(d.answers[q] ?? '').trim())])];
          x.drafts = d;
        });
      }
      return;
    }
    case 'answer': {
      if (!help) return;
      const qs = (help.output.questions ?? []).map((_, i) => qId(help.id, i));
      if (!qs.includes(a.id)) return;
      update(id, (x) => {
        const d = x.drafts?.helpId === help.id ? x.drafts : { helpId: help.id, answers: {}, skipped: [] };
        const skip = a.skip;
        if (typeof skip === 'boolean') d.skipped = skip ? [...new Set([...d.skipped, a.id])] : d.skipped.filter((s) => s !== a.id);
        else d.answers = { ...d.answers, [a.id]: String(a.text ?? '').slice(0, 600) };
        x.drafts = d;
      });
      return;
    }
    case 'answerToNotes': {
      // On a confirmed plan an answer goes to the notes when it is saved, not when everything else is cleared.
      if (!o.confirmedAt) throw new PlanRefused('Answers go to your notes when you confirm the plan');
      if (!help) return;
      const i = (help.output.questions ?? []).findIndex((_, n) => qId(help.id, n) === a.id);
      const text = String(a.text ?? '').trim().slice(0, 600);
      if (i < 0 || !text) return;
      const q = help.output.questions[i];
      changePlan(id, { notes: { add: [`${q.text} ${text}`], by: 'owner' } });
      quietly(() => logConversation(profileId, id, 'plan', 'question_answered', `${q.text}\n${text}`, PROMPT_VERSIONS.planHelp));
      update(id, (x) => {
        const d = x.drafts?.helpId === help.id ? x.drafts : { helpId: help.id, answers: {}, skipped: [] };
        const answers = { ...d.answers };
        delete answers[a.id];
        x.drafts = { ...d, answers, saved: [...new Set([...(d.saved ?? []), a.id])] };
      });
      return;
    }
    case 'confirm': {
      if (o.confirmedAt) throw new PlanRefused('The plan is already confirmed');
      const s = await planState(list);
      if (s.open.suggestions || s.open.questions) {
        throw new PlanRefused(`Accept or skip ${s.open.suggestions} suggestion${s.open.suggestions === 1 ? '' : 's'}, and answer or skip ${s.open.questions} question${s.open.questions === 1 ? '' : 's'} first`);
      }
      const answered = (s.help?.questions ?? []).filter((q) => !q.skipped && q.answer.trim());
      const skipped = (s.help?.questions ?? []).filter((q) => q.skipped);
      if (answered.length) changePlan(id, { notes: { add: answered.map((q) => `${q.text} ${q.answer.trim()}`), by: 'owner' } });
      quietly(() => {
        for (const q of answered) logConversation(profileId, id, 'plan', 'question_answered', `${q.text}\n${q.answer}`, PROMPT_VERSIONS.planHelp);
        for (const q of skipped) logConversation(profileId, id, 'plan', 'question_skipped', q.text, PROMPT_VERSIONS.planHelp);
      });
      update(id, (x) => {
        x.confirmedAt = now(); x.confirmedCommander = list.commander?.name ?? '';
        x.skippedQuestions = [...x.skippedQuestions, ...skipped.map((q) => q.text)];
        x.helpDone = help?.id ?? null; x.drafts = null;
      });
      return;
    }
    default:
      throw new PlanRefused('Unknown action');
  }
}

export { type DeckState };
