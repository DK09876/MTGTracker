/**
 * The one category store: nothing on a new deck, live card-data tags, the
 * owner's changes kept, key cards that only empty, merges, jobs that count
 * the owner's changes, and jobs and ways to win that can't be merged away.
 * The one-time reset of older decks is tested in deck-reset.test.ts. Each
 * test has its own database; nothing calls out.
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
  it('a new deck starts with nothing on it', async () => {
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

  it('never merges a job or a way to win away', async () => {
    const c = await import('./categories');
    c.startCategories();
    const { list } = await deck();
    c.addCategory(list.id, { kind: 'job', name: 'Ramp', by: 'cards', jobId: 'ramp' });
    c.addCategory(list.id, { kind: 'win', name: 'Burn', by: 'owner' });
    const into = c.addCategory(list.id, { kind: 'own', name: 'Mine', by: 'owner' });
    const all = await c.categories(list);
    expect(c.mergeCategory(list.id, all.find((x) => x.kind === 'job')!, into)).toBe(false);
    expect(c.mergeCategory(list.id, all.find((x) => x.kind === 'win')!, into)).toBe(false);
    expect(await c.categories(list)).toHaveLength(3);
  });
});
