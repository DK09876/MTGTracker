/**
 * The one-time reset of decks that existed before the Plan and Tags redesign:
 * an old deck with a row in every per-deck table reads exactly like a deck
 * made fresh with the same cards, its rows are archived first, a second start
 * changes nothing, a deck made after the reset began keeps what it has, and a
 * deck that fails is retried at the next start. Each test has its own
 * database; nothing calls out.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JsonModel } from './ai';
import type { ScryfallCard } from './scryfall';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-deck-reset-'));
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
const SPELLS = ['Bolt', 'Shock', 'Opt'];

/** Holds the reset off while a test builds "old" decks, as if they were made before it shipped. */
async function before() {
  const db = await import('./db');
  if (!db.knownProfile('dk')) db.addProfile('dk', 'DK');
  db.setSetting('decks.reset', 'held for the test');
  return db;
}

async function makeDeck(name = 'Azula') {
  const db = await import('./db');
  const list = db.createList('dk', name, '', { kind: 'deck', commander });
  for (const s of SPELLS) db.addCardToList(list.id, card(s));
  const { ROLES_VERSION } = await import('./roles');
  const ids = (db.database().all('SELECT data FROM cards') as Array<{ data: string }>).map((r) => (JSON.parse(r.data) as ScryfallCard).oracle_id!).filter(Boolean);
  db.saveRoles(new Map(ids.map((id) => [id, id === 'o-Bolt' ? ['removal'] : []] as [string, string[]])), ROLES_VERSION);
  return db.getList(list.id, 'dk')!;
}

/** A row in a table, filled with throwaway values; a table no module has made yet gets a bare one. */
async function anyRow(table: string, listId: string) {
  const d = (await import('./db')).database();
  if (!d.get(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, [table])) d.run(`CREATE TABLE ${table} (listId TEXT NOT NULL, v TEXT)`);
  const cols = d.all(`PRAGMA table_info(${table})`) as Array<{ name: string; type: string; notnull: number; dflt_value: string | null }>;
  const vals = cols.map((c) => (c.name === 'listId' ? listId : c.name === 'closedAt' ? null : /INT/i.test(c.type) ? 0 : `x-${Math.random()}`));
  d.run(`INSERT INTO ${table} (${cols.map((c) => c.name).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals);
}

/** Everything the Plan, Tags and Tune pages can store for a deck. */
async function fillEverything(list: Awaited<ReturnType<typeof makeDeck>>) {
  const ph = await import('./plan-help');
  const t = await import('./tags-tab');
  const c = await import('./categories');
  const dr = await import('./deck-roles');
  const db = await import('./db');
  await ph.act(list, 'dk', { action: 'commander', roles: ['voltron'] });
  await ph.act(list, 'dk', { action: 'bracket', value: 3 } as never);
  await ph.act(list, 'dk', { action: 'goal', chips: [], text: 'Win more' });
  await ph.act(list, 'dk', { action: 'planText', text: 'Burn them out.' } as never);
  await ph.act(list, 'dk', { action: 'neverCut', add: 'Bolt' } as never);
  await ph.act(list, 'dk', { action: 'note', add: 'My note' } as never);
  await ph.act(list, 'dk', { action: 'addWin', name: 'Burn' } as never);
  await t.tagsAct(list, 'dk', { action: 'add', name: 'Pet cards' });
  c.addCategory(list.id, { kind: 'job', name: 'Ramp', by: 'cards', jobId: 'ramp' });
  c.markSkipped(list.id, 'plan', 'bracket');
  c.markGone(list.id, 'own:old');
  dr.setOverride(list.id, 'o-Shock', 'removal', true);
  const model: JsonModel = async () => ({ data: { state: 'focused', fill: {}, winRoutes: [], keyCards: [], questions: [], directions: [], summary: 'x' }, model: 'claude-opus-5-5' });
  await ph.runHelp(model, list, 'dk');
  await ph.act(list, 'dk', { action: 'confirm' } as never);
  await views(list); // the modules make their own tables before any throwaway row goes in
  db.database().run(`UPDATE lists SET tagBrief = 'Old brief', tagOverview = 'Old overview' WHERE id = ?`, [list.id]);
  for (const table of ['plan_passes', 'deck_reads', 'tags_ai_runs', 'tag_jobs', 'deck_tune', 'deck_trim', 'deck_cut_reviews', 'deck_cut_rules', 'deck_playtest', 'jobs', 'suggestion_batches']) {
    await anyRow(table, list.id);
  }
}

/** Starts the server again: fresh modules, then the reset if it is still owed. */
async function restart() {
  vi.resetModules();
  const c = await import('./categories');
  c.startCategories();
  return c;
}

const views = async (list: Awaited<ReturnType<typeof makeDeck>>) => {
  const ph = await import('./plan-help');
  const t = await import('./tags-tab');
  return { plan: await ph.planState(list), tags: await t.tagsTab(list, 'dk'), locked: !ph.isConfirmed(list.id) };
};

describe('the reset of older decks', { timeout: 30_000 }, () => {
  it('leaves an old deck reading exactly like a fresh import with the same cards, and archives what it cleared', async () => {
    const db = await before();
    const old = await makeDeck();
    await fillEverything(old);
    const d = db.database();
    expect((await views(old)).locked).toBe(false);
    d.run(`DELETE FROM settings WHERE key = 'decks.reset'`);

    await restart();
    const twin = await makeDeck();
    const a = await views((await import('./db')).getList(old.id, 'dk')!);
    const b = await views(twin);
    expect(JSON.stringify(a).replaceAll(old.id, twin.id)).toBe(JSON.stringify(b));
    expect(a.locked).toBe(true);
    expect(a.plan.wins).toEqual([]);
    expect(a.plan.neverCut.cards).toEqual([]);

    const r = await import('./deck-reset');
    const db2 = (await import('./db')).database();
    for (const table of r.CLEARED_TABLES) {
      const n = (db2.get(`SELECT count(*) AS n FROM ${table} WHERE listId = ?`, [old.id]) as { n: number }).n;
      expect([table, n]).toEqual([table, table === 'deck_category_marks' ? 1 : 0]);
    }
    expect(db2.get('SELECT tagBrief, tagOverview FROM lists WHERE id = ?', [old.id])).toEqual({ tagBrief: '', tagOverview: '' });
    // The batch that was open before the reset is closed (reading the deck since may open new ones, as on any deck).
    expect(db2.get(`SELECT count(*) AS n FROM suggestion_batches WHERE listId = ? AND closedAt IS NULL AND openedAt LIKE 'x-%'`, [old.id])).toEqual({ n: 0 });
    // The cards stay; the archive has what was cleared.
    expect((db2.get(`SELECT count(*) AS n FROM list_cards WHERE listId = ?`, [old.id]) as { n: number }).n).toBe(SPELLS.length);
    expect(db2.get('SELECT planText FROM plan_owner_before_reset WHERE listId = ?', [old.id])).toEqual({ planText: 'Burn them out.' });
    expect((db2.all('SELECT name FROM deck_tags_before_reset WHERE listId = ?', [old.id]) as Array<{ name: string }>).map((x) => x.name)).toEqual(expect.arrayContaining(['Burn', 'Pet cards', 'Ramp']));
    expect(db2.get('SELECT tagBrief FROM lists_before_reset WHERE id = ?', [old.id])).toEqual({ tagBrief: 'Old brief' });
  });

  it('runs once: a second start changes nothing, and a deck made after the reset began keeps what it has', async () => {
    const db = await before();
    await makeDeck('Old');
    db.database().run(`DELETE FROM settings WHERE key = 'decks.reset'`);
    await restart();
    const fresh = await makeDeck('New');
    await fillEverything(fresh);
    const a = await views(fresh);
    await restart();
    const r = await import('./deck-reset');
    expect(r.resetNeeded()).toBe(false);
    expect(r.resetAll()).toEqual([]);
    expect(await views(fresh)).toEqual(a);
    expect(a.locked).toBe(false);
  });

  it('retries a deck that failed at the next start, without touching the others again', async () => {
    const db = await before();
    const ok = await makeDeck('Fine');
    const bad = await makeDeck('Fails');
    await fillEverything(ok);
    await fillEverything(bad);
    const d = db.database();
    d.run(`DELETE FROM settings WHERE key = 'decks.reset'`);
    d.run(`CREATE TRIGGER fail_reset BEFORE DELETE ON deck_keeps WHEN old.listId = '${bad.id}' BEGIN SELECT RAISE(ABORT, 'boom'); END`);

    await restart();
    const r = await import('./deck-reset');
    expect(r.resetNeeded()).toBe(true);
    const d2 = (await import('./db')).database();
    // The failed deck rolled back whole: it still has its plan.
    expect(d2.get('SELECT planText FROM plan_owner WHERE listId = ?', [bad.id])).toEqual({ planText: 'Burn them out.' });
    expect(d2.get('SELECT planText FROM plan_owner WHERE listId = ?', [ok.id])).toBeNull();
    // The owner changes the deck that was reset; the retry must not clear it again.
    await (await import('./plan-help')).act(ok, 'dk', { action: 'planText', text: 'After the reset.' } as never);

    d2.run('DROP TRIGGER fail_reset');
    await restart();
    const r2 = await import('./deck-reset');
    expect(r2.resetNeeded()).toBe(false);
    const d3 = (await import('./db')).database();
    expect(d3.get('SELECT planText FROM plan_owner WHERE listId = ?', [bad.id])).toBeNull();
    expect(d3.get('SELECT planText FROM plan_owner WHERE listId = ?', [ok.id])).toEqual({ planText: 'After the reset.' });
    // The archive was made once, at the first attempt, and holds both decks.
    expect((d3.all('SELECT listId FROM plan_owner_before_reset') as Array<{ listId: string }>).map((x) => x.listId).sort()).toEqual([bad.id, ok.id].sort());
  });
});
