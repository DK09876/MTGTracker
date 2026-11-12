/**
 * The Tags tab with a stand-in model (no paid call): step 1 offers the six
 * jobs and standout card-data tags with nothing applied; step 2 shows only
 * differences from the deck, never removes from ways to win or key cards,
 * suggests nothing on a second run over unchanged tags, and never brings back
 * what the owner removed. Each test has its own database.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JsonModel, JsonRequest } from './ai';
import type { ScryfallCard } from './scryfall';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-tags-tab-'));
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

const card = (name: string) => ({ id: name, oracle_id: `o-${name}`, name, type_line: 'Instant', cmc: 2, oracle_text: `${name} does a thing.`, color_identity: [], legalities: { commander: 'legal' } }) as ScryfallCard;
const commander = { ...card('Azula'), type_line: 'Legendary Creature — Human Noble' } as ScryfallCard;
async function* rows(tags: Array<Record<string, unknown>>) { for (const t of tags) yield t; }
const tag = (id: string, slug: string, cards: string[]) => ({ id, slug, aliases: [], child_ids: [], taggings: cards.map((oracle_id) => ({ oracle_id })) });

async function deck() {
  // A card-data tag on three of the deck's cards and almost nothing else, plus filler so the tag stands out.
  const { readTagFile, saveTags, localCards } = await import('./card-store');
  localCards(['x']);
  saveTags(await readTagFile(rows([tag('m', 'magecraft', ['o-Spell 1', 'o-Spell 2', 'o-Spell 3']), tag('f', 'filler', Array.from({ length: 300 }, (_, i) => `o-other-${i}`))])));
  const db = await import('./db');
  db.addProfile('dk', 'DK');
  (await import('./categories')).startCategories();
  const list = db.createList('dk', 'Azula', '', { kind: 'deck', commander });
  for (let i = 1; i <= 12; i++) db.addCardToList(list.id, card(`Spell ${i}`));
  const { ROLES_VERSION } = await import('./roles');
  const ids = (db.database().all('SELECT data FROM cards') as Array<{ data: string }>).map((r) => (JSON.parse(r.data) as ScryfallCard).oracle_id!).filter(Boolean);
  db.saveRoles(new Map(ids.map((id) => [id, []] as [string, string[]])), ROLES_VERSION);
  return db.getList(list.id, 'dk')!;
}
function fakeModel(answer: (req: JsonRequest) => unknown) {
  const asked: JsonRequest[] = [];
  const model: JsonModel = async (req) => { asked.push(req); return { data: answer(req), model: 'claude-opus-5-5' }; };
  return { model, asked };
}
const ANSWER = {
  addTo: [{ category: 'Magecraft', card: 'Spell 5', why: 'Same job here.' }, { category: 'Key cards', card: 'Spell 6', why: 'Half a loop.' }, { category: 'Nope', card: 'Spell 1', why: 'x' }],
  removeFrom: [{ category: 'Magecraft', card: 'Spell 3', why: 'Incidental.' }, { category: 'Key cards', card: 'Spell 1', why: 'never' }],
  categories: [{ name: 'Engines', why: 'Turn spells into cards.', cards: ['Spell 8', 'Spell 9', 'Not here'] }],
  notes: 'Worked with what is there.',
};

describe('the Tags tab', { timeout: 30_000 }, () => {
  it('step 1 offers the six jobs and the standout tag, with nothing applied until accepted', async () => {
    const list = await deck();
    const t = await import('./tags-tab');
    let v = await t.tagsTab(list);
    expect(v.categories).toEqual([]);
    expect(v.step1.jobs?.missing.map((j) => j.label)).toEqual(['Ramp', 'Card draw', 'Interaction', 'Board wipes', 'Protection', 'Ways to finish']);
    expect(v.step1.tags.map((x) => x.name)).toEqual(['Magecraft']);
    expect(v.step1.open).toBe(2);
    await t.tagsAct(list, 'dk', { action: 'accept', keys: ['jobs', 'tag:magecraft'] });
    v = await t.tagsTab(list);
    expect(v.categories.map((c) => `${c.kind}:${c.name}`)).toContain('tag:Magecraft');
    expect(v.categories.filter((c) => c.kind === 'job')).toHaveLength(6);
    expect(v.step1.open).toBe(0);
    // A removed job comes back as "Jobs not on this deck"; a removed tag does not come back.
    await t.tagsAct(list, 'dk', { action: 'remove', id: v.categories.find((c) => c.jobId === 'wipe')!.id });
    await t.tagsAct(list, 'dk', { action: 'remove', id: v.categories.find((c) => c.kind === 'tag')!.id });
    v = await t.tagsTab(list);
    expect(v.step1.jobs).toMatchObject({ all: false, missing: [{ id: 'wipe', label: 'Board wipes' }] });
    expect(v.step1.tags).toEqual([]);
  });

  it('step 2 shows differences only, never removes from key cards, and nothing on a second run once applied', async () => {
    const list = await deck();
    const t = await import('./tags-tab');
    const ph = await import('./plan-help');
    await t.tagsAct(list, 'dk', { action: 'accept', keys: ['tag:magecraft'] });
    await ph.act(list, 'dk', { action: 'addKey', name: 'Spell 1' });
    const { model } = fakeModel(() => ANSWER);
    await expect(t.runTagsAi(model, list, 'dk')).rejects.toThrow(/Confirm the plan/);
    await ph.act(list, 'dk', { action: 'confirm' });
    const first = fakeModel(() => ANSWER);
    await t.runTagsAi(first.model, list, 'dk');
    expect(first.asked[0].user).toContain('Magecraft [from the card data]');
    let v = await t.tagsTab(list);
    expect(v.ai.rows.map((r) => `${r.kind}:${r.category}:${r.card ?? r.cards?.join('+')}`)).toEqual([
      'add:Magecraft:Spell 5', 'add:Key cards:Spell 6', 'remove:Magecraft:Spell 3', 'new:Engines:Spell 8+Spell 9',
    ]);
    await t.tagsAct(list, 'dk', { action: 'accept', keys: v.ai.rows.map((r) => r.key) });
    // The same answer again: everything is already on the deck.
    const second = fakeModel(() => ANSWER);
    await t.runTagsAi(second.model, list, 'dk');
    v = await t.tagsTab(list);
    expect(v.ai.rows).toEqual([]);
    // The owner takes out an AI card: a third run does not suggest it again, and the prompt says so.
    const eng = v.categories.find((c) => c.name === 'Engines')!;
    await t.tagsAct(list, 'dk', { action: 'card', id: eng.id, name: 'Spell 9', on: false });
    const third = fakeModel(() => ANSWER);
    await t.runTagsAi(third.model, list, 'dk');
    expect(third.asked[0].user).toContain('Engines: Spell 9 (taken out)');
    v = await t.tagsTab(list);
    expect(v.ai.rows).toEqual([]);
  });

  it('skips come back on the next run', async () => {
    const list = await deck();
    const t = await import('./tags-tab');
    const ph = await import('./plan-help');
    await t.tagsAct(list, 'dk', { action: 'accept', keys: ['tag:magecraft'] });
    await ph.act(list, 'dk', { action: 'confirm' });
    await t.runTagsAi(fakeModel(() => ANSWER).model, list, 'dk');
    let v = await t.tagsTab(list);
    await t.tagsAct(list, 'dk', { action: 'skip', key: v.ai.rows[0].key });
    expect((await t.tagsTab(list)).ai.rows).toHaveLength(v.ai.rows.length - 1);
    await t.runTagsAi(fakeModel(() => ANSWER).model, list, 'dk');
    v = await t.tagsTab(list);
    expect(v.ai.rows.map((r) => r.card ?? r.category)).toContain('Spell 5');
  });
});
