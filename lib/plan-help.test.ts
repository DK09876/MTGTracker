/**
 * The Plan tab with a stand-in model (no paid call): AI fills only what the
 * owner left on Not sure, nothing is applied without a tap, accepted values
 * count as set, asking again brings back skips but not removed items, a new
 * run keeps a confirmed plan confirmed, and confirm is refused with anything open. Ways to win
 * and key cards are the Tags tab's records. Each test has its own database.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JsonModel, JsonRequest } from './ai';
import type { ScryfallCard } from './scryfall';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-plan-help-'));
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

function fakeModel(answer: (req: JsonRequest) => unknown) {
  const asked: JsonRequest[] = [];
  const model: JsonModel = async (req) => { asked.push(req); return { data: answer(req), model: 'claude-opus-5-5' }; };
  return { model, asked };
}
const FULL = {
  state: 'focused',
  fill: { commander: { roles: ['multiplier', 'unsure'], why: 'Copies spells.' }, bracket: { level: 3, why: 'One Game Changer.' }, plan: 'Copy spells and loop.' },
  fuller: 'Should be dropped: the owner wrote nothing.',
  winRoutes: [{ name: 'Copy loop', how: 'Loops.', cards: ['Spell 1', 'Spell 2', 'Not here'] }, { name: 'Empty', how: 'x', cards: ['Not here'] }],
  keyCards: ['Azula', 'Spell 1', 'Spell 2', 'Spell 3', 'Spell 4', 'Spell 5', 'Spell 6', 'Spell 7'],
  questions: [{ text: 'Open one?', aboutSetting: false }, { text: 'Open two?', aboutSetting: false }, { text: 'About your bracket?', aboutSetting: true }, { text: 'Four?' }],
  directions: [{ name: 'Should go', plan: 'x', cards: ['Spell 1'] }],
  summary: 'One plan.',
};

async function deck(name = 'Azula') {
  const db = await import('./db');
  db.addProfile('dk', 'DK');
  const c = await import('./categories');
  c.startCategories();
  const list = db.createList('dk', name, '', { kind: 'deck', commander });
  db.addCardToList(list.id, card('Island', { type_line: 'Basic Land — Island', cmc: 0, oracle_text: '' }), 36);
  for (let i = 1; i <= 30; i++) db.addCardToList(list.id, card(`Spell ${i}`));
  const { ROLES_VERSION } = await import('./roles');
  const ids = (db.database().all('SELECT data FROM cards') as Array<{ data: string }>).map((r) => (JSON.parse(r.data) as ScryfallCard).oracle_id!).filter(Boolean);
  db.saveRoles(new Map([...ids, commander.oracle_id!].map((id) => [id, []] as [string, string[]])), ROLES_VERSION);
  return { db, c, list: db.getList(list.id, 'dk')! };
}

describe('the Plan tab', { timeout: 30_000 }, () => {
  it('keeps the answer to the deck and to what is open, and applies nothing until accepted', async () => {
    const { list } = await deck();
    const ph = await import('./plan-help');
    const { model, asked } = fakeModel(() => FULL);
    await ph.runHelp(model, list, 'dk');
    expect(asked[0].system).toContain('aboutSetting');
    expect(asked[0].user).toContain('What the commander does for the deck: not sure yet (work it out)');
    const s = await ph.planState(list);
    expect(s.help!.commander).toEqual({ roles: ['multiplier'], why: 'Copies spells.' });
    expect(s.help!.bracket?.level).toBe(3);
    expect(s.help!.plan).toBe('Copy spells and loop.');
    expect(s.help!.fuller).toBeNull();
    expect(s.help!.directions).toEqual([]);
    expect(s.help!.wins.map((w) => w.cards)).toEqual([['Spell 1', 'Spell 2']]);
    // At most 5 key cards, never the commander.
    expect(s.help!.keys.map((k) => k.name)).toEqual(['Spell 1', 'Spell 2', 'Spell 3', 'Spell 4', 'Spell 5']);
    // At most 3 questions, the one about a setting first.
    expect(s.help!.questions.map((q) => q.text)).toEqual(['About your bracket?', 'Open one?', 'Open two?']);
    expect(s.help!.questions[0].about).toBe(true);
    // Nothing applied.
    expect(s.commander.roles).toEqual(['unsure']);
    expect(s.bracket.value).toBeNull();
    expect(s.plan.text).toBe('');
    expect(s.wins).toEqual([]);
    expect(s.open).toEqual({ suggestions: 1 + 1 + 1 + 1 + 5, questions: 3 });
    expect(s.bulk).toBe(9);
  });

  it('drops what the owner set even if AI fills it, and offers a fuller version of their own words', async () => {
    const { list } = await deck();
    const ph = await import('./plan-help');
    await ph.act(list, 'dk', { action: 'commander', roles: ['voltron'] });
    await ph.act(list, 'dk', { action: 'bracket', value: 2 });
    await ph.act(list, 'dk', { action: 'planText', text: 'Swing with Azula.' });
    const { model, asked } = fakeModel(() => ({ ...FULL, fuller: 'Swing with Azula, copying spells.' }));
    await ph.runHelp(model, list, 'dk');
    expect(asked[0].user).toContain('Bracket aimed for: 2');
    expect(asked[0].user).toContain('"Swing with Azula."');
    const s = await ph.planState(list);
    expect([s.help!.commander, s.help!.bracket, s.help!.plan]).toEqual([null, null, null]);
    expect(s.help!.fuller).toBe('Swing with Azula, copying spells.');
    // Accept all never takes the fuller version.
    await ph.act(list, 'dk', { action: 'acceptAll' });
    expect((await ph.planState(list)).plan.text).toBe('Swing with Azula.');
  });

  it('accepting counts as set, asking again brings back skips but not what was removed, and a new run keeps the plan confirmed', async () => {
    const { list, c } = await deck();
    const ph = await import('./plan-help');
    const { model } = fakeModel(() => FULL);
    await ph.runHelp(model, list, 'dk');
    await ph.act(list, 'dk', { action: 'acceptCommander' });
    await ph.act(list, 'dk', { action: 'skip', what: 'bracket' });
    await ph.act(list, 'dk', { action: 'acceptWin', name: 'Copy loop' });
    await ph.act(list, 'dk', { action: 'acceptKey', name: 'Spell 3' });
    let s = await ph.planState(list);
    expect(s.commander).toEqual({ roles: ['multiplier'], by: 'ai' });
    expect(s.help!.bracket).toBeNull();
    // The way to win is a category on the deck, the same record the Tags tab shows.
    const tags = await c.categories(list);
    expect(tags.find((x) => x.kind === 'win')).toMatchObject({ name: 'Copy loop', by: 'ai', how: 'Loops.' });
    expect(s.wins[0].cards.map((x) => `${x.name}:${x.by}`)).toEqual(['Spell 1:ai', 'Spell 2:ai']);
    // The owner removes the AI key card: it is not suggested again.
    c.setCategoryCard(list.id, s.key!.id, { key: 'o-Spell 3', name: 'Spell 3' }, false);
    // Answer and skip the questions, then confirm.
    for (const q of s.help!.questions) await ph.act(list, 'dk', q.text === 'Open one?' ? { action: 'answer', id: q.id, text: 'Burn only.' } : { action: 'answer', id: q.id, skip: true });
    await ph.act(list, 'dk', { action: 'acceptAll' });
    await ph.act(list, 'dk', { action: 'skip', what: 'plan' });
    s = await ph.planState(list);
    expect(s.open).toEqual({ suggestions: 0, questions: 0 });
    await ph.act(list, 'dk', { action: 'confirm' });
    s = await ph.planState(list);
    expect(s.confirmed).not.toBeNull();
    // The answer became one note; the skipped ones are not asked again.
    expect(s.notes.map((n) => n.text)).toEqual(['Open one? Burn only.']);
    expect(s.help!.questions).toEqual([]);
    // Asking again: commander accepted counts as set; the skipped bracket comes back; the removed key card does not.
    const again = fakeModel(() => FULL);
    await ph.runHelp(again.model, list, 'dk');
    expect(again.asked[0].user).toContain('What the commander does for the deck: Multiplier');
    expect(again.asked[0].user).toContain('Questions the owner skipped before');
    s = await ph.planState(list);
    expect(s.confirmed).not.toBeNull();
    expect(s.help!.commander).toBeNull();
    expect(s.help!.bracket?.level).toBe(3);
    expect(s.help!.keys.map((k) => k.name)).not.toContain('Spell 3');
    expect(s.help!.wins).toEqual([]);
  });

  it('refuses to confirm with a suggestion or question open, and confirms with everything on Not sure', async () => {
    const { list } = await deck();
    const ph = await import('./plan-help');
    await ph.act(list, 'dk', { action: 'confirm' });
    expect((await ph.planState(list)).confirmed).not.toBeNull();
    const { model } = fakeModel(() => FULL);
    await ph.runHelp(model, list, 'dk');
    await expect(ph.act(list, 'dk', { action: 'confirm' })).rejects.toThrow(/Accept or skip 9 suggestions, and answer or skip 3 questions/);
  });

  it('Skip the rest skips every open suggestion and question; Tune refuses until the plan is confirmed', async () => {
    const { list } = await deck();
    const ph = await import('./plan-help');
    const { requirePlan } = await import('./profile-route');
    expect(requirePlan(list.id)?.status).toBe(409);
    const keyed = { ...FULL, keyCards: [{ card: 'Spell 1', why: 'The engine.' }, 'Spell 2'] };
    await ph.runHelp(fakeModel(() => keyed).model, list, 'dk');
    let s = await ph.planState(list);
    expect(s.help!.keys).toEqual([expect.objectContaining({ name: 'Spell 1', why: 'The engine.' }), expect.objectContaining({ name: 'Spell 2', why: '' })]);
    await ph.act(list, 'dk', { action: 'answer', id: s.help!.questions[0].id, text: 'Combat, mostly.' });
    await ph.act(list, 'dk', { action: 'skipAll' });
    s = await ph.planState(list);
    expect(s.open).toEqual({ suggestions: 0, questions: 0 });
    // The typed answer is kept, not skipped.
    expect(s.help!.questions[0]).toMatchObject({ answer: 'Combat, mostly.', skipped: false });
    await ph.act(list, 'dk', { action: 'confirm' });
    expect(requirePlan(list.id)).toBeNull();
    expect((await ph.planState(list)).notes.map((n) => n.text).join(' ')).toContain('Combat, mostly.');
  });

  it('a pile with no plan gets directions only; picking one fills the plan and three key cards', async () => {
    const { list } = await deck();
    const ph = await import('./plan-help');
    const { model } = fakeModel(() => ({ ...FULL, state: 'no_plan', directions: [{ name: 'Spells', plan: 'Cast spells.', cards: ['Spell 1', 'Spell 2', 'Spell 3', 'Spell 4', 'Nope'] }, { name: 'Go wide', plan: 'Tokens.', cards: ['Spell 9', 'Spell 10'] }] }));
    await ph.runHelp(model, list, 'dk');
    let s = await ph.planState(list);
    expect(s.help!.directions.map((d) => d.name)).toEqual(['Spells', 'Go wide']);
    expect(s.help!.directions[0].cards).toEqual(['Spell 1', 'Spell 2', 'Spell 3', 'Spell 4']);
    expect([s.help!.plan, s.help!.wins.length, s.help!.keys.length]).toEqual([null, 0, 0]);
    await ph.act(list, 'dk', { action: 'direction', name: 'Spells' });
    s = await ph.planState(list);
    expect(s.plan).toEqual({ text: 'Cast spells.', by: 'ai', direction: 'Spells' });
    expect(s.key!.cards.map((x) => x.name)).toEqual(['Spell 1', 'Spell 2', 'Spell 3']);
    // Switching direction swaps AI's key cards.
    await ph.act(list, 'dk', { action: 'direction', name: 'Go wide' });
    expect((await ph.planState(list)).key!.cards.map((x) => x.name)).toEqual(['Spell 10', 'Spell 9']);
  });

  it('a garbled answer stores nothing', async () => {
    const { list } = await deck();
    const ph = await import('./plan-help');
    const { model } = fakeModel(() => ({ nope: true }));
    await expect(ph.runHelp(model, list, 'dk')).rejects.toThrow(/unusable/);
    expect((await ph.planState(list)).help).toBeNull();
  });
});
