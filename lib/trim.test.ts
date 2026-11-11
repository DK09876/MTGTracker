/**
 * Trim with a stand-in model (no paid call): what the cut list keeps from an
 * answer, the guards code applies whatever the model says, the owner's
 * choices and reasons carried into a rerun and remembered for the deck,
 * apply and undo, and what reaches the suggestion log. Each test has its own
 * database.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JsonModel, JsonRequest } from './ai';
import type { ScryfallCard } from './scryfall';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-trim-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.stubEnv('MTG_CARDS_DB_PATH', join(dir, 'cards.db'));
  // Scryfall and Commander Spellbook can't be reached: the facts still build.
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
const commander = card('Azula, Fire Lord', { type_line: 'Legendary Creature — Human Noble', cmc: 5, oracle_text: 'Whenever you cast a spell while Azula is attacking, copy it.' });
const island = card('Island', { type_line: 'Basic Land — Island', cmc: 0, oracle_text: '' });

/** A deck 8 over: the commander, 37 Islands and 70 spells. */
async function deck() {
  const db = await import('./db');
  db.addProfile('dk', 'DK');
  const list = db.createList('dk', 'Azula', '', { kind: 'deck', commander });
  db.addCardToList(list.id, island, 37);
  for (let i = 1; i <= 70; i++) db.addCardToList(list.id, card(`Spell ${i}`));
  const { ROLES_VERSION } = await import('./roles');
  const ids = (db.database().all('SELECT data FROM cards') as Array<{ data: string }>).map((r) => (JSON.parse(r.data) as ScryfallCard).oracle_id!).filter(Boolean);
  db.saveRoles(new Map([...new Set([...ids, commander.oracle_id!])].map((id) => [id, []] as [string, string[]])), ROLES_VERSION);
  return { db, list: db.getList(list.id, 'dk')! };
}

function fakeModel(answer: (req: JsonRequest) => unknown) {
  const asked: JsonRequest[] = [];
  const model: JsonModel = async (req) => { asked.push(req); return { data: answer(req), model: 'claude-opus-5-5' }; };
  return { model, asked };
}

const ranked = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ name: `Spell ${from + i}`, why: `Spell ${from + i} is surplus.`, with: i === 0 ? ['Spell 60', 'Not A Card'] : [] }));
/** 16 ranked (8 over, 8 closer calls), with a commander, an unknown name and a repeat mixed in. */
const ANSWER = {
  ranked: [{ name: 'Azula, Fire Lord', why: 'no', with: [] }, { name: 'Nope', why: 'no', with: [] }, ...ranked(1, 8), { name: 'spell 1', why: 'again', with: [] }, ...ranked(9, 8)],
  keep: [{ name: 'Spell 40', why: 'Half of the main loop.' }, { name: 'Spell 2', why: 'already listed' }],
  notes: 'Mostly surplus spells.',
};

describe('trim', { timeout: 60_000 }, () => {
  it('keeps the ranked list to cards in the deck: the first N are the cuts, the rest closer calls', async () => {
    const { list } = await deck();
    const trim = await import('./trim');
    const { model, asked } = fakeModel(() => ANSWER);
    await trim.setApproach(list, 'dk', { text: 'Cut the weakest spells first.' });
    trim.setCorrection(list.id, 'Keep Spell 70.');
    await trim.runTrim(model, list, 'dk', { model: 'opus' });
    const v = await trim.trimView(list, 'dk');
    expect(v.size).toBe(108);
    expect(v.over).toBe(8);
    expect(v.run!.items.filter((i) => i.tier === 'cut').map((i) => i.name)).toEqual(ranked(1, 8).map((r) => r.name));
    expect(v.run!.items.filter((i) => i.tier === 'maybe')).toHaveLength(8);
    // A card Claude left in on purpose; one it also ranked is not repeated there.
    expect(v.run!.items.filter((i) => i.tier === 'kept').map((i) => i.name)).toEqual(['Spell 40']);
    expect(v.run!.items[0].with).toEqual(['Spell 60']);
    // The cuts are chosen from the start, and the numbers follow them.
    expect(v.impact.size).toEqual({ before: 108, after: 100 });
    // One call, with the count, the approach and the owner's line; the big answer is read leniently.
    expect(asked).toHaveLength(1);
    expect(asked[0].promptOnly).toBe(true);
    expect(asked[0].user).toContain('It is 8 over');
    expect(asked[0].user).toContain('Rank exactly 16 cards');
    expect(asked[0].user).toContain('Cut the weakest spells first.');
    expect(asked[0].user).toContain('Keep Spell 70.');
    expect(asked[0].user).toContain('**Spell 1**');
  });

  it('fails a list too short to make the cuts, and stores nothing', async () => {
    const { list } = await deck();
    const trim = await import('./trim');
    await expect(trim.runTrim(fakeModel(() => ({ ranked: ranked(1, 5), keep: [], notes: '' })).model, list, 'dk', { model: 'opus' })).rejects.toThrow(/5 usable cards for 8 cuts/);
    expect((await trim.trimView(list, 'dk')).run).toBeNull();
  });

  it('never lists a ★ card, whatever the model says', async () => {
    const { list } = await deck();
    const trim = await import('./trim');
    (await import('./deck-roles')).setKeep(list.id, 'o-Spell 1', true);
    const { asked, model } = fakeModel(() => ANSWER);
    await trim.runTrim(model, list, 'dk', { model: 'opus' });
    const v = await trim.trimView(list, 'dk');
    expect(v.run!.items.some((i) => i.name === 'Spell 1')).toBe(false);
    expect(v.run!.items.filter((i) => i.tier === 'cut')).toHaveLength(8);
    expect(asked[0].user).toContain('Spell 1 (★ never cut)');
  });

  it('a rerun takes the owner’s choices as settled, keeps the approach, and remembers the reasons', async () => {
    const { list } = await deck();
    const trim = await import('./trim');
    await trim.setApproach(list, 'dk', { text: 'My approach.' });
    await trim.runTrim(fakeModel(() => ANSWER).model, list, 'dk', { model: 'opus' });
    // Keep one of the cuts as a pet card, and cut one of the closer calls with a reason.
    trim.setChoices(list.id, { 'Spell 3': { choice: 'keep', chip: 'pet_card' }, 'Spell 12': { choice: 'cut', text: 'never cast it' }, 'Not Listed': { choice: 'cut' } });
    let v = await trim.trimView(list, 'dk');
    expect(Object.keys(v.choices).sort()).toEqual(['Spell 12', 'Spell 3']);
    expect(v.impact.size.after).toBe(100);
    // The model lists the kept card again anyway: code leaves it out.
    const { model, asked } = fakeModel(() => ANSWER);
    await trim.runTrim(model, list, 'dk', { model: 'opus', rerun: true });
    expect(asked[0].user).toContain('- Spell 3: the owner keeps it ("a pet card")');
    expect(asked[0].user).toContain('- Spell 12: the owner cuts it ("never cast it")');
    expect(asked[0].user).toContain('My approach.');
    v = await trim.trimView(list, 'dk');
    expect(v.approach!.text).toBe('My approach.');
    expect(v.run!.round).toBe(2);
    const cuts = v.run!.items.filter((i) => i.tier === 'cut').map((i) => i.name);
    expect(cuts[0]).toBe('Spell 12');
    expect(cuts).not.toContain('Spell 3');
    expect(cuts).toHaveLength(8);
    expect(v.run!.items.find((i) => i.name === 'Spell 3')!.tier).toBe('yours');
    // The cut the owner chose keeps its reason; the kept card is remembered and ★ kept as a pet card.
    expect(v.choices['Spell 12']).toMatchObject({ choice: 'cut', text: 'never cast it' });
    expect(trim.trimStore(list.id).said['Spell 3']).toMatchObject({ choice: 'keep', chip: 'pet_card' });
    expect((await import('./deck-roles')).keeps(list.id).has('o-Spell 3')).toBe(true);
    // A later fresh list is told what was kept before.
    const later = fakeModel(() => ({ ...ANSWER, ranked: ranked(20, 16) }));
    await trim.runTrim(later.model, list, 'dk', { model: 'opus' });
    expect(later.asked[0].user).toContain('Kept, not to be listed again:');
    expect(later.asked[0].user).toContain('- Spell 3 ("a pet card")');
  });

  it('applies the chosen cuts to exactly 100, with a done screen that can be undone', async () => {
    const { db, list } = await deck();
    const trim = await import('./trim');
    await trim.runTrim(fakeModel(() => ANSWER).model, list, 'dk', { model: 'opus' });
    // Two closer calls chosen on top of the eight: ten is past 100, so only eight go.
    trim.setChoices(list.id, { 'Spell 9': { choice: 'cut' }, 'Spell 10': { choice: 'cut' } });
    const done = await trim.applyTrim(list, 'dk');
    expect(done.cut).toBe(8);
    expect(done.size).toBe(100);
    const main = () => db.cardsInList(list.id).filter((c) => c.board === 'main');
    expect(main().some((c) => c.card.name === 'Spell 1')).toBe(false);
    expect(db.cardsInList(list.id).find((c) => c.card.name === 'Spell 1')!.board).not.toBe('main');
    let v = await trim.trimView(db.getList(list.id, 'dk')!, 'dk');
    expect(v.over).toBe(0);
    expect(v.done!.logged).toMatchObject({ accepted: 8, refused: 0 });
    // What was shown, and what became of it.
    const events = db.database().all(`SELECT e.itemKey, e.preselected, e.task, e.method, o.outcome FROM suggestion_events e LEFT JOIN suggestion_outcomes o ON o.eventId = e.id`) as Array<{ itemKey: string; preselected: number; task: string; method: string; outcome: string | null }>;
    expect(events).toHaveLength(16);
    expect(events.every((e) => e.task === 'trim' && e.method === 'ai')).toBe(true);
    expect(events.filter((e) => e.preselected)).toHaveLength(8);
    expect(events.filter((e) => e.outcome === 'accepted')).toHaveLength(8);
    expect(events.filter((e) => e.outcome === 'ignored')).toHaveLength(8);
    trim.undoTrim(db.getList(list.id, 'dk')!);
    expect(main().some((c) => c.card.name === 'Spell 1')).toBe(true);
    v = await trim.trimView(db.getList(list.id, 'dk')!, 'dk');
    expect(v.over).toBe(8);
    expect(v.done).toBeNull();
    expect(v.run!.items.filter((i) => i.tier === 'cut')).toHaveLength(8);
  });

  it('drafts an approach from the deck’s numbers without a model', async () => {
    const { list } = await deck();
    const trim = await import('./trim');
    await trim.setApproach(list, 'dk', { draft: true });
    const v = await trim.trimView(list, 'dk');
    expect(v.approach!.by).toBe('code');
    expect(v.approach!.text).toContain('- Cut 8 to reach 100.');
    expect(v.approach!.text).toContain('Lands: 37');
    expect(v.approach!.text).toContain('Never offered: the commander');
    // Editing it makes it the owner's.
    await trim.setApproach(list, 'dk', { text: 'Mine now.' });
    expect((await trim.trimView(list, 'dk')).approach).toMatchObject({ by: 'owner', text: 'Mine now.' });
  });

  it('writes Claude’s approach as bullets', async () => {
    const { list } = await deck();
    const trim = await import('./trim');
    const { model, asked } = fakeModel(() => ({ bullets: ['Trim the surplus spells.', '- Keep the loop.'] }));
    const a = await trim.writeApproach(model, list, 'dk');
    expect(a).toMatchObject({ by: 'claude', text: '- Trim the surplus spells.\n- Keep the loop.' });
    expect(asked[0].user).toContain('8 to cut');
    await expect(trim.writeApproach(fakeModel(() => ({ bullets: [] })).model, list, 'dk')).rejects.toThrow(/empty/);
  });
});
