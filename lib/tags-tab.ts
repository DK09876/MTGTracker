/**
 * The Tags tab: what is on the deck, then "1 · From your cards" (no AI) and
 * "2 · Refine with AI" (optional, after the plan is confirmed). Nothing is
 * applied until the owner accepts it; every accept, skip and removal goes to
 * the suggestion log.
 *
 * From your cards: the six jobs most decks track (one row), the tags from
 * the card data that stand out in this deck (lib/tag-suggest.ts, top 5 with
 * the rest behind "Show more"), and, folded, the combos the combo lookup
 * finds and the cards several of them share.
 *
 * Refine with AI: one Opus call (prompt "tags-2") that works with what is on
 * the deck first - cards to add to a category or take out - and only then
 * suggests new categories. The model returns its whole answer; the code
 * compares it with the deck and shows only the differences.
 *
 *   tags_ai_runs  one row per AI run: what came back, as the code kept it
 *
 * Server only.
 */

import { randomUUID } from 'node:crypto';

import { ModelError, type JsonModel } from './ai';
import { foldedTags, tagCounts } from './card-store';
import {
  addCategory, cardMark, categories, clearSkips, editCategory, goneKeys, identity, keyCategoryId, markSkipped, mergeCategory, removeCategory,
  setCategoryCard, SIX_JOBS, skippedKeys, tidyTag, type Category,
} from './categories';
import { cardsInList, database, type List } from './db';
import { deckContext } from './deck-context';
import { deckHash } from './deck-hash';
import { jobCards } from './deck-roles';
import { primaryType } from './deckview';
import { latestJob } from './jobs';
import { planFacts } from './plan-facts';
import { isConfirmed } from './plan-help';
import { PROMPT_VERSIONS } from './prompt-versions';
import { combosInDeck } from './spellbook';
import { logOutcome, logShown, quietly } from './suggestion-log';
import { SHOWN, standoutTags } from './tag-suggest';
import { tagKey } from './tags';
import type { TagsView, TagRow, AiRow } from './tags-tab-shared';

export type { TagsView } from './tags-tab-shared';

export const TAGS_MODEL = 'claude-opus-5-5';

let ready = false;
function db() {
  const d = database();
  if (!ready) {
    d.run(`CREATE TABLE IF NOT EXISTS tags_ai_runs (id TEXT PRIMARY KEY, listId TEXT NOT NULL, profileId TEXT, at TEXT NOT NULL, model TEXT NOT NULL,
      promptVersion TEXT NOT NULL, deckHash TEXT NOT NULL, output TEXT NOT NULL)`);
    d.run('CREATE INDEX IF NOT EXISTS idx_tags_ai_runs_list ON tags_ai_runs (listId, at)');
    ready = true;
  }
  return d;
}

const front = (n: string) => n.split(' // ')[0].trim().toLowerCase();
const low = (s: string) => s.trim().toLowerCase();
const parse = <T>(s: string | null | undefined, fallback: T): T => { try { return s ? JSON.parse(s) as T : fallback; } catch { return fallback; } };
const isLand = (c: { card: Parameters<typeof primaryType>[0] }) => primaryType(c.card) === 'Lands';

export class TagsRefused extends Error { constructor(msg: string, readonly status = 400) { super(msg); } }

// --- the deck, as the tab reads it -------------------------------------------------------------

function deckOf(list: Pick<List, 'id' | 'commander'>) {
  const main = cardsInList(list.id).filter((c) => c.board === 'main');
  const keyByName = new Map<string, string>(main.map((c) => [front(c.card.name), tagKey(c.card)]));
  if (list.commander) keyByName.set(front(list.commander.name), tagKey(list.commander));
  const nameByKey = new Map<string, string>(main.map((c) => [tagKey(c.card), c.card.name]));
  if (list.commander) nameByKey.set(tagKey(list.commander), list.commander.name);
  const spells = main.filter((c) => !isLand(c) && c.slot !== 'partner').map((c) => tagKey(c.card));
  const commanders = [list.commander?.name, ...main.filter((c) => c.slot === 'partner').map((c) => c.card.name)].filter((x): x is string => !!x);
  return { main, keyByName, nameByKey, spells, commanders };
}

// The combo lookup is a network call: kept per deck version for a day.
const comboCache = new Map<string, { at: number; combos: Array<{ cards: string[]; result: string }> }>();
async function combosOf(deck: ReturnType<typeof deckOf>, hash: string): Promise<Array<{ cards: string[]; result: string }>> {
  const hit = comboCache.get(hash);
  if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.combos;
  try {
    const found = await combosInDeck({ commanders: deck.commanders, main: deck.main.map((c) => ({ name: c.card.name, quantity: c.quantity })) });
    const combos = found.included.map((c) => ({ cards: c.cards, result: c.produces.slice(0, 3).join(', ') }));
    comboCache.set(hash, { at: Date.now(), combos });
    return combos;
  } catch {
    return [];
  }
}

const comboName = (cards: string[], commanders: string[]) => cards.filter((n) => !commanders.some((c) => front(c) === front(n))).join(' + ');

/** Step 1: every suggestion from the cards, before skips are taken out. */
async function fromCards(list: Pick<List, 'id' | 'commander'>, cats: Category[], deck: ReturnType<typeof deckOf>) {
  const gone = goneKeys(list.id);
  const jobsOn = new Set(cats.filter((c) => c.kind === 'job').map((c) => c.jobId));
  const missing = SIX_JOBS.filter((j) => !jobsOn.has(j.id));
  // The jobs' cards, accepted or not, so a tag that only repeats a job is not offered.
  const jc = await jobCards(list.id, deck.main).catch(() => new Map<string, string[]>());
  const jobs = SIX_JOBS.map((j) => (jc.get(j.id) ?? []).map((n) => deck.keyByName.get(front(n))).filter((k): k is string => !!k));
  let ranked: Array<{ slug: string; cards: string[] }> = [];
  try {
    ranked = standoutTags((f) => foldedTags(deck.spells, f), (f) => tagCounts(f), jobs).filter((t) => !gone.has(`tag:${t.slug}`));
  } catch { /* no card data yet: no tags to offer */ }
  const onDeck = new Set(cats.flatMap((c) => c.slugs));
  const tagRow = (t: { slug: string; cards: string[] }): TagRow => ({ key: `tag:${t.slug}`, slug: t.slug, name: tidyTag(t.slug), cards: t.cards.map((k) => deck.nameByKey.get(k) ?? k).sort() });
  const visible = ranked.slice(0, SHOWN).filter((t) => !onDeck.has(t.slug)).map(tagRow);
  const more = ranked.slice(SHOWN).filter((t) => !onDeck.has(t.slug)).map(tagRow);
  const combos = await combosOf(deck, deckHash(list.commander, deck.main));
  const wins = cats.filter((c) => c.kind === 'win');
  const covered = (cards: string[]) => wins.some((w) => cards.every((n) => deck.commanders.some((c) => front(c) === front(n)) || w.cards.some((x) => front(x.name) === front(n))));
  const comboRows = combos.filter((c) => !covered(c.cards))
    .map((c) => ({ key: `combo:${low(comboName(c.cards, deck.commanders))}`, title: c.cards.join(' + '), result: c.result, cards: c.cards }))
    .filter((c) => !gone.has(`win:${c.key.slice(6)}`));
  const count = new Map<string, number>();
  for (const c of combos) for (const n of c.cards) if (!deck.commanders.some((x) => front(x) === front(n))) count.set(n, (count.get(n) ?? 0) + 1);
  const key = cats.find((c) => c.kind === 'key');
  const keyRows = [...count].filter(([, n]) => n >= 2).map(([name, n]) => ({ key: `ckey:${deck.keyByName.get(front(name)) ?? ''}`, name, count: n }))
    .filter((k) => k.key !== 'ckey:' && !key?.cards.some((x) => `ckey:${x.key}` === k.key) && !gone.has(cardMark('key:key cards', k.key.slice(5))));
  return { missing, visible, more, comboRows, keyRows, combos };
}

// --- step 2: AI ---------------------------------------------------------------------------

export const TAGS_SYSTEM = `You are an experienced Commander deckbuilder inside a deck app. The owner pressed "Refine with AI" on the deck's Tags page, after confirming the deck's plan.

A deck starts with no tags. Everything on it now is there because the owner accepted or created it: jobs (ramp, card draw and so on), tags from the card data, ways to win, key cards and their own categories. Work with those, in this order:
1. Improve what is there. For each category on the deck, say which cards are missing from it and which do not belong, judged against this deck and its confirmed plan.
2. Only then suggest new categories, where the plan depends on a group of cards that nothing on the deck covers.

You get the confirmed plan (with who set each part), every category on the deck with its cards and who added each, what the owner removed or skipped before, and the deck's facts.

Return only these fields:
- addTo: cards to add to a category that exists. Each has the category, the card and one sentence why.
- removeFrom: cards to take out of a category that exists, where a card-data tag or an earlier suggestion is wrong for this deck. Each has the category, the card and one sentence why. Never for ways to win or key cards: those are the owner's intent, so only add there.
- categories: new groups, at most 4, only where nothing on the deck already covers them. Consider "Engines" (repeatable advantage central to the plan) unless an existing category already is that. Each has a name a player would say, one sentence why, and its cards.
- notes: at most 2 sentences for the owner.

Rules:
- Everything you return is a suggestion the owner accepts or skips. Nothing is applied for you.
- Prefer a change to an existing category over a new one that overlaps it.
- Do not bring back anything listed under "Removed or skipped by the owner".
- Categories describe; they do not protect. A category is never a reason a card must stay in the deck.
- Do not suggest cuts, adds or swaps to the deck itself.
- Use card names and category names exactly as given.
- Think it through privately; the answer holds only the fields asked for.

Answer with one JSON object, nothing else:
{"addTo": [{"category": "...", "card": "...", "why": "..."}],
 "removeFrom": [{"category": "...", "card": "...", "why": "..."}],
 "categories": [{"name": "...", "why": "...", "cards": ["..."]}],
 "notes": "..."}`;

export interface TagsAnswer {
  addTo: Array<{ category: string; card: string; why: string }>;
  removeFrom: Array<{ category: string; card: string; why: string }>;
  categories: Array<{ name: string; why: string; cards: string[] }>;
  notes: string;
}

/** The answer kept to the deck: card and category names that exist, never a removal from ways to win or key cards, at most 4 new groups. */
export function parseTags(data: unknown, deckNames: string[], catNames: Array<{ name: string; kind: string }>): TagsAnswer {
  const d = (data ?? {}) as Record<string, unknown>;
  if (!d || typeof d !== 'object' || (!Array.isArray(d.addTo) && !Array.isArray(d.removeFrom) && !Array.isArray(d.categories))) throw new ModelError('The AI answer came back unusable. Nothing was saved; try again.');
  const byFront = new Map(deckNames.map((n) => [front(n), n]));
  const cat = new Map(catNames.map((c) => [low(c.name), c]));
  const str = (x: unknown, max: number) => (typeof x === 'string' ? x.trim().slice(0, max) : '');
  const items = (xs: unknown, remove: boolean) => (Array.isArray(xs) ? xs : []).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => ({ category: cat.get(low(str(x.category, 80)))?.name ?? '', kind: cat.get(low(str(x.category, 80)))?.kind ?? '', card: byFront.get(front(str(x.card, 150))) ?? '', why: str(x.why, 300) }))
    .filter((x) => x.category && x.card && !(remove && (x.kind === 'win' || x.kind === 'key'))).slice(0, 40)
    .map(({ category, card, why }) => ({ category, card, why }));
  const groups = (Array.isArray(d.categories) ? d.categories : []).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => ({ name: str(x.name, 60), why: str(x.why, 300), cards: [...new Set((Array.isArray(x.cards) ? x.cards : []).map((n) => byFront.get(front(String(n)))).filter((n): n is string => !!n))].slice(0, 30) }))
    .filter((x) => x.name && x.cards.length).slice(0, 4);
  return { addTo: items(d.addTo, false), removeFrom: items(d.removeFrom, true), categories: groups, notes: str(d.notes, 400) };
}

interface Run { id: string; at: string; model: string; output: TagsAnswer }
export function latestRun(listId: string): Run | null {
  const r = db().get('SELECT id, at, model, output FROM tags_ai_runs WHERE listId = ? ORDER BY at DESC LIMIT 1', [listId]) as { id: string; at: string; model: string; output: string } | null;
  return r ? { id: r.id, at: r.at, model: r.model, output: parse(r.output, { addTo: [], removeFrom: [], categories: [], notes: '' }) } : null;
}

/** What the owner removed or skipped before, in words, for the prompt. */
function removedText(listId: string, cats: Category[], nameByKey: Map<string, string>): string[] {
  const out: string[] = [];
  const catName = (ident: string) => cats.find((c) => identity(c.kind, c.name, c.jobId, c.slugs) === ident)?.name ?? ident.replace(/^[a-z]+:/, '');
  for (const g of goneKeys(listId)) {
    if (g.startsWith('card:')) { const [ident, key] = g.slice(5).split('|'); out.push(`- ${catName(ident)}: ${nameByKey.get(key) ?? key} (taken out)`); }
    else if (g.startsWith('tag:')) out.push(`- the card-data tag ${tidyTag(g.slice(4))} (removed)`);
    else out.push(`- ${g.replace(/^(own|win):/, (_, k) => (k === 'win' ? 'way to win ' : 'category '))} (removed)`);
  }
  for (const k of skippedKeys(listId, 'ai')) out.push(`- ${k.replace(/^ai:(add|rm|new):/, (_, w) => (w === 'add' ? 'add ' : w === 'rm' ? 'take out ' : 'new category '))} (skipped)`);
  return out;
}

/** Ask AI to refine the deck's categories; the answer is stored and the differences shown. */
export async function runTagsAi(model: JsonModel, list: List, profileId: string | null, progress: (s: string) => void = () => {}): Promise<Run> {
  if (!isConfirmed(list.id)) throw new ModelError('Confirm the plan first: AI reads it.');
  progress('Gathering the deck');
  const deck = deckOf(list);
  const cats = await categories(list, jobCards);
  const context = await deckContext(list);
  const { md } = await planFacts(list, list.id, list.name, deck.commanders);
  const removed = removedText(list.id, cats, deck.nameByKey);
  const user = `${context}\n\nRemoved or skipped by the owner (do not bring back):\n${removed.join('\n') || '- nothing'}\n\n${md}\n`;
  progress('AI is reading the deck');
  const answer = await model({ step: 'refine tags', system: TAGS_SYSTEM, user, schema: { type: 'OBJECT' }, promptOnly: true, thinking: 'high', timeoutMs: 6 * 60_000 }, { maxBusy: 1 });
  const deckNames = [...deck.nameByKey.values()];
  const output = parseTags(answer.data, deckNames, cats.map((c) => ({ name: c.name, kind: c.kind })));
  const run: Run = { id: randomUUID(), at: new Date().toISOString(), model: answer.model, output };
  db().run('INSERT INTO tags_ai_runs (id, listId, profileId, at, model, promptVersion, deckHash, output) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [run.id, list.id, profileId, run.at, run.model, PROMPT_VERSIONS.tagsAi, deckHash(list.commander, deck.main), JSON.stringify(output)]);
  clearSkips(list.id, 'ai');
  return run;
}

/**
 * The last AI answer compared with the deck as it is: additions not yet
 * made, removals of cards still in, and new groups not yet on the deck (a
 * group that is already there turns into its differences). Nothing that
 * touches what the owner set, removed or skipped.
 */
function aiRows(listId: string, run: Run | null, cats: Category[], deck: ReturnType<typeof deckOf>): AiRow[] {
  if (!run) return [];
  const gone = goneKeys(listId);
  const skip = skippedKeys(listId, 'ai');
  const rows: AiRow[] = [];
  const catOf = (name: string) => cats.find((c) => low(c.name) === low(name));
  const identOf = (c: Category) => identity(c.kind, c.name, c.jobId, c.slugs);
  const fixed = (c: Category) => c.by === 'owner' && c.kind !== 'win' && c.kind !== 'key';
  const add = (c: Category, card: string, why: string) => {
    const key = deck.keyByName.get(front(card));
    if (!key || fixed(c) || c.cards.some((x) => x.key === key) || c.out.some((x) => x.key === key) || gone.has(cardMark(identOf(c), key))) return;
    const k = `ai:add:${identOf(c)}|${key}`;
    if (!skip.has(k) && !rows.some((r) => r.key === k)) rows.push({ key: k, kind: 'add', category: c.name, categoryId: c.id, card: deck.nameByKey.get(key) ?? card, why });
  };
  const remove = (c: Category, card: string, why: string) => {
    const key = deck.keyByName.get(front(card));
    const has = key ? c.cards.find((x) => x.key === key) : null;
    if (!key || !has || has.by === 'owner' || fixed(c) || c.kind === 'win' || c.kind === 'key') return;
    const k = `ai:rm:${identOf(c)}|${key}`;
    if (!skip.has(k) && !rows.some((r) => r.key === k)) rows.push({ key: k, kind: 'remove', category: c.name, categoryId: c.id, card: has.name, why });
  };
  for (const a of run.output.addTo) { const c = catOf(a.category); if (c) add(c, a.card, a.why); }
  for (const r of run.output.removeFrom) { const c = catOf(r.category); if (c) remove(c, r.card, r.why); }
  for (const g of run.output.categories) {
    const there = catOf(g.name);
    if (there) {
      for (const n of g.cards) add(there, n, g.why);
      for (const x of there.cards.filter((y) => y.by === 'ai' && !g.cards.some((n) => front(n) === front(y.name)))) remove(there, x.name, 'This run no longer includes it.');
      continue;
    }
    const keys = g.cards.map((n) => deck.keyByName.get(front(n))).filter((k): k is string => !!k);
    // Not a new group that overlaps one already on the deck.
    const overlaps = cats.some((c) => { const C = new Set(c.cards.map((x) => x.key)); return keys.length && keys.filter((k) => C.has(k)).length / new Set([...keys, ...C]).size >= 0.7; });
    const k = `ai:new:${low(g.name)}`;
    if (overlaps || gone.has(identity('own', g.name)) || skip.has(k)) continue;
    rows.push({ key: k, kind: 'new', category: g.name, categoryId: null, why: g.why, cards: g.cards });
  }
  return rows;
}

// --- the view -------------------------------------------------------------------------------

export async function tagsTab(list: Pick<List, 'id' | 'commander'>, profileId?: string): Promise<TagsView> {
  const deck = deckOf(list);
  const cats = await categories(list, jobCards);
  const skip = skippedKeys(list.id, 'cards');
  const s1 = await fromCards(list, cats, deck);
  const jobsRow = s1.missing.length && !skip.has('jobs') ? { key: 'jobs' as const, all: s1.missing.length === SIX_JOBS.length, missing: s1.missing.map((j) => ({ id: j.id, label: j.label })) } : null;
  const visible = s1.visible.filter((t) => !skip.has(t.key));
  const more = s1.more.filter((t) => !skip.has(t.key));
  const combos = s1.comboRows.filter((c) => !skip.has(c.key));
  const comboKeys = s1.keyRows.filter((k) => !skip.has(k.key));
  const run = latestRun(list.id);
  const rows = aiRows(list.id, run, cats, deck);
  const job = latestJob('tagsai', list.id);
  const running = job && (job.status === 'running' || (job.status === 'failed' && (!run || job.startedAt > run.at)))
    ? { id: job.id, status: job.status, progress: job.detail || null, error: job.status === 'failed' ? job.error ?? 'The AI read failed' : null } : null;
  const view: TagsView = {
    categories: cats,
    cardNames: [...new Set([...deck.commanders, ...deck.main.map((c) => c.card.name)])].sort(),
    confirmed: isConfirmed(list.id),
    hasKey: !!process.env.ANTHROPIC_API_KEY,
    step1: { jobs: jobsRow, tags: visible, more, combos, comboKeys, open: (jobsRow ? 1 : 0) + visible.length, comboCount: s1.combos.length },
    ai: { ran: !!run, at: run?.at ?? null, notes: run?.output.notes ?? '', rows, job: running },
  };
  if (profileId) quietly(() => logShown(profileId, list.id, 'tags:', [
    { key: 'tags:cards', task: 'tags', method: 'code', deckHash: deckHash(list.commander, deck.main), items: [
      ...(jobsRow ? [{ key: 'jobs', reasonShown: jobsRow.missing.map((j) => j.label).join(', ') }] : []),
      ...visible.map((t) => ({ key: t.key, reasonShown: `${t.name}: ${t.cards.length} cards` })),
    ] },
    { key: 'tags:ai', task: 'tags', method: 'ai', model: run?.model ?? null, promptVersion: PROMPT_VERSIONS.tagsAi, deckHash: deckHash(list.commander, deck.main),
      items: rows.map((r) => ({ key: r.key, reasonShown: r.why })) },
  ]));
  return view;
}

// --- changes --------------------------------------------------------------------------------

export async function tagsAct(list: Pick<List, 'id' | 'commander'>, _profileId: string, b: Record<string, unknown>): Promise<void> {
  const id = list.id;
  const deck = deckOf(list);
  const str = (x: unknown) => (typeof x === 'string' ? x : '');
  const cats = await categories(list, jobCards);
  const catOf = (cid: string) => { const c = cats.find((x) => x.id === cid); if (!c) throw new TagsRefused('That category is not on this deck', 404); return c; };
  switch (b.action) {
    case 'add': {
      const name = str(b.name).trim();
      if (!name) throw new TagsRefused('Name the category first');
      addCategory(id, { kind: 'own', name, by: 'owner' });
      return;
    }
    case 'remove': {
      const c = catOf(str(b.id));
      removeCategory(id, c.id);
      if (c.by !== 'owner') quietly(() => logOutcome(id, [c.slugs[0] ? `tag:${c.slugs[0]}` : `ai:new:${low(c.name)}`], 'refused'));
      return;
    }
    case 'card': {
      const c = catOf(str(b.id));
      const name = str(b.name);
      const key = deck.keyByName.get(front(name));
      if (!key) throw new TagsRefused(`${name} is not in the deck`);
      setCategoryCard(id, c.id, { key, name: deck.nameByKey.get(key) ?? name }, b.on !== false, 'owner');
      return;
    }
    case 'merge': {
      const from = catOf(str(b.id));
      if (!mergeCategory(id, from, str(b.into))) throw new TagsRefused('Those two can’t be merged');
      return;
    }
    case 'edit':
      if (!editCategory(id, str(b.id), { name: typeof b.name === 'string' ? b.name : undefined, how: typeof b.how === 'string' ? b.how : undefined })) throw new TagsRefused('That category is not on this deck', 404);
      return;
    case 'skip': {
      const key = str(b.key);
      markSkipped(id, key.startsWith('ai:') ? 'ai' : 'cards', key, b.on !== false);
      quietly(() => logOutcome(id, [key], 'refused'));
      return;
    }
    case 'refresh':
      clearSkips(id, 'cards');
      return;
    case 'accept': {
      const keys = (Array.isArray(b.keys) ? b.keys : []).filter((k): k is string => typeof k === 'string').slice(0, 60);
      const s1 = keys.some((k) => !k.startsWith('ai:')) ? await fromCards(list, cats, deck) : null;
      const rows = keys.some((k) => k.startsWith('ai:')) ? aiRows(id, latestRun(id), cats, deck) : [];
      for (const k of keys) {
        if (k === 'jobs') {
          for (const j of s1?.missing ?? []) addCategory(id, { kind: 'job', name: j.label, by: 'cards', jobId: j.id, how: j.how });
        } else if (k.startsWith('tag:')) {
          const t = [...(s1?.visible ?? []), ...(s1?.more ?? [])].find((x) => x.key === k);
          if (t) addCategory(id, { kind: 'tag', name: t.name, by: 'cards', slugs: [t.slug], how: 'Every card in the deck that carries this tag in the card data. It stays live: a card added later that has the tag joins by itself.' });
        } else if (k.startsWith('combo:')) {
          const c = s1?.comboRows.find((x) => x.key === k);
          if (c) {
            const name = comboName(c.cards, deck.commanders) || c.title;
            const withCmd = c.cards.some((n) => deck.commanders.some((x) => front(x) === front(n)));
            addCategory(id, {
              kind: 'win', name, by: 'cards', how: `${withCmd ? `With ${deck.commanders[0]}: ` : ''}${c.result}`,
              cards: c.cards.filter((n) => !deck.commanders.some((x) => front(x) === front(n))).map((n) => ({ key: deck.keyByName.get(front(n)) ?? '', name: n, by: 'cards' as const })).filter((x) => x.key),
            });
          }
        } else if (k.startsWith('ckey:')) {
          const r = s1?.keyRows.find((x) => x.key === k);
          if (r) setCategoryCard(id, keyCategoryId(id), { key: k.slice(5), name: r.name }, true, 'cards');
        } else {
          const r = rows.find((x) => x.key === k);
          if (!r) continue;
          if (r.kind === 'add' && r.categoryId) setCategoryCard(id, r.categoryId, { key: deck.keyByName.get(front(r.card!))!, name: r.card! }, true, 'ai');
          else if (r.kind === 'remove' && r.categoryId) setCategoryCard(id, r.categoryId, { key: deck.keyByName.get(front(r.card!))!, name: r.card! }, false, 'owner');
          else if (r.kind === 'new') addCategory(id, { kind: 'own', name: r.category, by: 'ai', how: r.why, cards: (r.cards ?? []).map((n) => ({ key: deck.keyByName.get(front(n)) ?? '', name: n, by: 'ai' as const })).filter((x) => x.key) });
        }
      }
      quietly(() => logOutcome(id, keys, 'accepted'));
      return;
    }
    default:
      throw new TagsRefused('Unknown action');
  }
}
