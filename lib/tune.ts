/**
 * Tune for one deck: the suggestions for each intent, worked out from the
 * cards and the deck's confirmed plan - no model - and your changes with
 * what they would do to the deck. Claude's proposals (tune-claude.ts, the
 * cut review) join the same groups. Nothing here changes the deck until
 * applyChanges. Server only.
 */

import { allLocalCards, localCards } from './card-store';
import { deckIdentity } from './commanders';
import { deckCutList } from './cut-list';
import { lastReview } from './cut-review';
import { addCardToList, cachedRoles, cardsInList, database, deckTags, setQuantity, updateListCard, type List, type ListedCard } from './db';
import { drawKind, isImpulse, JOB_LABELS, jobsOf, landNumber, type Job, type JobId } from './deck-numbers';
import { planFor, planStyles, type Plan } from './deck-plan';
import { jobsOnDeck } from './categories';
import { planFlags } from './deck-context';
import { commanderRoles as rolesOfCommander, deckRoles, deckRolesKnown, keeps } from './deck-roles';
import type { Board } from './decklist';
import { filterCards } from './filter';
import { fitOf, fitProfile, quality, THEMES } from './fit';
import { gapCards, holdings } from './gap-cards';
import { goldfish, simCard, simDeck } from './goldfish';
import { farUnderLine, landsFarUnder } from './hard-checks';
import { analyse, deckFlags } from './health';
import { deckFacts } from './plan-server';
import { fixRoles, ROLES, ROLES_VERSION, type RoleCount } from './roles';
import { getCard, imageOf, manaCostOf, type ScryfallCard } from './scryfall';
import { guardCuts, type GuardRules } from './cut-guard';
import { cutBoard, type DeckSection } from './sections-shared';
import { sectionsOf } from './sections';
import { starterList } from './starter';
import { sameJob, type DeckCard } from './swaps';
import { PROMPT_VERSIONS } from './prompt-versions';
import { tuneStore, updateTune, newKey, type TuneStore } from './tune-store';
import {
  cutsLeft, suggestedIntent, type CardRef, type Changes, type CutFilter, type How, type Impact, type Intent, type Staged, type Suggestion, type SuggestionGroup, type Symptom,
} from './tune-shared';

const front = (name: string) => name.split(' // ')[0];
const short = (name: string) => name.split(',')[0];
const isLand = (c: ScryfallCard) => /\bLand\b/.test((c.type_line ?? '').split('//')[0]);
const isBasic = (c: ScryfallCard) => /\bBasic\b/.test(c.type_line ?? '');
const count = (list: Array<{ quantity: number }>) => list.reduce((n, c) => n + c.quantity, 0);
const JOBS: JobId[] = ['ramp', 'draw', 'interaction', 'protection', 'finishers'];
const BASIC: Record<string, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
const COLOR_NAME: Record<string, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };

/** The jobs a card does on its own, from its roles: what a swap matches on. */
export function cardJobs(card: ScryfallCard, roles: string[]): string[] {
  const out = new Set<string>();
  if (roles.includes('ramp')) out.add('ramp');
  if (roles.includes('draw') && !isImpulse(card) && drawKind(card) !== 'selection') out.add('draw');
  if (roles.some((r) => ['removal', 'counter', 'wipe'].includes(r))) out.add('interaction');
  if (roles.includes('protection')) out.add('protection');
  if (roles.includes('recursion')) out.add('recursion');
  if (roles.includes('tutor')) out.add('tutor');
  if (roles.some((r) => ['wincon', 'finisher', 'extra-turn', 'extra-combat', 'overrun', 'drain'].includes(r))) out.add('finishers');
  return [...out];
}

/** A card the app has stored (any card that was ever in a list), by printing id. */
function storedCard(id: string): ScryfallCard | null {
  const r = database().get('SELECT data FROM cards WHERE id = ?', [id]) as { data: string } | null;
  return r ? JSON.parse(r.data) as ScryfallCard : null;
}

/** A card as a suggestion shows it. */
export function ref(card: ScryfallCard, extra: Partial<CardRef> = {}): CardRef {
  return {
    id: card.id, name: card.name, cmc: card.cmc ?? 0, manaCost: manaCostOf(card), typeLine: card.type_line ?? '',
    image: imageOf(card, 'small'), price: card.prices?.usd ?? null, gameChanger: card.game_changer === true, ...extra,
  };
}

/** Everything the suggestions read, gathered once. */
export interface Context {
  list: List;
  profileId: string;
  all: ListedCard[];
  main: ListedCard[];
  sections: DeckSection[];
  plan: Plan;
  roles: RoleCount[];
  jobs: Job[];
  cmdRoles: string[];
  commanders: ScryfallCard[];
  identity: Set<string>;
  size: number;
  /** Cards in "Might go in" sections. */
  pool: ListedCard[];
  protectedWhy: Map<string, string>;
  /** What the current plan read says about cards worth a second look before cutting: flagged, never blocked. */
  flags: Map<string, { flag: string; strong: boolean }>;
  styles: Array<{ label: string; test: RegExp }>;
  rolesOf: (card: ScryfallCard) => string[];
  where: Map<string, string>;
  store: TuneStore;
  gcLimit: number | null;
}

/** The roles of any cards, from what is already known (the nightly card data) - nothing is searched. */
function knownRoles(cards: ScryfallCard[]): Map<string, string[]> {
  const ids = [...new Set(cards.map((c) => c.oracle_id).filter((x): x is string => !!x))];
  const { roles } = cachedRoles(ids, '1970-01-01', ROLES_VERSION);
  // Roles read from rules text (finishers, redirects) are not stored with the tagged ones.
  const textRoles = ROLES.filter((r) => r.text);
  const out = new Map<string, string[]>();
  for (const c of cards) {
    const text = [c.oracle_text, ...(c.card_faces ?? []).map((f) => f.oracle_text)].filter(Boolean).join('\n');
    out.set(c.oracle_id ?? c.id, [...new Set([...fixRoles(c, roles.get(c.oracle_id ?? '') ?? []), ...textRoles.filter((r) => r.text!.test(text)).map((r) => r.id)])]);
  }
  return out;
}

export async function tuneContext(list: List, profileId: string): Promise<Context> {
  const all = cardsInList(list.id);
  const main = all.filter((c) => c.board === 'main');
  const sections = sectionsOf(list.id);
  const tags = deckTags(list.id);
  const plan = planFor(list.id, tags.brief, list.commander, main);
  const [roles, cmdRoles] = await Promise.all([deckRoles(list.id, main).catch(() => [] as RoleCount[]), rolesOfCommander(list.commander).catch(() => [] as string[])]);
  // Only the jobs on the deck are counted and checked (lib/categories.ts).
  const onDeck = jobsOnDeck(list.id);
  const jobRows = roles.filter((r) => ((JOBS as string[]).includes(r.id) || r.id === 'impulse' || r.id === 'wipe') && onDeck.has(r.id === 'impulse' ? 'draw' : r.id))
    .map((r) => ({ id: r.id as JobId, label: r.label, group: r.group, count: r.count, cards: r.cards, range: r.target, how: r.how ?? { inputs: [], steps: [] } }));
  const partner = main.find((c) => c.slot === 'partner')?.card ?? null;
  const commanders = [list.commander, partner].filter((c): c is ScryfallCard => !!c);
  const inBoards = new Set(sections.filter((s) => s.purpose === 'in').map((s) => s.id as string));
  const pool = all.filter((c) => inBoards.has(c.board));
  const known = knownRoles([...all.map((c) => c.card), ...commanders]);
  // Never cut: the commanders and the owner's ★ never-cut list, nothing else (the owner's call, 2026-11-10).
  // The plan read's engines and key cards are flagged on a cut and ranked last, not blocked.
  const protectedWhy = new Map<string, string>();
  for (const c of commanders) protectedWhy.set(c.name, 'commander');
  const starred = keeps(list.id);
  for (const c of main) if (starred.has(c.card.oracle_id ?? c.card.id) && !protectedWhy.has(c.card.name)) protectedWhy.set(c.card.name, '★ never cut');
  const companion = all.find((c) => c.slot === 'companion')?.card;
  if (companion) protectedWhy.set(companion.name, 'companion');
  const size = count(main) + (list.commander ? 1 : 0);
  const bracket = plan.bracket;
  return {
    list, profileId, all, main, sections, plan, roles, jobs: jobRows, cmdRoles, commanders,
    identity: deckIdentity(commanders), size, pool, protectedWhy, flags: await planFlags(list).catch(() => new Map()),
    styles: planStyles(list.id, list.commander, main),
    rolesOf: (card) => known.get(card.oracle_id ?? card.id) ?? [],
    where: holdings(profileId, list.id),
    store: tuneStore(list.id),
    gcLimit: bracket === null ? null : bracket <= 2 ? 0 : bracket === 3 ? 3 : null,
  };
}

// --- the numbers, before and after your changes ------------------------------------

/** The deck as it would be with these changes. */
function changed(ctx: Context, changes: Changes): Array<{ card: ScryfallCard; quantity: number }> {
  const out = new Map(ctx.main.map((c) => [c.card.id, { card: c.card, quantity: c.quantity }]));
  for (const s of changes.cut) {
    const e = [...out.values()].find((c) => c.card.id === s.card.id || c.card.name === s.card.name);
    if (e) { e.quantity -= s.quantity; if (e.quantity <= 0) out.delete(e.card.id); }
  }
  const pool = [...ctx.all.map((c) => c.card), ...localCards(changes.add.filter((s) => !ctx.all.some((c) => c.card.id === s.card.id)).map((s) => s.card.name))];
  for (const s of changes.add) {
    const card = pool.find((c) => c.id === s.card.id) ?? pool.find((c) => c.name === s.card.name);
    if (!card) continue;
    const e = out.get(card.id) ?? [...out.values()].find((c) => c.card.name === card.name);
    if (e) e.quantity += s.quantity; else out.set(card.id, { card, quantity: s.quantity });
  }
  return [...out.values()];
}

/**
 * The jobs and lands of any version of the deck. The jobs are the one count
 * every page and every message to Claude uses (deckRolesKnown): the owner's
 * corrections and the cards they or accepted AI suggestions added to or took
 * out of a job are in, so cutting a card added to a job by hand takes it off.
 */
async function numbersOf(ctx: Context, cards: Array<{ card: ScryfallCard; quantity: number }>) {
  const jobs = (await deckRolesKnown(ctx.list.id, cards as ListedCard[])).filter((r) => (JOB_IDS as string[]).includes(r.id))
    .map((r) => ({ id: r.id as JobId, count: r.count, range: r.target ?? null }));
  const known = knownRoles(cards.map((c) => c.card));
  const lands = landNumber(cards, (c) => known.get(c.oracle_id ?? c.id) ?? [], ctx.plan.landNumber.mine ? ctx.plan.lands : null);
  const spells = cards.filter((c) => !isLand(c.card));
  const averageMv = count(spells) ? spells.reduce((n, c) => n + (c.card.cmc ?? 0) * c.quantity, 0) / count(spells) : 0;
  const gameChangers = [...ctx.commanders, ...cards.map((c) => c.card)].filter((c) => c.game_changer === true).length;
  return { jobs, lands, averageMv, gameChangers, size: count(cards) + (ctx.list.commander ? 1 : 0) };
}

const JOB_IDS: JobId[] = ['ramp', 'draw', 'impulse', 'interaction', 'wipe', 'protection', 'finishers'];

export async function impactOf(ctx: Context, changes: Changes): Promise<Impact> {
  const [b, a] = await Promise.all([numbersOf(ctx, ctx.main), numbersOf(ctx, changed(ctx, changes))]);
  // A range only for a job on the deck, as on the Cards tab: a job the deck doesn't count has no aim.
  const onDeck = jobsOnDeck(ctx.list.id);
  const rows = ['ramp', 'draw', 'impulse', 'interaction', 'protection', 'finishers'].map((id) => {
    const jb = b.jobs.find((j) => j.id === id);
    const ja = a.jobs.find((j) => j.id === id);
    return { id, label: JOB_LABELS[id as JobId], before: jb?.count ?? 0, after: ja?.count ?? 0, range: onDeck.has(id === 'impulse' ? 'draw' : id) ? ja?.range ?? null : null };
  });
  rows.push({ id: 'lands', label: 'Lands', before: b.lands.have, after: a.lands.have, range: ctx.plan.lands });
  return {
    size: { before: b.size, after: a.size },
    rows,
    averageMv: { before: Math.round(b.averageMv * 100) / 100, after: Math.round(a.averageMv * 100) / 100 },
    gameChangers: { before: b.gameChangers, after: a.gameChangers, limit: ctx.gcLimit },
  };
}

// --- shared pieces for the suggestions ------------------------------------------------

/** The deck's cards as the swap engine reads them. */
function deckCards(ctx: Context): DeckCard[] {
  const themes = ctx.plan.snapshot.themes ?? [];
  const routeCards = new Set(ctx.plan.snapshot.routeCards ?? []);
  return ctx.main.filter((c) => c.slot !== 'partner').map((c) => {
    const roles = ctx.roles.filter((r) => r.cards.includes(c.card.name)).map((r) => r.id);
    const text = [c.card.oracle_text, ...(c.card.card_faces ?? []).map((f) => f.oracle_text)].filter(Boolean).join('\n');
    return {
      card: c.card, quantity: c.quantity, roles,
      jobs: jobsOf(c.card.name, ctx.jobs, roles),
      plan: [...ctx.styles.filter((s) => s.test.test(text)).map((s) => s.label), ...themes.filter((t) => t.cards.includes(c.card.name)).map((t) => t.name)],
      protected: ctx.protectedWhy.get(c.card.name) ?? null,
      route: routeCards.has(c.card.name),
    };
  });
}

/** What the plan says a card plays to: its styles and themes. */
function planOf(ctx: Context, card: ScryfallCard): string[] {
  const text = [card.type_line, card.oracle_text, ...(card.card_faces ?? []).map((f) => f.oracle_text)].filter(Boolean).join('\n');
  const themes = (ctx.plan.snapshot.themes ?? []).filter((t) => {
    const def = THEMES.find((x) => x.name.toLowerCase() === t.id);
    return def ? def.card.test(text) : t.cards.includes(card.name);
  });
  return [...ctx.styles.filter((s) => s.test.test(text)).map((s) => s.label), ...themes.map((t) => t.name)];
}

/** Cards that may be suggested to add: in the colours, legal, not in the deck, within the bracket, budget, "only mine" and deck rule. */
export function addable(ctx: Context, cards: ScryfallCard[], gcRoom: number | null): ScryfallCard[] {
  const inDeck = new Set(ctx.all.filter((c) => c.board === 'main').map((c) => front(c.card.name)));
  for (const c of ctx.commanders) inDeck.add(front(c.name));
  const budget = ctx.plan.budget;
  let gcs = 0;
  let out = cards.filter((c) => (c.color_identity ?? []).every((x) => ctx.identity.has(x))
    && c.legalities?.commander === 'legal'
    && !inDeck.has(front(c.name))
    && (!ctx.plan.own || ctx.where.has(c.oracle_id ?? '') || ctx.pool.some((p) => p.card.name === c.name))
    && (budget === null || ctx.where.has(c.oracle_id ?? '') || Number(c.prices?.usd ?? 0) <= budget));
  if (ctx.plan.rule.filter?.trim()) out = filterCards(out.map((card) => ({ card })), ctx.plan.rule.filter).results.map((x) => x.card);
  out = out.filter((c) => {
    if (!c.game_changer) return true;
    if (gcRoom === null) return true;
    if (gcs < gcRoom) { gcs += 1; return true; }
    return false;
  });
  return out;
}

export const gcRoomOf = (ctx: Context) => (ctx.gcLimit === null ? null : Math.max(0, ctx.gcLimit - [...ctx.commanders, ...ctx.main.map((c) => c.card)].filter((c) => c.game_changer === true).length));

const whereOf = (ctx: Context, card: ScryfallCard) => {
  const inPool = ctx.pool.find((p) => p.card.name === card.name);
  if (inPool) return `in your ${ctx.sections.find((s) => s.id === inPool.board)?.name ?? 'Maybeboard'}`;
  return ctx.where.get(card.oracle_id ?? '') ?? null;
};

const rank = (ctx: Context, card: ScryfallCard) => {
  const fit = fitOf(card, fitProfile(ctx.list.commander));
  const q = quality(card, ctx.rolesOf(card));
  return { score: fit.score * 0.55 + q.score * 0.45 + (whereOf(ctx, card) ? 0.15 : 0), fit, q };
};

const reasonText = (ctx: Context, card: ScryfallCard) => {
  const r = rank(ctx, card);
  return [r.fit.matches.length ? `Fits ${short(ctx.list.commander?.name ?? 'the commander')}: ${r.fit.matches.join(', ')}` : '', r.q.reasons.join(', '), whereOf(ctx, card) ?? ''].filter(Boolean).join(' · ') || 'In your colours';
};

export function addItem(ctx: Context, key: string, card: ScryfallCard, why?: string, quantity = 1, how?: How): Suggestion {
  return { key, add: { ...ref(card, { where: whereOf(ctx, card), from: ctx.pool.find((p) => p.card.id === card.id)?.board }), quantity }, why: why ?? reasonText(ctx, card), how };
}

function cutItem(card: ScryfallCard, key: string, why: string, quantity = 1, how?: How, warn?: string): Suggestion {
  return { key, cut: { ...ref(card, { from: 'main' }), quantity }, why, how, warn };
}

// --- Lands ----------------------------------------------------------------------------------

export function landPlan(ctx: Context) {
  const health = analyse({ commander: ctx.list.commander, cards: ctx.main });
  const n = ctx.plan.landNumber;
  const range = ctx.plan.lands;
  const colors = health.colors.map((c) => ({ color: c.color, name: COLOR_NAME[c.color], share: Math.round(c.share * 100), sources: c.sources, needed: c.needed, neededFor: c.neededFor }));
  const groups: SuggestionGroup[] = [];
  const missing = Math.ceil(range[0] - n.have);
  const over = Math.floor(n.have - range[1]);
  const basics = (localCards(Object.values(BASIC)) as ScryfallCard[]);
  const basicOf = (color: string) => ctx.main.find((c) => c.card.name === BASIC[color])?.card ?? basics.find((b) => b.name === BASIC[color]);
  if (missing > 0 && colors.length) {
    // Basics go where a colour is furthest from what its hungriest spell needs, then by its share of the costs.
    const given: Record<string, number> = Object.fromEntries(colors.map((c) => [c.color, 0]));
    for (let i = 0; i < missing; i++) {
      const gap = (c: (typeof colors)[number]) => (c.needed ?? 0) - c.sources - given[c.color] + c.share / 100;
      const next = colors.reduce((best, c) => (gap(c) > gap(best) ? c : best), colors[0]);
      given[next.color] += 1;
    }
    const items = colors.filter((c) => given[c.color] && basicOf(c.color)).map((c) => addItem(ctx, `lands:add:${c.color}`, basicOf(c.color)!,
      `${COLOR_NAME[c.color][0].toUpperCase()}${COLOR_NAME[c.color].slice(1)}: ${c.sources} sources${c.needed ? ` of the ${c.needed} ${short(c.neededFor ?? '')} wants` : ''}, ${c.share}% of the costs`, given[c.color]));
    groups.push({ key: 'lands:add', title: `Add ${missing} basic${missing === 1 ? '' : 's'}`, why: `The deck has ${n.have} lands; the plan wants ${range[0]}–${range[1]}. Each basic goes to the colour furthest from what its hungriest spell needs.`, source: 'rules', items });
  } else if (over > 0 && colors.length) {
    const surplus = (c: (typeof colors)[number]) => c.sources - (c.needed ?? 0);
    const most = [...colors].sort((a, b) => surplus(b) - surplus(a))[0];
    const basic = ctx.main.find((c) => c.card.name === BASIC[most.color]);
    if (basic) groups.push({ key: 'lands:cut', title: `Cut ${over} ${basic.card.name}`, why: `The deck has ${n.have} lands; the plan wants ${range[0]}–${range[1]}. ${most.name[0].toUpperCase() + most.name.slice(1)} has the most to spare: ${most.sources} sources${most.needed ? ` for ${most.needed} needed` : ''}.`, source: 'rules',
      items: [cutItem(basic.card, `lands:cut:${most.color}`, `Lands are over the range; ${most.name} has the most sources to spare`, Math.min(over, basic.quantity))] });
  }
  const least = colors.length ? [...colors].sort((a, b) => (b.sources - (b.needed ?? 0)) - (a.sources - (a.needed ?? 0)))[0] : null;
  return { have: n.have, range, want: n.want, how: n.how, mine: n.mine, colors, groups, landCut: least ? BASIC[least.color] : null };
}

// --- Finish the deck ------------------------------------------------------------------

function finishGroups(ctx: Context): SuggestionGroup[] {
  if (!ctx.list.commander) return [];
  const pool = addable(ctx, allLocalCards(), gcRoomOf(ctx));
  const starter = starterList(ctx.list.commander, ctx.profileId, ctx.plan.own, pool);
  const lines = starter.lines.map((l) => { const m = l.match(/^(\d+)\s+(.+)$/)!; return { n: Number(m[1]), name: m[2] }; });
  const byName = new Map(localCards(lines.map((l) => l.name)).map((c) => [c.name, c]));
  const have = new Set(ctx.main.map((c) => front(c.card.name)));
  const used = new Set<string>();
  const groups: SuggestionGroup[] = [];
  const spells = lines.filter((l) => byName.get(l.name) && !isLand(byName.get(l.name)!) && !have.has(front(l.name))).map((l) => byName.get(l.name)!);
  // The starter's cards aren't in the deck yet: their roles come from the card data.
  const known = knownRoles(spells);
  const rolesFor = (c: ScryfallCard) => known.get(c.oracle_id ?? c.id) ?? [];
  // Lands: the plan's number, what is missing.
  const lp = landPlan(ctx);
  const landsShort = Math.max(0, Math.ceil(lp.range[0] - lp.have));
  if (landsShort) {
    const nonbasic = lines.filter((l) => byName.get(l.name) && isLand(byName.get(l.name)!) && !isBasic(byName.get(l.name)!) && !have.has(front(l.name))).map((l) => byName.get(l.name)!);
    const duals = nonbasic.slice(0, Math.min(nonbasic.length, Math.floor(landsShort / 2)));
    const items = duals.map((c) => addItem(ctx, `finish:lands:${c.name}`, c, `Makes ${(c.produced_mana ?? []).filter((m) => ctx.identity.has(m)).length} of your colours`));
    const rest = landsShort - duals.length;
    const basicGroup = landPlanFor(ctx, rest);
    items.push(...basicGroup);
    groups.push({ key: 'finish:lands', title: `Lands · ${landsShort}`, why: `The plan wants ${lp.range[0]}–${lp.range[1]} lands and the deck has ${lp.have}. Lands that make your colours first, then basics by how much of each colour your spells ask for.`, source: 'rules', items });
  }
  // The jobs every deck needs, as many as each is short.
  for (const id of JOBS) {
    const j = ctx.jobs.find((x) => x.id === id);
    if (!j?.range) continue;
    const need = Math.ceil(j.range[0] - j.count);
    if (need <= 0) continue;
    const picks = spells.filter((c) => !used.has(c.name) && cardJobs(c, rolesFor(c)).includes(id)).slice(0, need);
    for (const c of picks) used.add(c.name);
    if (picks.length) groups.push({ key: `finish:${id}`, title: `${j.label} · ${picks.length}`, why: `The deck has ${j.count}; the plan wants ${j.range[0]}–${j.range[1]}.${id === 'ramp' ? ' Cheap ramp first.' : ''}`, source: 'rules', items: picks.map((c) => addItem(ctx, `finish:${id}:${c.name}`, c)) });
  }
  // Each theme, up to its size.
  for (const t of ctx.plan.snapshot.themes ?? []) {
    if ((ctx.plan.stored.themes?.dropped ?? []).includes(t.id)) continue;
    const need = t.size - t.cards.length;
    if (need <= 0) continue;
    const def = THEMES.find((x) => x.name.toLowerCase() === t.id);
    const fromStarter = spells.filter((c) => !used.has(c.name) && def?.card.test(`${c.type_line}\n${c.oracle_text ?? ''}`));
    const extra = fromStarter.length >= need || !def ? [] : addable(ctx, allLocalCards().filter((c) => !isLand(c) && def.card.test(`${c.type_line}\n${c.oracle_text ?? ''}`) && !used.has(c.name)), gcRoomOf(ctx))
      .map((c) => ({ c, s: rank(ctx, c).score })).sort((a, b) => b.s - a.s).map((x) => x.c);
    const picks = [...fromStarter, ...extra].filter((c, i, arr) => arr.findIndex((x) => x.name === c.name) === i).slice(0, need);
    for (const c of picks) used.add(c.name);
    if (picks.length) groups.push({ key: `finish:theme:${t.id}`, title: `Theme: ${t.name} · ${picks.length}`, why: `${t.cards.length} of ${t.size} so far. Eight cards give about a 62% chance of seeing one by turn 4; sixteen about 87%.`, source: 'rules', items: picks.map((c) => addItem(ctx, `finish:theme:${t.id}:${c.name}`, c)) });
  }
  // The rest of the room: what fits the commander best.
  const accepted = groups.reduce((n, g) => n + g.items.reduce((m, i) => m + (i.add?.quantity ?? 1), 0), 0);
  const room = Math.max(0, 100 - ctx.size - accepted);
  const rest = spells.filter((c) => !used.has(c.name)).slice(0, room);
  if (rest.length) groups.push({ key: 'finish:rest', title: `Cards that fit ${short(ctx.list.commander.name)} · ${rest.length}`, why: 'The rest of the room to 100: what fits the commander best and is good at its job.', source: 'rules', items: rest.map((c) => addItem(ctx, `finish:rest:${c.name}`, c)) });
  return groups;
}

/** Basics for n more lands, split like the Lands intent splits them. */
function landPlanFor(ctx: Context, n: number): Suggestion[] {
  if (n <= 0) return [];
  const health = analyse({ commander: ctx.list.commander, cards: ctx.main });
  const colors = health.colors.length ? health.colors : [...ctx.identity].map((color) => ({ color, share: 1 / ctx.identity.size, sources: 0, needed: null }));
  const given: Record<string, number> = Object.fromEntries(colors.map((c) => [c.color, 0]));
  for (let i = 0; i < n; i++) {
    const gap = (c: (typeof colors)[number]) => ((c as { needed: number | null }).needed ?? 0) - c.sources - given[c.color] + c.share;
    const next = colors.reduce((best, c) => (gap(c) > gap(best) ? c : best), colors[0]);
    given[next.color] += 1;
  }
  const basics = localCards(Object.values(BASIC));
  return colors.filter((c) => given[c.color]).map((c) => {
    const card = ctx.main.find((x) => x.card.name === BASIC[c.color])?.card ?? basics.find((b) => b.name === BASIC[c.color]);
    return card ? addItem(ctx, `basics:${c.color}`, card, `${Math.round(c.share * 100)}% of your costs are ${COLOR_NAME[c.color]}`, given[c.color]) : null;
  }).filter((x): x is Suggestion => !!x);
}

// --- Find cards ---------------------------------------------------------------------------

async function findGroups(ctx: Context): Promise<{ groups: SuggestionGroup[]; pile: { main: number; pool: number; over: boolean; choice: 'fill' | 'best' | null } | null }> {
  const groups: SuggestionGroup[] = [];
  const poolCount = count(ctx.pool);
  const pile = (ctx.size < 100 && ctx.size + poolCount >= 110) || ctx.size > 110
    ? { main: ctx.size, pool: poolCount, over: ctx.size > 110, choice: ctx.store.pile ?? null } : null;
  if (pile && !pile.choice) return { groups, pile };
  if (pile?.choice === 'fill') {
    const lp = landPlan(ctx);
    const landsShort = Math.max(0, Math.ceil(lp.range[0] - lp.have));
    const room = Math.max(0, 100 - ctx.size);
    if (landsShort) groups.push({ key: 'find:pile:lands', title: `Lands first · ${Math.min(landsShort, room)}`, why: `The deck has ${lp.have} lands and the plan wants ${lp.range[0]}–${lp.range[1]}.${landsShort >= room ? ` That alone is the ${room} cards to 100.` : ''}`, source: 'rules', items: landPlanFor(ctx, Math.min(landsShort, room)) });
    const left = room - Math.min(landsShort, room);
    if (left > 0) {
      const picks = ctx.pool.filter((p) => !isLand(p.card)).map((p) => ({ p, s: rank(ctx, p.card).score + shortJobBonus(ctx, p.card) })).sort((a, b) => b.s - a.s).slice(0, left);
      groups.push({ key: 'find:pile:fill', title: `From your Maybeboard · ${picks.length}`, why: 'The cards you set aside, best first: the jobs the deck is short of, then what fits the commander.', source: 'rules', items: picks.map(({ p }) => addItem(ctx, `find:pile:${p.card.name}`, p.card)) });
    }
    return { groups, pile };
  }
  if (pile?.choice === 'best') {
    const lp = landPlan(ctx);
    const landsShort = Math.max(0, Math.ceil(lp.range[0] - lp.have));
    if (landsShort) groups.push({ key: 'find:pile:lands', title: `Lands · ${landsShort}`, why: `Whatever else changes, the plan wants ${lp.range[0]}–${lp.range[1]} lands.`, source: 'rules', items: landPlanFor(ctx, landsShort) });
    groups.push(...poolSwaps(ctx, 'find:best', 12));
    return { groups, pile };
  }
  // Jobs under their range.
  for (const id of JOBS) {
    const j = ctx.jobs.find((x) => x.id === id);
    if (!j?.range || j.count >= j.range[0]) continue;
    const found = await gapCards(ctx.list, ctx.profileId, id, { owned: ctx.plan.own, max: ctx.plan.budget, show: 24 }).catch(() => null);
    if (!found) continue;
    const ok = new Set(addable(ctx, localCards(found.cards.map((c) => c.name)), gcRoomOf(ctx)).map((c) => c.name));
    const cards = localCards(found.cards.filter((c) => ok.has(c.name)).map((c) => c.name)).slice(0, 8);
    if (cards.length) groups.push({ key: `find:${id}`, title: `${j.label} · ${j.count} of ${j.range[0]}–${j.range[1]}`, why: `In your colours, legal, within your bracket${ctx.plan.budget ? ` and $${ctx.plan.budget}` : ''}${ctx.plan.own ? ', from cards you own' : ''}. Ranked by fit with the commander, then how good each is at the job.`, source: 'rules', items: cards.map((c) => addItem(ctx, `find:${id}:${c.name}`, c)) });
  }
  // Themes under their size.
  for (const t of ctx.plan.snapshot.themes ?? []) {
    if ((ctx.plan.stored.themes?.dropped ?? []).includes(t.id) || t.cards.length >= t.size) continue;
    const def = THEMES.find((x) => x.name.toLowerCase() === t.id);
    if (!def) continue;
    const cards = addable(ctx, allLocalCards().filter((c) => !isLand(c) && def.card.test(`${c.type_line}\n${c.oracle_text ?? ''}`)), gcRoomOf(ctx))
      .map((c) => ({ c, s: rank(ctx, c).score })).sort((a, b) => b.s - a.s).slice(0, 8).map((x) => x.c);
    if (cards.length) groups.push({ key: `find:theme:${t.id}`, title: `Theme: ${t.name} · ${t.cards.length} of ${t.size}`, why: 'Cards that do what this theme is about, best fit first.', source: 'rules', items: cards.map((c) => addItem(ctx, `find:theme:${t.id}:${c.name}`, c)) });
  }
  // Combos one card away.
  try {
    const facts = await Promise.race([deckFacts(ctx.list, ctx.commanders.map((c) => c.name), ctx.main), new Promise<null>((r) => setTimeout(() => r(null), 6000))]);
    const almost = ((facts?.combos as { almost?: Array<{ id: string; cards: string[]; produces: string[]; missing: string[] }> } | null)?.almost ?? []).filter((c) => c.missing.length === 1);
    const names = [...new Set(almost.map((c) => c.missing[0]))];
    const cards = addable(ctx, localCards(names), gcRoomOf(ctx));
    const items = cards.slice(0, 8).map((c) => {
      const combo = almost.find((x) => x.missing[0] === c.name)!;
      return addItem(ctx, `find:combo:${c.name}`, c, `Completes ${combo.cards.filter((n) => n !== c.name).join(' + ')}: ${combo.produces.slice(0, 2).join(', ').toLowerCase()}`);
    });
    if (items.length) groups.push({ key: 'find:combos', title: `One card from a combo · ${items.length}`, why: 'Combos the deck is one card away from, from Commander Spellbook.', source: 'rules', items });
  } catch { /* Spellbook is optional */ }
  return { groups, pile };
}

/** A small push for cards that fill a job the deck is short of. */
function shortJobBonus(ctx: Context, card: ScryfallCard): number {
  return cardJobs(card, ctx.rolesOf(card)).reduce((n, j) => {
    const s = ctx.jobs.find((x) => x.id === j);
    return n + (s?.range && s.count < s.range[0] ? 0.5 : 0);
  }, 0);
}

// --- Same job (the Swaps tab) -------------------------------------------------------

/**
 * For each card waiting in a "Might go in" section, the deck cards doing the
 * same job at about the same cost. A lookup to help the owner choose, not a
 * recommendation: rules-ranked swaps made decks worse three times in four.
 * The section's cards are in the order they sit there, by name.
 */
function poolSwaps(ctx: Context, prefix: string, max: number): SuggestionGroup[] {
  const cards = deckCards(ctx);
  const jobs = ctx.jobs.map((j) => ({ id: j.id, label: j.label, count: j.count, range: j.range }));
  const pool = ctx.pool.filter((p) => !isLand(p.card)).sort((a, b) => a.card.name.localeCompare(b.card.name)).slice(0, max);
  const groups: SuggestionGroup[] = [];
  for (const p of pool) {
    const roles = ctx.rolesOf(p.card);
    const options = sameJob({ card: p.card, roles, jobs: cardJobs(p.card, roles), plan: planOf(ctx, p.card) }, cards, jobs, 3);
    if (!options.length) continue;
    const section = ctx.sections.find((s) => s.id === p.board)?.name ?? 'Maybeboard';
    groups.push({
      key: `${prefix}:${p.card.name}`, title: `${p.card.name}: same job in the deck`, why: `In your ${section}. Deck cards doing the same job at about the same cost, closest cost first. Not ranked: whether a swap helps is your call.`, source: 'rules', pickOne: true,
      items: options.map((o) => ({
        key: `${prefix}:${p.card.name}:${o.out.card.name}`,
        add: { ...ref(p.card, { from: p.board, where: `in your ${section}` }), quantity: 1 },
        cut: { ...ref(o.out.card, { from: 'main' }), quantity: 1 },
        why: o.why, warn: o.warn, how: o.how,
      })),
    });
  }
  return groups;
}

// --- Guards on every cut list ----------------------------------------------------------

/**
 * The fewest lands a cut may leave. The owner's own range (or a change to the
 * usual rules they set) is theirs to keep to. Otherwise the formula's range
 * is only a guide, so the floor is where the deck counts as far under
 * (hard-checks.ts): a deliberate 34-land deck can still cut a land.
 */
export function landFloor(ctx: Pick<Context, 'plan'>): number {
  return ctx.plan.landNumber.mine ? ctx.plan.lands[0] : farUnderLine(ctx.plan.lands);
}

/** The guards for this deck: the never-cut cards, its lands against the floor, and a count. */
function guardRules(ctx: Context, count: number | null): GuardRules {
  return { count, lands: { have: ctx.plan.landNumber.have, floor: landFloor(ctx) }, never: ctx.protectedWhy };
}

/** Claude's Tune proposals through the guards: cut-only items lose never-cut cards and lands under the floor, and Cuts keeps no more than the deck is over. */
function guardProposals(ctx: Context, intent: Intent, groups: SuggestionGroup[]): SuggestionGroup[] {
  const byName = new Map(ctx.main.map((c) => [c.card.name, c.card]));
  return groups.map((g) => {
    const cuts = g.items.filter((i) => i.cut && !i.add && !i.keep);
    if (!cuts.length) return g;
    const { kept, dropped } = guardCuts(cuts.map((i) => ({ name: i.cut!.name, land: !!byName.get(i.cut!.name) && isLand(byName.get(i.cut!.name)!), quantity: i.cut!.quantity, item: i })),
      guardRules(ctx, intent === 'cuts' ? Math.max(0, ctx.size - 100) : null));
    const keep = new Set(kept.map((k) => k.item.key));
    const items = g.items.filter((i) => !(i.cut && !i.add && !i.keep) || keep.has(i.key))
      // A swap never takes a never-cut card either.
      .filter((i) => !(i.cut && i.add && ctx.protectedWhy.has(i.cut.name)));
    return dropped.length ? { ...g, items, why: `${g.why} Left out by the app's guards: ${dropped.map((d) => `${d.item.name} (${d.why})`).join('; ')}.` } : { ...g, items };
  });
}

// --- Cuts -------------------------------------------------------------------------------

const FILTER_OF: Record<string, CutFilter> = {
  curve: 'curve', costly: 'curve', highcurve: 'curve', slowramp: 'curve',
  interaction: 'interaction', sorcery: 'interaction',
  cmdcost: 'rampdraw', repeat: 'rampdraw',
  offtheme: 'offplan', norole: 'offplan', floor: 'offplan', cantrip: 'offplan', 'package-over': 'offplan', payoffs: 'offplan',
};

async function cutGroups(ctx: Context, landCut: string | null): Promise<{ groups: SuggestionGroup[]; counts: Record<string, number>; type: { type: 'A' | 'B'; why: string }; curve: string | null; settings: unknown; overridden: Record<string, string> }> {
  const groups: SuggestionGroup[] = [];
  // Flagged: the easiest room there is.
  const flags = deckFlags({ commander: ctx.list.commander, cards: ctx.main }).filter((f) => !f.commander);
  if (flags.length) {
    groups.push({
      key: 'cuts:flagged', title: `Flagged · ${flags.length}`, why: 'Cards the deck can’t keep as they are.', source: 'rules', filter: 'flagged',
      items: flags.map((f) => {
        const card = ctx.main.find((c) => c.card.id === f.cardId)!.card;
        return cutItem(card, `cuts:flag:${f.kind}:${f.name}`, f.why, f.kind === 'copies' ? Math.max(1, f.quantity - (f.limit ?? 1)) : f.quantity);
      }),
    });
  }
  const cut = await deckCutList(ctx.list, { landCut });
  const byId = new Map(ctx.main.map((c) => [c.card.id, c.card]));
  // Over your bracket: the Game Changers past what it allows, the weakest first.
  const gcs = ctx.main.filter((c) => c.card.game_changer && !ctx.protectedWhy.has(c.card.name)).map((c) => c.card);
  const gcOver = ctx.gcLimit === null ? 0 : [...ctx.commanders, ...ctx.main.map((c) => c.card)].filter((c) => c.game_changer === true).length - ctx.gcLimit;
  const bracketCards = gcOver > 0 ? gcs.sort((a, b) => quality(a, ctx.rolesOf(a)).score - quality(b, ctx.rolesOf(b)).score).slice(0, gcOver) : [];
  if (bracketCards.length) groups.push({ key: 'cuts:bracket', title: `Over your bracket · ${bracketCards.length}`, why: `Bracket ${ctx.plan.bracket} allows ${ctx.gcLimit} Game Changer${ctx.gcLimit === 1 ? '' : 's'}; the deck has ${ctx.gcLimit! + gcOver}.`, source: 'rules', filter: 'bracket', items: bracketCards.map((c) => cutItem(c, `cuts:gc:${c.name}`, 'A Game Changer past what your bracket allows')) });
  // The rules' list, each card in the filter of its strongest reason.
  const filtered: Record<string, Suggestion[]> = {};
  // The rules' list goes through the same guards as Claude's: no never-cut cards, no lands under the floor.
  const allowed = new Set(guardCuts(cut.candidates.map((c) => ({ name: c.name, land: !!byId.get(c.cardId) && isLand(byId.get(c.cardId)!) })), guardRules(ctx, null)).kept.map((c) => c.name));
  for (const c of cut.candidates) {
    const card = byId.get(c.cardId);
    if (!card || !allowed.has(c.name)) continue;
    const strongest = [...c.why].filter((r) => r.delta > 0).sort((a, b) => b.delta - a.delta);
    let filter: CutFilter = 'other';
    for (const r of strongest) {
      if (r.rule === 'over') { filter = /interaction|wipe/i.test(r.text) ? 'interaction' : /ramp|draw/i.test(r.text) ? 'rampdraw' : 'other'; break; }
      if (FILTER_OF[r.rule]) { filter = FILTER_OF[r.rule]; break; }
    }
    if (c.name === landCut || c.why.some((r) => r.rule === 'lands')) continue;
    const item = cutItem(card, `cuts:rule:${c.name}`, c.reasons.slice(0, 2).join('; '), 1, {
      inputs: [`Jobs: ${c.roles.join(', ') || 'none it tracks'}`, `Mana value: ${c.cmc}`],
      steps: c.why.map((r) => `${r.text}: ${r.delta > 0 ? '+' : ''}${r.delta}`).concat([`Total: ${c.score}`]),
    }, ctx.flags.get(c.name)?.strong ? `${ctx.flags.get(c.name)!.flag}: look twice before cutting it` : undefined);
    (filtered[filter] ??= []).push(item);
  }
  // The plan's engines and key cards go last in each group: the rules can't tell what the deck is built on.
  for (const items of Object.values(filtered)) items.sort((a, b) => Number(!!a.warn) - Number(!!b.warn));
  const LABEL: Record<string, string> = { curve: 'Heavy curve', interaction: 'Interaction over range', rampdraw: 'Ramp or draw over range', offplan: 'Off the plan', other: 'Other cuts' };
  for (const f of ['curve', 'interaction', 'rampdraw', 'offplan', 'other'] as const) {
    const items = filtered[f] ?? [];
    if (items.length) groups.push({ key: `cuts:${f}`, title: `${LABEL[f]} · ${items.length}`, why: f === 'other' ? 'The rules would offer these too, for more than one small reason.' : `The cards whose strongest reason is: ${LABEL[f].toLowerCase()}.`, source: 'rules', filter: f, items });
  }
  // Claude's last review, as proposals.
  const review = lastReview(ctx.list.id);
  if (review?.items.length) {
    const inMain = new Map(ctx.main.map((c) => [c.card.name, c.card]));
    // Guards: never-cut cards and lands under the floor drop out; past the count, a "cut" is only a maybe.
    const over = Math.max(0, ctx.size - 100);
    const asked = review.items.filter((i) => inMain.has(i.name) && i.verdict !== 'keep');
    const sure = guardCuts(asked.filter((i) => i.verdict === 'cut').map((i) => ({ ...i, land: isLand(inMain.get(i.name)!) })), guardRules(ctx, over));
    const maybe = guardCuts(asked.filter((i) => i.verdict !== 'cut').map((i) => ({ ...i, land: isLand(inMain.get(i.name)!) })), guardRules(ctx, null));
    const out = new Set([...sure.dropped.filter((d) => !d.why.startsWith('past')), ...maybe.dropped].map((d) => d.item.name));
    const extra = new Set(sure.dropped.filter((d) => d.why.startsWith('past')).map((d) => d.item.name));
    const items = review.items.filter((i) => inMain.has(i.name) && !out.has(i.name)).map((i) => (extra.has(i.name) ? { ...i, verdict: 'unsure' as const, past: true } : { ...i, past: false })).map((i): Suggestion => (i.verdict === 'keep'
      ? { key: `cuts:claude:${i.name}`, keep: true, cut: { ...ref(inMain.get(i.name)!, { from: 'main' }), quantity: 1 }, why: `${i.tier ? `Tier ${i.tier}. ` : ''}${i.why}` }
      : { ...cutItem(inMain.get(i.name)!, `cuts:claude:${i.name}`, `${i.tier ? `Tier ${i.tier}. ` : ''}${i.why}`), ...(i.past ? { warn: `Claude marked it a cut, past the ${over} the deck is over` } : i.verdict === 'unsure' ? { warn: 'Claude is unsure' } : {}) }))
      .sort((a, b) => Number(!!a.keep) - Number(!!b.keep));
    if (items.length) groups.push({ key: 'cuts:claude', title: `Claude’s review · ${items.length}`, why: `From ${new Date(review.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}${review.instructions ? `, with your instructions: “${review.instructions}”` : ''}. Keep means ★ keep: never offered as a cut again.`, source: 'claude', items, model: review.model, promptVersion: PROMPT_VERSIONS.cutReview, round: review.at });
  }
  const counts: Record<string, number> = {};
  for (const g of groups) if (g.filter) counts[g.filter] = (counts[g.filter] ?? 0) + g.items.length;
  counts.all = cut.candidates.length + flags.length;
  return { groups, counts, type: cut.type, curve: cut.curve, settings: cut.settings, overridden: cut.overridden };
}

// --- Fix a problem -------------------------------------------------------------------

/** Which job each problem calls for, and which cards it must not cut to make room. */
export const FIX_PLAN: Record<Symptom, { job: string; avoid: string[]; why: string }> = {
  gas: { job: 'draw', avoid: ['draw'], why: 'More card draw that refills your hand; cuts come from jobs over their range.' },
  mana: { job: 'lands', avoid: ['ramp'], why: 'More lands, of the colours furthest from what their spells need; cuts from the top of the curve.' },
  late: { job: 'ramp', avoid: ['ramp'], why: 'Ramp costing 2 or less, for slower ramp or the cut list\'s next card.' },
  close: { job: 'finishers', avoid: ['wincon', 'finisher', 'extra-turn', 'extra-combat', 'overrun', 'drain'], why: 'Ways to win, for cards off the plan.' },
  wiped: { job: 'protection', avoid: ['protection', 'recursion'], why: 'Protection and recursion, for removal you have enough of.' },
};

async function fixGroups(ctx: Context, symptom: Symptom): Promise<{ groups: SuggestionGroup[]; evidence: string[] }> {
  const evidence: string[] = [];
  const job = (id: string) => ctx.jobs.find((j) => j.id === id);
  const line = (id: string) => { const j = job(id); return j ? `${j.label}: ${j.count}${j.range ? `, the plan wants ${j.range[0]}–${j.range[1]}` : ''}` : ''; };
  // How it plays, when the deck is near 100: a quick goldfish.
  let report: ReturnType<typeof goldfish> | null = null;
  if (ctx.size >= 90) {
    try { report = goldfish(simDeck(ctx.main), ctx.list.commander ? simCard(ctx.list.commander) : null, 400, 7, 8); } catch { report = null; }
  }
  const cut = await deckCutList(ctx.list).catch(() => null);
  const cutPool = (avoid: string[]) => (cut?.candidates ?? []).filter((c) => !c.roles.some((r) => avoid.includes(r)) && !ctx.protectedWhy.has(c.name)).map((c) => ctx.main.find((m) => m.card.id === c.cardId)?.card).filter((c): c is ScryfallCard => !!c);
  let adds: ScryfallCard[] = [];
  let cuts: ScryfallCard[] = [];
  const findFor = async (id: string, filter: (c: ScryfallCard) => boolean = () => true) => {
    const found = await gapCards(ctx.list, ctx.profileId, id, { owned: ctx.plan.own, max: ctx.plan.budget, show: 30 }).catch(() => null);
    return addable(ctx, localCards((found?.cards ?? []).map((c) => c.name)), gcRoomOf(ctx)).filter(filter);
  };
  if (symptom === 'gas') {
    evidence.push(line('draw'), line('impulse').replace(/, the plan.*/, '') + ' (digs, but doesn’t refill your hand)');
    if (report) evidence.push(`Playtest, 400 games: by turn 6 you’ve cast ${report.spentBy[6].toFixed(1)} mana of spells on average.`);
    adds = await findFor(FIX_PLAN.gas.job);
    cuts = cutPool(FIX_PLAN.gas.avoid);
  } else if (symptom === 'mana') {
    const lp = landPlan(ctx);
    evidence.push(`Lands: ${lp.have}, the plan wants ${lp.range[0]}–${lp.range[1]}`);
    for (const c of lp.colors.filter((x) => x.needed && x.sources < x.needed - 1)) evidence.push(`${c.name[0].toUpperCase() + c.name.slice(1)} sources: ${c.sources}; ${c.neededFor} wants ${c.needed}`);
    if (report) evidence.push(`Playtest, 400 games: a land drop missed by turn 3 in ${Math.round(report.missedLandBy[3] * 100)}%, by turn 4 in ${Math.round(report.missedLandBy[4] * 100)}%.`);
    const basics = landPlanFor(ctx, 3).flatMap((s) => Array.from({ length: s.add?.quantity ?? 1 }, () => s.add!));
    const cards = localCards(basics.map((b) => b.name));
    adds = basics.map((b) => cards.find((c) => c.name === b.name)!).filter(Boolean);
    cuts = cutPool(FIX_PLAN.mana.avoid).sort((a, b) => (b.cmc ?? 0) - (a.cmc ?? 0));
  } else if (symptom === 'late') {
    const mv = ctx.list.commander?.cmc ?? 4;
    const cheap = ctx.main.filter((c) => ctx.roles.find((r) => r.id === 'ramp')?.cards.includes(c.card.name) && (c.card.cmc ?? 0) <= 2).length;
    evidence.push(`${short(ctx.list.commander?.name ?? 'The commander')} costs ${mv}. Ramp costing 2 or less: ${cheap}.`, line('ramp'));
    if (report) evidence.push(`Playtest, 400 games: the commander was cast by turn ${mv} in ${Math.round((report.commanderBy[mv - 1] ?? 0) * 100)}% of games.`);
    adds = await findFor(FIX_PLAN.late.job, (c) => (c.cmc ?? 9) <= 2);
    const slow = ctx.main.filter((c) => ctx.roles.find((r) => r.id === 'ramp')?.cards.includes(c.card.name) && (c.card.cmc ?? 0) >= 3 && !ctx.protectedWhy.has(c.card.name)).map((c) => c.card);
    cuts = [...slow, ...cutPool(FIX_PLAN.late.avoid)];
  } else if (symptom === 'close') {
    evidence.push(line('finishers'));
    const routes = ctx.plan.snapshot.routes ?? [];
    if (routes.length) evidence.push(`Ways to win: ${routes.map((r) => `${r.label}${r.needsCommander ? ' (needs the commander)' : ''}`).join('; ')}`);
    else evidence.push('No clear way to win was found.');
    adds = await findFor(FIX_PLAN.close.job);
    cuts = cutPool(FIX_PLAN.close.avoid);
  } else {
    evidence.push(line('protection'), `How much the deck leans on its commander: ${ctx.plan.lean}`);
    const rec = ctx.roles.find((r) => r.id === 'recursion');
    evidence.push(`Recursion: ${rec?.count ?? 0}`);
    adds = [...(await findFor('protection')).slice(0, 2), ...(await findFor('recursion')).slice(0, 1)];
    cuts = cutPool(FIX_PLAN.wiped.avoid);
  }
  // Pair them: at most three, each cut as close in cost to its add as there is.
  const pairs: Suggestion[] = [];
  const usedCuts = new Set<string>();
  for (const a of adds) {
    if (pairs.length >= 3) break;
    const out = cuts.filter((c) => !usedCuts.has(c.name)).sort((x, y) => Math.abs((x.cmc ?? 0) - (a.cmc ?? 0)) - Math.abs((y.cmc ?? 0) - (a.cmc ?? 0)))[0];
    if (!out) break;
    usedCuts.add(out.name);
    pairs.push({
      key: `fix:${symptom}:${a.name}:${out.name}`,
      add: { ...ref(a, { where: whereOf(ctx, a) }), quantity: 1 }, cut: { ...ref(out, { from: 'main' }), quantity: 1 },
      why: `${reasonText(ctx, a)}. Out: ${cut?.candidates.find((c) => c.name === out.name)?.reasons[0] ?? 'the next card on the cut list'}.`,
    });
  }
  const label = { gas: 'ran out of cards', mana: 'stuck on mana', late: 'the commander came down late', close: 'couldn’t finish', wiped: 'got wiped' }[symptom];
  return { groups: pairs.length ? [{ key: `fix:${symptom}`, title: `${pairs.length} swap${pairs.length === 1 ? '' : 's'} for “${label}”`, why: `${FIX_PLAN[symptom].why} A few at a time, so you can tell what helped.`, source: 'rules', items: pairs }] : [], evidence: evidence.filter(Boolean) };
}

// --- the whole state --------------------------------------------------------------------

export interface TuneState {
  intent: Intent;
  suggested: Intent;
  size: number;
  pool: number;
  badges: Partial<Record<Intent, string>>;
  changes: Changes;
  impact: Impact;
  cutsTo: { id: Board; name: string };
  groups: SuggestionGroup[];
  dismissed: string[];
  /** Suggestion keys that are staged. */
  staged: string[];
  log: TuneStore['log'];
  bracket: number | null;
  pile?: { main: number; pool: number; over: boolean; choice: 'fill' | 'best' | null } | null;
  fix?: { symptom: Symptom; evidence: string[] };
  lands?: { have: number; range: [number, number]; want: number; how: { inputs: string[]; steps: string[] }; mine: boolean; colors: Array<{ color: string; name: string; share: number; sources: number; needed: number | null; neededFor: string | null }> };
  cuts?: { counts: Record<string, number>; type: { type: 'A' | 'B'; why: string }; curve: string | null; settings: unknown; overridden: Record<string, string> };
  /** Finish the deck: where the picks come from, and whether Claude's are in. */
  finish?: { picks: 'rules' | 'claude'; showRules: boolean; claudeReady: boolean; claudeEmpty: boolean };
}

export async function tuneState(list: List, profileId: string, opts: { intent?: Intent; symptom?: Symptom } = {}): Promise<TuneState> {
  const ctx = await tuneContext(list, profileId);
  const poolCount = count(ctx.pool);
  const suggested = suggestedIntent(ctx.size, poolCount);
  const intent = opts.intent ?? suggested;
  const lp = landPlan(ctx);
  const impact = await impactOf(ctx, ctx.store.changes);
  const after = impact.size.after;
  const badges: Partial<Record<Intent, string>> = {};
  if (after > 100) badges.cuts = String(after - 100);
  const landsShort = Math.ceil(lp.range[0] - lp.have);
  // A badge only for a hard failure: lands far under (lib/hard-checks.ts).
  if (ctx.size >= 90 && landsFarUnder(lp.have, lp.range)) badges.lands = `${landsShort} under`;
  if (poolCount && ctx.size >= 95) badges.swaps = String(ctx.pool.filter((p) => !isLand(p.card)).length);
  const flags = deckFlags({ commander: list.commander, cards: ctx.main }).filter((f) => !f.commander).length;
  if (flags && !badges.cuts) badges.cuts = `${flags} flagged`;
  if (ctx.size < 100) badges.find = `${100 - ctx.size} to add`;

  let groups: SuggestionGroup[] = [];
  const out: Partial<TuneState> = {};
  if (intent === 'finish') {
    // Rules by default; Claude's picks when chosen for this deck, with the rules' beside them if asked.
    const picks = ctx.store.finishPicks ?? 'rules';
    const claude = ctx.store.proposals.finish ?? [];
    const showRules = picks === 'rules' || !!ctx.store.finishShowRules;
    groups = picks === 'claude' ? [...claude, ...(showRules ? finishGroups(ctx) : [])] : finishGroups(ctx);
    out.finish = { picks, showRules: !!ctx.store.finishShowRules, claudeReady: claude.length > 0, claudeEmpty: !claude.length && !!ctx.store.finishEmpty };
  }
  else if (intent === 'find') { const f = await findGroups(ctx); groups = f.groups; out.pile = f.pile; }
  else if (intent === 'swaps') groups = poolSwaps(ctx, 'swaps', 12);
  else if (intent === 'cuts') { const c = await cutGroups(ctx, lp.landCut); groups = [...c.groups]; if (lp.have > lp.range[1]) groups.splice(flags ? 1 : 0, 0, ...lp.groups.map((g) => ({ ...g, filter: 'other' as CutFilter }))); out.cuts = { counts: c.counts, type: c.type, curve: c.curve, settings: c.settings, overridden: c.overridden }; }
  else if (intent === 'fix') { const symptom = opts.symptom ?? 'gas'; const f = await fixGroups(ctx, symptom); groups = f.groups; out.fix = { symptom, evidence: f.evidence }; }
  else if (intent === 'lands') groups = lp.groups;
  if (intent === 'lands') out.lands = { have: lp.have, range: lp.range, want: lp.want, how: lp.how, mine: lp.mine, colors: lp.colors };
  // Claude's proposals for this intent join the rules' groups.
  if (intent !== 'finish') groups = [...guardProposals(ctx, intent, ctx.store.proposals[intent] ?? []), ...groups];
  const cutsTo = cutBoard(ctx.sections);
  return {
    intent, suggested, size: ctx.size, pool: poolCount, badges,
    changes: ctx.store.changes, impact,
    cutsTo: { id: cutsTo, name: ctx.sections.find((s) => s.id === cutsTo)?.name ?? 'Sideboard' },
    groups, dismissed: ctx.store.dismissed,
    staged: [...new Set([...ctx.store.changes.add, ...ctx.store.changes.cut].map((s) => s.from).filter((x): x is string => !!x))],
    log: ctx.store.log, bracket: ctx.plan.bracket,
    ...out,
  };
}

// --- staging, applying ---------------------------------------------------------------

/**
 * Stage suggestions into your changes. A swap stages both halves, paired.
 * Cuts on their own stop where the deck would drop under 100: the rest are
 * left, and the answer says how many were.
 */
export async function stage(list: List, profileId: string, items: Suggestion[]): Promise<{ staged: number; capped: number; blocked: number }> {
  const ctx = await tuneContext(list, profileId);
  let { changes } = ctx.store;
  let staged = 0;
  let capped = 0;
  let blocked = 0;
  const known = new Map(ctx.all.map((c) => [c.card.id, c.card]));
  const valid = (r: CardRef | undefined, mustBeIn: boolean) => {
    if (!r) return null;
    const own = known.get(r.id) ?? ctx.all.find((c) => c.card.name === r.name)?.card;
    if (mustBeIn) return own && ctx.main.some((c) => c.card.id === own.id) ? own : null;
    return own ?? storedCard(r.id) ?? localCards([r.name]).find((c) => c.id === r.id) ?? localCards([r.name])[0] ?? null;
  };
  for (const item of items) {
    if (changes.add.some((s) => s.from === item.key) || changes.cut.some((s) => s.from === item.key)) continue;
    const addCard = valid(item.add, false);
    const cutCard = valid(item.cut, true);
    if (item.add && !addCard) continue;
    if (item.cut && !cutCard) continue;
    if (cutCard && ctx.protectedWhy.get(cutCard.name) === 'commander') continue;
    // The guards, whatever offered the cut: never a never-cut card; never a land under the floor unless a land comes in.
    if (cutCard && !item.keep && ctx.protectedWhy.has(cutCard.name)) { blocked += 1; continue; }
    if (cutCard && isLand(cutCard) && !(addCard && isLand(addCard))) {
      const landsCut = changes.cut.filter((c) => { const k = known.get(c.card.id); return k && isLand(k); }).reduce((n, c) => n + c.quantity, 0);
      if (ctx.plan.landNumber.have - landsCut - (item.cut?.quantity ?? 1) < landFloor(ctx)) { blocked += 1; continue; }
    }
    // The size with what is staged so far: counted, not worked out again from the whole deck for every item.
    const sizeAfter = ctx.size + count(changes.add) - count(changes.cut);
    if (cutCard && !addCard && cutsLeft(sizeAfter) < (item.cut?.quantity ?? 1)) { capped += 1; continue; }
    const pairKey = addCard && cutCard ? newKey('pair') : undefined;
    const next: Changes = { add: [...changes.add], cut: [...changes.cut] };
    if (addCard) next.add.push({ key: newKey('a'), card: ref(addCard, { where: item.add?.where ?? null, from: ctx.all.find((c) => c.card.id === addCard.id)?.board }), quantity: item.add?.quantity ?? 1, why: item.why, from: item.key, pair: pairKey });
    if (cutCard) next.cut.push({ key: newKey('c'), card: ref(cutCard, { from: 'main' }), quantity: Math.min(item.cut?.quantity ?? 1, ctx.main.find((c) => c.card.id === cutCard.id)?.quantity ?? 1), why: item.why, from: item.key, pair: pairKey });
    changes = next;
    staged += 1;
  }
  updateTune(list.id, (s) => { s.changes = changes; });
  return { staged, capped, blocked };
}

/** Take staged cards back out of your changes: by staged key or by the suggestion they came from. A swap goes as a pair. */
export function unstage(listId: string, keys: string[]): void {
  updateTune(listId, (s) => {
    const hit = (x: Staged) => keys.includes(x.key) || (!!x.from && keys.includes(x.from));
    const pairs = new Set([...s.changes.add, ...s.changes.cut].filter(hit).map((x) => x.pair).filter((p): p is string => !!p));
    const gone = (x: Staged) => hit(x) || (!!x.pair && pairs.has(x.pair));
    s.changes = { add: s.changes.add.filter((x) => !gone(x)), cut: s.changes.cut.filter((x) => !gone(x)) };
  });
}

/**
 * Apply your changes: adds go into the deck (from the section they wait in,
 * or as new cards), cuts go to the section for cards that came out, with
 * their reason kept. Returns the exact inverse, for an undo that touches
 * nothing else you have staged since.
 */
export async function applyChanges(list: List, cutsTo?: Board): Promise<{ added: number; cut: number; undo: UndoMoves }> {
  const s = tuneStore(list.id);
  const sections = sectionsOf(list.id);
  const to: Board = cutsTo && cutsTo !== 'main' && sections.some((x) => x.id === cutsTo) ? cutsTo : cutBoard(sections);
  const at = new Date().toISOString();
  const done = await move(list, s.changes, () => to, (name, why) => { s.cutReasons[name] = { why, at }; }, (name) => { delete s.cutReasons[name]; });
  // Fixes applied become a log entry that asks, next time, whether they helped.
  const fixPairs = s.changes.add.filter((a) => a.from?.startsWith('fix:') && a.pair).map((a) => ({ add: a.card.name, cut: s.changes.cut.find((c) => c.pair === a.pair)?.card.name ?? '', symptom: a.from!.split(':')[1] as Symptom }));
  if (fixPairs.length) s.log.push({ id: newKey('fix'), at, symptom: fixPairs[0].symptom, swaps: fixPairs.map(({ add, cut: c }) => ({ add, cut: c })) });
  updateTune(list.id, (x) => { x.changes = { add: [], cut: [] }; x.cutReasons = s.cutReasons; x.log = s.log; });
  return done;
}

/**
 * What an apply moved, so it can be put back exactly: each card, how many,
 * and the board it goes back to ('gone' for a card that was new to the deck).
 */
export interface UndoMoves {
  moves: Array<{ id: string; name: string; quantity: number; to: Board | 'gone'; from: Board | 'gone' }>;
}

async function move(
  list: List, changes: Changes, cutTo: (c: Staged) => Board,
  onCut: (name: string, why: string) => void, onAdd: (name: string) => void,
): Promise<{ added: number; cut: number; undo: UndoMoves }> {
  const all = cardsInList(list.id);
  const undo: UndoMoves = { moves: [] };
  let added = 0;
  let cut = 0;
  for (const c of changes.cut) {
    const row = all.find((x) => x.card.id === c.card.id && x.board === 'main');
    if (!row) continue;
    const dest = cutTo(c);
    // A card sits on one board at a time, so cutting some copies of a basic just lowers the count.
    if (row.quantity > c.quantity) { setQuantity(list.id, row.card.id, row.quantity - c.quantity); undo.moves.push({ id: row.card.id, name: row.card.name, quantity: c.quantity, to: 'main', from: 'gone' }); }
    else { updateListCard(list.id, row.card.id, { board: dest }); undo.moves.push({ id: row.card.id, name: row.card.name, quantity: row.quantity, to: 'main', from: dest }); }
    onCut(row.card.name, c.why);
    cut += c.quantity;
  }
  for (const a of changes.add) {
    const row = all.find((x) => x.card.id === a.card.id && x.board !== 'main') ?? all.find((x) => x.card.name === a.card.name && x.board !== 'main');
    // From the section it waits in; a printing on one board at a time, so all its copies come.
    if (row) { updateListCard(list.id, row.card.id, { board: 'main' }); undo.moves.push({ id: row.card.id, name: row.card.name, quantity: row.quantity, to: row.board, from: 'main' }); }
    else {
      // The whole card, as adding from search stores it; the local copy when Scryfall can't be reached.
      const card = storedCard(a.card.id) ?? await getCard(a.card.id).catch(() => null) ?? localCards([a.card.name])[0];
      if (!card) continue;
      addCardToList(list.id, card, a.quantity, 'nonfoil', 'main');
      undo.moves.push({ id: card.id, name: card.name, quantity: a.quantity, to: 'gone', from: 'main' });
    }
    onAdd(a.card.name);
    added += a.quantity;
  }
  return { added, cut, undo };
}

/** The numbers now and with these cards cut, by name (one copy each): for Trim, which keeps its own choices. */
export async function cutImpact(ctx: Context, names: string[]): Promise<Impact> {
  return impactOf(ctx, { add: [], cut: cutsByName(ctx.main, names.map((name) => ({ name, why: '' }))) });
}

function cutsByName(main: ListedCard[], cuts: Array<{ name: string; why: string }>): Staged[] {
  return cuts.flatMap((c) => {
    const row = main.find((m) => m.card.name === c.name && m.slot !== 'partner');
    return row ? [{ key: newKey('c'), card: ref(row.card, { from: 'main' }), quantity: 1, why: c.why }] : [];
  });
}

/**
 * Cut cards by name, outside Your changes (Trim keeps its own choices): each
 * moves to the section for cards that came out, with its reason. Returns the
 * exact inverse for an undo, and the section they went to.
 */
export async function applyCuts(list: List, cuts: Array<{ name: string; why: string }>, cutsTo?: Board): Promise<{ added: number; cut: number; undo: UndoMoves; to: Board }> {
  const sections = sectionsOf(list.id);
  const to: Board = cutsTo && cutsTo !== 'main' && sections.some((x) => x.id === cutsTo) ? cutsTo : cutBoard(sections);
  const at = new Date().toISOString();
  const reasons: Record<string, { why: string; at: string }> = {};
  const main = cardsInList(list.id).filter((c) => c.board === 'main');
  const done = await move(list, { add: [], cut: cutsByName(main, cuts) }, () => to, (name, why) => { reasons[name] = { why, at }; }, () => {});
  updateTune(list.id, (s) => { Object.assign(s.cutReasons, reasons); });
  return { ...done, to };
}

/** Put back what an apply moved. Anything staged since stays staged. */
export function undoApply(list: List, undo: UndoMoves): { moved: number } {
  const sections = new Set(sectionsOf(list.id).map((x) => x.id));
  let moved = 0;
  for (const m of [...(undo?.moves ?? [])].reverse()) {
    const rows = cardsInList(list.id);
    if (m.to === 'gone') {
      // A card that was new to the deck leaves it again: only the copies the apply added.
      const row = rows.find((x) => x.card.id === m.id && x.board === 'main');
      if (!row) continue;
      setQuantity(list.id, row.card.id, row.quantity - m.quantity);
    } else if (m.from === 'gone') {
      // Copies of a basic that were cut come back.
      const row = rows.find((x) => x.card.id === m.id && x.board === 'main');
      if (row) setQuantity(list.id, row.card.id, row.quantity + m.quantity);
      else { const card = storedCard(m.id) ?? localCards([m.name])[0]; if (card) addCardToList(list.id, card, m.quantity, 'nonfoil', 'main'); }
    } else {
      const row = rows.find((x) => x.card.id === m.id && x.board === m.from);
      if (!row) continue;
      if (m.to !== 'main' && !sections.has(m.to)) continue;
      updateListCard(list.id, row.card.id, { board: m.to });
    }
    moved += 1;
  }
  updateTune(list.id, (s) => { for (const m of undo?.moves ?? []) if (m.to === 'main') delete s.cutReasons[m.name]; });
  return { moved };
}

export { JOB_LABELS };
