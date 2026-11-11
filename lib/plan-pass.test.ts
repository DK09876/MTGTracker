/**
 * The plan read with a stand-in model (no paid call): what it keeps from an
 * answer, the owner's edits kept on every read, questions turned into the
 * owner's notes, when a read goes out of date, what later AI steps get, and
 * the commander suggestion's conditions. Each test has its own database.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JsonModel, JsonRequest } from './ai';
import type { ScryfallCard } from './scryfall';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-plan-pass-'));
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

/** A stand-in for Opus: answers with whatever the test gives, and keeps the request. */
function fakeModel(answer: (req: JsonRequest) => unknown) {
  const asked: JsonRequest[] = [];
  const model: JsonModel = async (req) => { asked.push(req); return { data: answer(req), model: 'claude-opus-5-5' }; };
  return { model, asked };
}
const ANSWER = {
  state: 'focused', plan: 'Copy spells while Azula attacks.',
  winRoutes: [{ name: 'Pingers', cards: ['Spell 1', 'Spell 2', 'Not In Deck'] }],
  keyCards: ['Spell 1', 'Spell 2', 'Spell 3', 'Spell 4', 'Spell 5', 'Spell 6', 'Spell 7', 'Spell 8', 'Spell 9'],
  themes: [{ name: 'Spells', cards: ['Spell 3', 'Spell 4'] }],
  cards: [{ name: 'Spell 1', role: 'engine', note: 'draws' }, { name: 'Spell 2', role: 'win', note: 'pings' }, { name: 'Island', role: 'filler', note: 'land' }, { name: 'Spell 3', role: 'bogus', note: '' },
    // A role for the rest, as a real read gives (a read with roles for under half the cards fails).
    ...Array.from({ length: 57 }, (_, i) => ({ name: `Spell ${i + 4}`, role: 'support', note: '' }))],
  questions: ['Is the loop real?', 'Combat or not?', 'Wizards for type?', 'A fourth?'],
  summary: 'A focused spells deck.',
  commander: { roles: ['multiplier', 'unsure', 'made-up'], why: 'Copies spells.' },
};

async function deck(spells = 60) {
  const db = await import('./db');
  db.addProfile('dk', 'DK');
  const list = db.createList('dk', 'Azula', '', { kind: 'deck', commander });
  db.addCardToList(list.id, island, 39);
  for (let i = 1; i <= spells; i++) db.addCardToList(list.id, card(`Spell ${i}`));
  await seedRoles();
  return { db, list: db.getList(list.id, 'dk')! };
}
/** Roles already looked up, as the nightly refresh leaves them: nothing is searched. */
async function seedRoles() {
  const db = await import('./db');
  const { ROLES_VERSION } = await import('./roles');
  const ids = (db.database().all('SELECT data FROM cards') as Array<{ data: string }>).map((r) => (JSON.parse(r.data) as ScryfallCard).oracle_id!).filter(Boolean);
  db.saveRoles(new Map([...new Set([...ids, commander.oracle_id!])].map((id) => [id, []] as [string, string[]])), ROLES_VERSION);
}

describe('the plan read', { timeout: 30_000 }, () => {
  it('keeps only cards in the deck, at most 8 key cards and 3 questions, and valid roles', async () => {
    const { list } = await deck();
    const pp = await import('./plan-pass');
    const { model, asked } = fakeModel(() => ANSWER);
    const pass = await pp.runPass(model, list, 'dk');
    expect(pass.output.winRoutes[0].cards).toEqual(['Spell 1', 'Spell 2']);
    expect(pass.output.keyCards).toHaveLength(8);
    expect(pass.output.questions).toHaveLength(3);
    expect(pass.output.cards['Spell 1']).toEqual({ role: 'engine', note: 'draws' });
    expect(pass.output.cards['Spell 2']).toEqual({ role: 'win', note: 'pings' });
    // Not a land, not an unknown role.
    expect(pass.output.cards.Island).toBeUndefined();
    expect(pass.output.cards['Spell 3']).toBeUndefined();
    expect(Object.keys(pass.output.cards)).toHaveLength(59);
    expect(pass.output.commander.roles).toEqual(['multiplier']);
    // One Opus call, the shape in the prompt, every card's text in, never asked to show its working.
    expect(asked).toHaveLength(1);
    expect(asked[0].promptOnly).toBe(true);
    expect(asked[0].user).toContain('Spell 37');
    expect(asked[0].system).not.toMatch(/step[- ]by[- ]step|show your (work|reasoning)|explain your reasoning/i);
  });

  it('reads what the owner told the app: commander, settings, notes, and their fixed edits', async () => {
    const { list } = await deck();
    const pp = await import('./plan-pass');
    const plan = await import('./deck-plan');
    pp.setCommanderRoles(list.id, ['voltron']);
    plan.changePlan(list.id, { bracket: 3, notes: { add: ['I never cut Spell 9.'], by: 'owner' } });
    plan.changePlan(list.id, { notes: { add: ['Claude thinks Spell 4 is weak.'], by: 'ai' } });
    pp.setEdits(list.id, { keyCards: ['Spell 10'] });
    const { model, asked } = fakeModel(() => ANSWER);
    await pp.runPass(model, list, 'dk');
    const user = asked[0].user;
    expect(user).toContain('What the commander does for the deck: Voltron');
    expect(user).toContain('Bracket aimed for: 3');
    expect(user).toContain('I never cut Spell 9.');
    expect(user).not.toContain('Claude thinks Spell 4');
    expect(user).toContain('Fixed by the owner');
    expect(user).toContain('keyCards: ["Spell 10"]');
  });

  it('keeps the owner’s edits on every read, even when the answer drops them', async () => {
    const { list } = await deck();
    const pp = await import('./plan-pass');
    await pp.runPass(fakeModel(() => ANSWER).model, list, 'dk');
    pp.setEdits(list.id, { keyCards: ['Spell 1', 'Spell 20'], winRoutes: [{ name: 'Mine', cards: ['Spell 30'] }], roles: { 'Spell 2': 'filler' } });
    // The next read ignores them.
    await pp.runPass(fakeModel(() => ({ ...ANSWER, keyCards: ['Spell 3'] })).model, list, 'dk');
    const v = pp.planView(list);
    expect(v.pass!.keyCards).toEqual(['Spell 1', 'Spell 20']);
    expect(v.pass!.yours.keyCards).toEqual(['Spell 1', 'Spell 20']);
    expect(v.pass!.winRoutes).toEqual([{ name: 'Mine', cards: ['Spell 30'] }]);
    expect(v.pass!.cards['Spell 2']).toMatchObject({ role: 'filler', yours: true });
    pp.undoEdits(list.id);
    expect(pp.planView(list).pass!.keyCards).toEqual(['Spell 3']);
  });

  it('turns answers into the owner’s notes, logs them, and stops asking once confirmed', async () => {
    const { list } = await deck();
    const pp = await import('./plan-pass');
    await pp.runPass(fakeModel(() => ANSWER).model, list, 'dk');
    expect(pp.planView(list).pass!.questions).toHaveLength(3);
    pp.takeOwnerInput(list.id, 'dk', { answers: [{ question: 'Is the loop real?', answer: 'A bonus.' }], skipped: ['Combat or not?'], note: 'Lean on combat.' });
    pp.confirmPlan(list.id);
    const v = pp.planView(list);
    expect(v.confirmed).toBeTruthy();
    expect(v.pass!.questions).toEqual([]);
    const plan = (await import('./deck-plan')).planFor(list.id, '', list.commander, []);
    expect(plan.notes.filter((n) => n.by === 'owner').map((n) => n.text)).toEqual(['Is the loop real? A bonus.', 'Lean on combat.']);
    const kinds = (await import('./db')).database().all('SELECT kind FROM conversation_events ORDER BY at, kind') as Array<{ kind: string }>;
    expect(kinds.map((k) => k.kind).sort()).toEqual(['approach_corrected', 'question_answered', 'question_asked', 'question_asked', 'question_asked', 'question_skipped']);
    // Correcting a card's role keeps it confirmed; editing the plan unconfirms.
    pp.setEdits(list.id, { roles: { 'Spell 4': 'engine' } });
    expect(pp.planView(list).confirmed).toBeTruthy();
    pp.setEdits(list.id, { plan: 'My words.' });
    expect(pp.planView(list).confirmed).toBeNull();
  });

  it('suggests what the commander does only for Unsure, after confirming, at 50+ non-land cards', async () => {
    const small = await deck(40);
    const pp = await import('./plan-pass');
    await pp.runPass(fakeModel(() => ANSWER).model, small.list, 'dk');
    pp.confirmPlan(small.list.id);
    expect(pp.planView(small.list).pass!.commander).toBeNull();

    const big = await (async () => {
      const db = await import('./db');
      const l = db.createList('dk', 'Big', '', { kind: 'deck', commander });
      for (let i = 1; i <= 60; i++) db.addCardToList(l.id, card(`Spell ${i}`));
      await seedRoles();
      return db.getList(l.id, 'dk')!;
    })();
    await pp.runPass(fakeModel(() => ANSWER).model, big, 'dk');
    expect(pp.planView(big).pass!.commander).toBeNull(); // not confirmed yet
    pp.confirmPlan(big.id);
    expect(pp.planView(big).pass!.commander).toEqual({ roles: ['multiplier'], why: 'Copies spells.' });
    pp.setCommanderRoles(big.id, ['voltron']);
    expect(pp.planView(big).pass!.commander).toBeNull(); // only for Unsure
    pp.setCommanderRoles(big.id, ['unsure']);
    pp.acceptCommanderSuggestion(big.id);
    expect(pp.owner(big.id).commanderRoles).toEqual(['multiplier']);
  });

  it('keeps Unsure alone', async () => {
    const { list } = await deck();
    const pp = await import('./plan-pass');
    expect(pp.owner(list.id).commanderRoles).toEqual(['unsure']);
    expect(pp.setCommanderRoles(list.id, ['unsure', 'voltron']).commanderRoles).toEqual(['voltron']);
    expect(pp.setCommanderRoles(list.id, []).commanderRoles).toEqual(['unsure']);
  });

  it('goes out of date at 10 changed cards, a new commander or a key card gone, and is then not given to AI steps', async () => {
    const { db, list } = await deck();
    const pp = await import('./plan-pass');
    await pp.runPass(fakeModel(() => ANSWER).model, list, 'dk');
    expect(pp.planView(list).stale).toBeNull();
    expect(pp.planForAi(list)?.text).toContain('Copy spells while Azula attacks.');
    // Four swaps: eight cards changed, still current.
    for (let i = 50; i < 54; i++) { db.removeCardFromList(list.id, `Spell ${i}`); db.addCardToList(list.id, card(`New ${i}`)); }
    await seedRoles();
    expect(pp.planView(list).stale).toBeNull();
    db.removeCardFromList(list.id, 'Spell 54'); db.addCardToList(list.id, card('New 54'));
    expect(pp.planView(list).stale).toMatchObject({ changed: 10, usingAnyway: false });
    expect(pp.planForAi(list)).toBeNull();
    pp.keepStalePlan(list.id);
    expect(pp.planForAi(list)?.text).toContain('out of date but the owner chose to use it');
  });

  it('goes out of date when a key card leaves', async () => {
    const { db, list } = await deck();
    const pp = await import('./plan-pass');
    await pp.runPass(fakeModel(() => ANSWER).model, list, 'dk');
    db.removeCardFromList(list.id, 'Spell 1');
    expect(pp.planView(list).stale).toMatchObject({ keyCardsGone: ['Spell 1'] });
  });

  it('gives later AI steps the plan and the owner’s notes, not Claude’s', async () => {
    const { list } = await deck();
    const pp = await import('./plan-pass');
    const plan = await import('./deck-plan');
    pp.setCommanderRoles(list.id, ['lynchpin']);
    await pp.runPass(fakeModel(() => ANSWER).model, list, 'dk');
    plan.changePlan(list.id, { notes: { add: ['Spell 9 stays.'], by: 'owner' } });
    const text = await (await import('./plan-context')).planContext(list);
    expect(text).toContain("The deck's plan (read by claude-opus-5-5, not yet confirmed)");
    expect(text).toContain('Cards read as engine: Spell 1');
    expect(text).toContain('Lynchpin');
    expect(text).toContain('Spell 9 stays.');
    // With a current read, the code's own detected plan is left out: no second set of key cards or ways to win.
    expect(text).not.toContain('Key cards (built around');
    expect(text).not.toMatch(/^- Ways to win:/m);
    expect(text).not.toContain('Leans on the commander');
    expect(text).toContain('Lands:');
  });

  it('fails a garbled answer instead of storing it', async () => {
    const { list } = await deck();
    const pp = await import('./plan-pass');
    const bad = [
      { ...ANSWER, state: undefined },
      { ...ANSWER, plan: '  ' },
      { ...ANSWER, cards: ANSWER.cards.slice(0, 20) },
    ];
    for (const a of bad) await expect(pp.runPass(fakeModel(() => a).model, list, 'dk')).rejects.toBeInstanceOf(pp.BadRead);
    expect(pp.latestPass(list.id)).toBeNull();
  });

  it('checks key cards and route cards against the deck, and fixes their spelling', async () => {
    const { list } = await deck();
    const pp = await import('./plan-pass');
    await pp.runPass(fakeModel(() => ANSWER).model, list, 'dk');
    expect(() => pp.setEdits(list.id, { keyCards: ['Spell 1', 'Spel 2'] }, list)).toThrow(pp.NotInDeck);
    expect(() => pp.setEdits(list.id, { winRoutes: [{ name: 'X', cards: ['Nope'] }] }, list)).toThrow(/Not in the deck: Nope/);
    pp.setEdits(list.id, { keyCards: ['spell 7'] }, list);
    const v = pp.planView(list);
    expect(v.pass!.keyCards).toEqual(['Spell 7']);
    expect(v.stale).toBeNull();
  });

  it('flags the read’s engines, key cards and way-to-win cards while it is current, and blocks none of them', async () => {
    const { db, list } = await deck();
    const pp = await import('./plan-pass');
    expect(pp.readFlags(list).size).toBe(0);
    await pp.runPass(fakeModel(() => ANSWER).model, list, 'dk');
    const f = pp.readFlags(list);
    expect(f.get('Spell 1')).toEqual({ flag: 'Engine in the plan', strong: true });
    // A key card that is also in a way to win reads as the key card.
    expect(f.get('Spell 2')).toEqual({ flag: 'Key card in the plan', strong: true });
    expect(f.has('Spell 30')).toBe(false);
    pp.setEdits(list.id, { roles: { 'Spell 30': 'engine' } }, list);
    expect(pp.readFlags(list).get('Spell 30')?.strong).toBe(true);
    // Out of date: nothing is flagged.
    for (let i = 40; i < 50; i++) db.removeCardFromList(list.id, `Spell ${i}`);
    expect(pp.readFlags(list).size).toBe(0);
  });

  it('keeps typed answers for the latest read until they are sent', async () => {
    const { list } = await deck();
    const pp = await import('./plan-pass');
    await pp.runPass(fakeModel(() => ANSWER).model, list, 'dk');
    pp.saveDrafts(list.id, { answers: { 'Is the loop real?': 'Half' }, skipped: ['Combat or not?'], note: 'hm' });
    expect(pp.planView(list).drafts).toEqual({ answers: { 'Is the loop real?': 'Half' }, skipped: ['Combat or not?'], note: 'hm' });
    pp.takeOwnerInput(list.id, 'dk', { answers: [{ question: 'Is the loop real?', answer: 'Half' }] });
    expect(pp.planView(list).drafts).toBeNull();
  });
});

describe('the plan read through its route', { timeout: 60_000 }, () => {
  it('sets the commander, edits and confirms, and reads in the background', async () => {
    const { list } = await deck();
    const db = await import('./db');
    db.addProfile('kevin', 'Kevin');
    db.database().run('UPDATE lists SET profileId = ? WHERE id = ?', ['kevin', list.id]);
    const { model } = fakeModel(() => ANSWER);
    vi.doMock('./ai', async (orig) => ({ ...(await orig<typeof import('./ai')>()), modelById: () => model }));
    const route = await import('../app/api/lists/[id]/plan/pass/route');
    const params = { params: Promise.resolve({ id: list.id }) };
    const post = async (body: object) => (await route.POST(new Request(`http://x/api/lists/${list.id}/plan/pass?profile=kevin`, { method: 'POST', body: JSON.stringify(body) }), params)).json();
    const get = async () => (await route.GET(new Request(`http://x/api/lists/${list.id}/plan/pass?profile=kevin`), params)).json();

    expect((await get()).pass).toBeNull();
    expect((await post({ action: 'commanderRoles', roles: ['enabler'] })).commanderRoles).toEqual(['enabler']);
    await post({ action: 'generate', note: 'Lean on combat.' });
    let v = await get();
    for (let i = 0; i < 50 && !v.pass; i++) { await new Promise((r) => setTimeout(r, 50)); v = await get(); }
    expect(v.pass.plan).toBe('Copy spells while Azula attacks.');
    v = await post({ action: 'edits', edits: { keyCards: ['Spell 5'] } });
    expect(v.pass.keyCards).toEqual(['Spell 5']);
    const typo = await post({ action: 'edits', edits: { keyCards: ['Spel 5'] } });
    expect(typo).toMatchObject({ names: ['Spel 5'] });
    v = await post({ action: 'confirm', answers: [{ question: 'Is the loop real?', answer: 'Yes.' }] });
    expect(v.confirmed).toBeTruthy();
    expect(v.pass.questions).toEqual([]);
    vi.doUnmock('./ai');
  });
});
