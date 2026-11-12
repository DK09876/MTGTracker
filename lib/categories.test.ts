/**
 * The one category store: nothing on a new deck, live card-data tags, the
 * owner's changes kept, key cards that only empty, merges, jobs that count
 * the owner's changes, and the one-time migration of decks that existed
 * before. Each test has its own database; nothing calls out.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScryfallCard } from './scryfall';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-categories-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.stubEnv('MTG_CARDS_DB_PATH', join(dir, 'cards.db'));
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

const card = (name: string, over: Partial<ScryfallCard> = {}) =>
  ({ id: name, oracle_id: `o-${name}`, name, type_line: 'Instant', cmc: 2, oracle_text: `${name} does a thing.`, color_identity: [], legalities: { commander: 'legal' }, ...over }) as ScryfallCard;
const commander = card('Azula', { type_line: 'Legendary Creature — Human Noble', cmc: 4 });

async function* rows(tags: Array<Record<string, unknown>>) { for (const t of tags) yield t; }
const tag = (id: string, slug: string, cards: string[], extra: Record<string, unknown> = {}) =>
  ({ id, slug, aliases: [], child_ids: [], taggings: cards.map((oracle_id) => ({ oracle_id })), ...extra });

/** Card-data tags in this test's cards database. */
async function seedTags(tags: Array<Record<string, unknown>>) {
  const { readTagFile, saveTags, localCards } = await import('./card-store');
  localCards(['x']); // makes the tables
  saveTags(await readTagFile(rows(tags)));
}

async function deck(name = 'Azula', spells = ['Bolt', 'Shock', 'Opt']) {
  const db = await import('./db');
  if (!db.knownProfile('dk')) db.addProfile('dk', 'DK');
  const list = db.createList('dk', name, '', { kind: 'deck', commander });
  for (const s of spells) db.addCardToList(list.id, card(s));
  const { ROLES_VERSION } = await import('./roles');
  const ids = (db.database().all('SELECT data FROM cards') as Array<{ data: string }>).map((r) => (JSON.parse(r.data) as ScryfallCard).oracle_id!).filter(Boolean);
  db.saveRoles(new Map(ids.map((id) => [id, id === 'o-Bolt' || id === 'o-Shock' ? ['removal'] : []] as [string, string[]])), ROLES_VERSION);
  return { db, list: db.getList(list.id, 'dk')! };
}

describe('categories', { timeout: 30_000 }, () => {
  it('a deck made after the migration starts with nothing on it', async () => {
    const c = await import('./categories');
    c.startCategories();
    const { list } = await deck();
    expect(await c.categories(list)).toEqual([]);
  });

  it('a card-data tag stays live: a later card joins, a card taken out stays out, a card added stays in', async () => {
    await seedTags([tag('m', 'magecraft', ['o-Bolt', 'o-Shock', 'o-Late'])]);
    const c = await import('./categories');
    c.startCategories();
    const { db, list } = await deck();
    const id = c.addCategory(list.id, { kind: 'tag', name: 'Magecraft', by: 'cards', slugs: ['magecraft'] });
    expect((await c.categories(list))[0].cards.map((x) => x.name)).toEqual(['Bolt', 'Shock']);
    db.addCardToList(list.id, card('Late'));
    c.setCategoryCard(list.id, id, { key: 'o-Shock', name: 'Shock' }, false);
    c.setCategoryCard(list.id, id, { key: 'o-Opt', name: 'Opt' }, true);
    const [mage] = await c.categories(list);
    expect(mage.cards.map((x) => `${x.name}:${x.by}`)).toEqual(['Bolt:cards', 'Late:cards', 'Opt:owner']);
    expect(mage.out.map((x) => x.name)).toEqual(['Shock']);
    // Taken out by the owner: not suggested again.
    expect(c.goneKeys(list.id).has(c.cardMark('tag:magecraft', 'o-Shock'))).toBe(true);
  });

  it('accepting the same thing twice adds to the one category; key cards only empty when removed', async () => {
    const c = await import('./categories');
    c.startCategories();
    const { list } = await deck();
    const a = c.addCategory(list.id, { kind: 'win', name: 'Burn', by: 'ai', cards: [{ key: 'o-Bolt', name: 'Bolt', by: 'ai' }] });
    const b = c.addCategory(list.id, { kind: 'win', name: 'burn', by: 'owner', cards: [{ key: 'o-Shock', name: 'Shock', by: 'owner' }] });
    expect(a).toBe(b);
    const key = c.keyCategoryId(list.id);
    c.setCategoryCard(list.id, key, { key: 'o-Opt', name: 'Opt' }, true, 'ai');
    c.removeCategory(list.id, key);
    const after = await c.categories(list);
    expect(after.find((x) => x.kind === 'key')?.cards).toEqual([]);
    expect(c.goneKeys(list.id).has(c.cardMark('key:key cards', 'o-Opt'))).toBe(true);
    // A way to win AI added and the owner removed is remembered; the owner's own is not.
    c.removeCategory(list.id, a);
    expect(c.goneKeys(list.id).has('win:burn')).toBe(true);
  });

  it('merges a tag into another: cards stay live, what was merged is recorded and not suggested again', async () => {
    await seedTags([tag('m', 'magecraft', ['o-Bolt']), tag('r', 'ritual', ['o-Shock'])]);
    const c = await import('./categories');
    c.startCategories();
    const { list } = await deck();
    const into = c.addCategory(list.id, { kind: 'tag', name: 'Magecraft', by: 'cards', slugs: ['magecraft'] });
    c.addCategory(list.id, { kind: 'tag', name: 'Ritual', by: 'cards', slugs: ['ritual'] });
    const from = (await c.categories(list)).find((x) => x.name === 'Ritual')!;
    expect(c.mergeCategory(list.id, from, into)).toBe(true);
    const all = await c.categories(list);
    expect(all).toHaveLength(1);
    expect(all[0].cards.map((x) => x.name)).toEqual(['Bolt', 'Shock']);
    expect(all[0].madeOf).toEqual(['Ritual']);
    expect(c.goneKeys(list.id).has('tag:ritual')).toBe(true);
  });

  it('a job counts the owner\'s changes, and only jobs on the deck are listed as on it', async () => {
    const c = await import('./categories');
    c.startCategories();
    const { list } = await deck();
    const id = c.addCategory(list.id, { kind: 'job', name: 'Interaction', by: 'cards', jobId: 'interaction' });
    const dr = await import('./deck-roles');
    const before = (await dr.deckRolesKnown(list.id)).find((r) => r.id === 'interaction')!;
    expect(before.cards).toEqual(['Bolt', 'Shock']);
    c.setCategoryCard(list.id, id, { key: 'o-Shock', name: 'Shock' }, false);
    c.setCategoryCard(list.id, id, { key: 'o-Opt', name: 'Opt' }, true);
    const after = (await dr.deckRolesKnown(list.id)).find((r) => r.id === 'interaction')!;
    expect(after.cards).toEqual(['Bolt', 'Opt']);
    expect(after.count).toBe(before.count);
    const view = (await c.categories(list, dr.jobCards))[0];
    expect(view.cards.map((x) => `${x.name}:${x.by}`)).toEqual(['Bolt:cards', 'Opt:owner']);
    expect([...c.jobsOnDeck(list.id)]).toEqual(['interaction']);
  });
});

describe('the migration', { timeout: 30_000 }, () => {
  it('keeps what decks had: own tags by who made them, the six jobs, corrections, the plan\'s text, ways to win and key cards', async () => {
    const { db, list } = await deck();
    const d = db.database();
    // The owner's tag, the tagger's tag, an unreviewed and a turned-down suggestion.
    const mine = db.createTag(list.id, { name: 'Burn', color: '#f00', status: 'accepted', origin: 'manual' });
    const ai = db.createTag(list.id, { name: 'Spells', color: '#0f0', status: 'accepted', origin: 'ai' });
    db.createTag(list.id, { name: 'Maybe', color: '#00f', status: 'proposed', origin: 'ai' });
    db.createTag(list.id, { name: 'Nope', color: '#00f', status: 'rejected', origin: 'ai' });
    db.setCardTag(list.id, 'o-Bolt', mine.id, true);
    d.run(`INSERT INTO deck_card_tags (listId, cardKey, tagId, source, isOn, reason) VALUES (?, 'o-Opt', ?, 'ai', 1, 'cheap')`, [list.id, ai.id]);
    // A role correction, a plan read and the owner's edits (the branch's tables).
    const dr = await import('./deck-roles');
    dr.setOverride(list.id, 'o-Shock', 'removal', false);
    dr.setOverride(list.id, 'o-Opt', 'ramp', true);
    const c0 = await import('./categories');
    c0.ensurePlanColumns();
    d.run(`INSERT INTO plan_owner (listId, commanderRoles, edits, updatedAt) VALUES (?, '[]', ?, ?)`, [list.id, JSON.stringify({ keyCards: ['Bolt'] }), new Date().toISOString()]);
    d.run(`CREATE TABLE IF NOT EXISTS plan_passes (id TEXT PRIMARY KEY, listId TEXT NOT NULL, profileId TEXT, at TEXT NOT NULL, model TEXT NOT NULL, promptVersion TEXT NOT NULL,
      deckHash TEXT NOT NULL, deckKeys TEXT NOT NULL, commanderName TEXT, input TEXT NOT NULL, output TEXT NOT NULL)`);
    d.run(`INSERT INTO plan_passes (id, listId, profileId, at, model, promptVersion, deckHash, deckKeys, commanderName, input, output) VALUES ('p1', ?, 'dk', ?, 'opus', 'plan-pass-2', '', '[]', 'Azula', '{}', ?)`,
      [list.id, new Date().toISOString(), JSON.stringify({ plan: 'Burn them out.', winRoutes: [{ name: 'Burn', cards: ['Bolt', 'Shock', 'Not here'] }], keyCards: ['Opt'], themes: [{ name: 'x', cards: [] }], cards: {} })]);

    const c = await import('./categories');
    c.startCategories();
    const all = await c.categories(list, dr.jobCards);
    const names = all.map((x) => `${x.kind}:${x.name}:${x.by}`);
    expect(names).toEqual(expect.arrayContaining(['own:Burn:owner', 'own:Spells:ai', 'win:Burn:ai', 'key:Key cards:owner',
      'job:Ramp:cards', 'job:Card draw:cards', 'job:Interaction:cards', 'job:Board wipes:cards', 'job:Protection:cards', 'job:Ways to finish:cards']));
    expect(names.some((n) => n.includes('Maybe') || n.includes('Nope'))).toBe(false);
    expect(c.goneKeys(list.id).has('own:nope')).toBe(true);
    expect(all.find((x) => x.name === 'Burn' && x.kind === 'own')!.cards.map((x) => x.name)).toEqual(['Bolt']);
    expect(all.find((x) => x.name === 'Spells')!.cards).toEqual([{ key: 'o-Opt', name: 'Opt', by: 'ai' }]);
    expect(all.find((x) => x.kind === 'win')!.cards.map((x) => x.name)).toEqual(['Bolt', 'Shock']);
    // The owner's key cards win over the read's.
    expect(all.find((x) => x.kind === 'key')!.cards).toEqual([{ key: 'o-Bolt', name: 'Bolt', by: 'owner' }]);
    // Corrections: Shock is not interaction here; Opt is ramp.
    expect(all.find((x) => x.jobId === 'interaction')!.cards.map((x) => x.name)).toEqual(['Bolt']);
    expect(all.find((x) => x.jobId === 'ramp')!.cards.map((x) => x.name)).toEqual(['Opt']);
    const plan = d.get('SELECT planText, planBy FROM plan_owner WHERE listId = ?', [list.id]) as { planText: string; planBy: string };
    expect(plan).toEqual({ planText: 'Burn them out.', planBy: 'ai' });
    // The Cards tab's own tags still read the same.
    expect(db.deckTags(list.id).tags.map((t) => t.name).sort()).toEqual(['Burn', 'Spells']);
  });

  it('runs once: a second start changes nothing', async () => {
    const { list } = await deck();
    const c = await import('./categories');
    c.startCategories();
    const first = (await c.categories(list)).length;
    expect(c.migrateAll).toBeTypeOf('function');
    vi.resetModules();
    const again = await import('./categories');
    again.startCategories();
    expect((await again.categories(list)).length).toBe(first);
  });
});
