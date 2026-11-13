/**
 * Tune for a stored deck: staging suggestions, cuts stopping at 100, a swap
 * staying a pair, applying moving the cards (cuts to the section for cards
 * that came out, adds out of the Maybeboard), Claude's ideas kept to real
 * cards, and the problems each mapped to a job. Each test gets its own
 * database file, and nothing is looked up online.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScryfallCard } from './scryfall';
import type { Suggestion } from './tune-shared';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-tune-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.resetModules();
  // Offline: role lookups find nothing, and no card is fetched.
  vi.doMock('./scryfall', async (orig) => ({
    ...(await orig<typeof import('./scryfall')>()),
    searchCards: async () => ({ cards: [], totalCards: 0, hasMore: false }),
    getCard: async () => { throw new Error('offline'); },
  }));
});

afterEach(() => {
  vi.doUnmock('./scryfall');
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

const card = (name: string, over: Partial<ScryfallCard> = {}) =>
  ({ id: name, oracle_id: `o-${name}`, name, type_line: 'Artifact', cmc: 2, color_identity: [], legalities: { commander: 'legal' }, prices: { usd: '1.00' }, ...over }) as ScryfallCard;
const commander = card('Prosper, Tome-Bound', { type_line: 'Legendary Creature — Tiefling Warlock', cmc: 4, color_identity: ['B', 'R'] });
const swamp = card('Swamp', { type_line: 'Basic Land — Swamp', cmc: 0, produced_mana: ['B'] });

async function deck(spells: number, opts: { maybe?: ScryfallCard[] } = {}) {
  const db = await import('./db');
  const plan = await import('./deck-plan');
  const list = db.createList('dk', 'Prosper', '', { kind: 'deck', commander });
  db.addCardToList(list.id, swamp, 37);
  for (let i = 0; i < spells; i++) db.addCardToList(list.id, card(`Spell ${i}`));
  for (const c of opts.maybe ?? []) db.addCardToList(list.id, c, 1, 'nonfoil', 'maybe');
  plan.changePlan(list.id, { confirm: true });
  return { db, list: db.getList(list.id, 'dk')! };
}
const cutOf = (name: string, key = `k:${name}`): Suggestion => ({ key, cut: { id: name, name, cmc: 2, manaCost: '', typeLine: '', image: null, quantity: 1 }, why: 'test' });
const addOf = (name: string, key = `k:add:${name}`): Suggestion => ({ key, add: { id: name, name, cmc: 2, manaCost: '', typeLine: '', image: null, quantity: 1 }, why: 'test' });

describe('staging', { timeout: 30_000 }, () => {
  it('stops cuts on their own at 100, and keeps a swap a pair', async () => {
    const { list } = await deck(64); // 1 + 37 + 64 = 102
    const tune = await import('./tune');
    const first = await tune.stage(list, 'dk', [cutOf('Spell 1'), cutOf('Spell 2'), cutOf('Spell 3')]);
    expect(first).toEqual({ staged: 2, capped: 1, blocked: 0 });
    // A swap doesn't change the size, so it is still allowed at 100.
    const swap = await tune.stage(list, 'dk', [{ ...cutOf('Spell 4', 'k:swap'), add: { id: 'Spell 9', name: 'Spell 9', cmc: 2, manaCost: '', typeLine: '', image: null, quantity: 1 } }]);
    expect(swap.staged).toBe(1);
    const store = (await import('./tune-store')).tuneStore(list.id);
    expect(store.changes.cut).toHaveLength(3);
    const pair = store.changes.cut.find((c) => c.from === 'k:swap')!.pair;
    expect(pair).toBeTruthy();
    // Unstaging either half takes the swap out whole.
    tune.unstage(list.id, ['k:swap']);
    const after = (await import('./tune-store')).tuneStore(list.id);
    expect(after.changes.cut).toHaveLength(2);
    expect(after.changes.add).toHaveLength(0);
  });

  it('never stages the commander as a cut', async () => {
    const { list } = await deck(70);
    const tune = await import('./tune');
    expect((await tune.stage(list, 'dk', [cutOf('Prosper, Tome-Bound')])).staged).toBe(0);
  });
});

describe('applying', { timeout: 30_000 }, () => {
  it('moves cuts to the section for cards that came out, with the reason, and adds from the Maybeboard', async () => {
    const mahadi = card('Mahadi, Emporium Master', { color_identity: ['B', 'R'], cmc: 3 });
    const { db, list } = await deck(62, { maybe: [mahadi] });
    const tune = await import('./tune');
    await tune.stage(list, 'dk', [{ key: 'swap', add: { ...addOf('Mahadi, Emporium Master').add! }, cut: cutOf('Spell 0').cut, why: 'Same job, more treasure' }]);
    const done = await tune.applyChanges(list);
    expect(done).toMatchObject({ added: 1, cut: 1 });
    const cards = db.cardsInList(list.id);
    expect(cards.find((c) => c.card.name === 'Mahadi, Emporium Master')?.board).toBe('main');
    expect(cards.find((c) => c.card.name === 'Spell 0')?.board).toBe('side');
    const store = (await import('./tune-store')).tuneStore(list.id);
    expect(store.cutReasons['Spell 0'].why).toBe('Same job, more treasure');
    expect(store.changes).toEqual({ add: [], cut: [] });
    // The undo puts back exactly what moved.
    expect(done.undo.moves.map((m) => [m.name, m.to])).toEqual([['Spell 0', 'main'], ['Mahadi, Emporium Master', 'maybe']]);
  });

  it('undoes an apply exactly, leaving what you staged since alone', async () => {
    const mahadi = card('Mahadi, Emporium Master', { color_identity: ['B', 'R'], cmc: 3 });
    const { db, list } = await deck(62, { maybe: [mahadi] });
    const tune = await import('./tune');
    await tune.stage(list, 'dk', [{ key: 'swap', add: { ...addOf('Mahadi, Emporium Master').add! }, cut: cutOf('Spell 0').cut, why: 'Same job' }]);
    await tune.stage(list, 'dk', [cutOf('Swamp', 'k:basic')]);
    const done = await tune.applyChanges(list);
    // Something new staged after the apply.
    // (a swap: a cut on its own would be capped at 100)
    await tune.stage(list, 'dk', [{ ...cutOf('Spell 5', 'k:later'), add: { id: 'Spell 9', name: 'Spell 9', cmc: 2, manaCost: '', typeLine: '', image: null, quantity: 1 } }]);
    tune.undoApply(list, done.undo);
    const cards = db.cardsInList(list.id);
    expect(cards.find((c) => c.card.name === 'Mahadi, Emporium Master')?.board).toBe('maybe');
    expect(cards.find((c) => c.card.name === 'Spell 0')?.board).toBe('main');
    expect(cards.find((c) => c.card.name === 'Swamp')?.quantity).toBe(37);
    const store = (await import('./tune-store')).tuneStore(list.id);
    expect(store.changes.cut.map((c) => c.from)).toEqual(['k:later']);
    expect(store.cutReasons['Spell 0']).toBeUndefined();
  });

  it('cuts one copy of a basic by lowering the count', async () => {
    const { db, list } = await deck(63);
    db.setQuantity(list.id, 'Swamp', 39);
    const tune = await import('./tune');
    await tune.stage(list, 'dk', [cutOf('Swamp')]);
    await tune.applyChanges(list);
    const swamps = db.cardsInList(list.id).filter((c) => c.card.name === 'Swamp');
    expect(swamps).toHaveLength(1);
    expect(swamps[0]).toMatchObject({ board: 'main', quantity: 38 });
  });
});

describe('the state', { timeout: 30_000 }, () => {
  it('suggests Cuts a little over 100 and badges what to cut', async () => {
    const { list } = await deck(65);
    const tune = await import('./tune');
    const s = await tune.tuneState(list, 'dk');
    expect(s.suggested).toBe('cuts');
    expect(s.badges.cuts).toBe('3');
    expect(s.impact.size).toEqual({ before: 103, after: 103 });
  });
});

describe('Claude\'s ideas', () => {
  it('keeps only cards that exist: cuts in the deck, adds legal and in the colours', async () => {
    const { parseIdeas } = await import('./tune-claude');
    const main = [card('Spell 1'), card('Spell 2')];
    const pool = [card('Rakdos Charm', { color_identity: ['B', 'R'] }), card('Swords to Plowshares', { color_identity: ['W'] }), card('Dockside Extortionist', { color_identity: ['R'], legalities: { commander: 'banned' } })];
    const find = (names: string[]) => pool.filter((c) => names.includes(c.name));
    const items = parseIdeas({ ideas: [
      { add: 'Rakdos Charm', cut: 'Spell 1', why: 'Instant and flexible.' },
      { add: 'Swords to Plowshares', why: 'Off colour.' },
      { add: 'Dockside Extortionist', why: 'Banned.' },
      { cut: 'Black Lotus', why: 'Not in the deck.' },
      { cut: 'Spell 2', keep: true, why: 'The deck needs it.', breaks: '' },
      { cut: 'Spell 2', why: 'Off the plan, but cheap.', breaks: 'Never cut lands' },
    ] }, main, new Set(['B', 'R']), find);
    expect(items.map((i) => [i.add?.name ?? null, i.cut?.name ?? null, !!i.keep])).toEqual([
      ['Rakdos Charm', 'Spell 1', false],
      [null, 'Spell 2', true],
      [null, 'Spell 2', false],
    ]);
    expect(items[2].breaks).toBe('Never cut lands');
  });
});

describe('Claude finishing the deck', { timeout: 30_000 }, () => {
  const pool = [
    card('Rakdos Charm', { color_identity: ['B', 'R'] }),
    card('Swords to Plowshares', { color_identity: ['W'] }),
    card('Dockside Extortionist', { color_identity: ['R'], legalities: { commander: 'banned' } }),
    card('Mountain', { type_line: 'Basic Land — Mountain', cmc: 0, color_identity: [], produced_mana: ['R'] }),
    card('Spell 3'),
  ];
  const answer = { groups: [
    { group: 'lands', cards: [{ name: 'Mountain', count: 5, why: 'Red sources.' }] },
    { group: 'interaction', cards: [{ name: 'Rakdos Charm', why: 'Instant and flexible.' }, { name: 'Swords to Plowshares', why: 'Off colour.' }, { name: 'Dockside Extortionist', why: 'Banned.' }, { name: 'Spell 3', why: 'Already in the deck.' }] },
    { group: 'nonsense', cards: [{ name: 'Rakdos Charm', why: 'x' }] },
  ] };

  it('keeps picks to what the rules allow, in the same groups, never past the room', async () => {
    const { parseFinish } = await import('./tune-claude');
    const ok = new Map([['mountain', pool[3]], ['rakdos charm', pool[0]]]);
    const item = (key: string, c: ScryfallCard, why: string, count: number): Suggestion => ({ key, add: { id: c.id, name: c.name, cmc: 0, manaCost: '', typeLine: '', image: null, quantity: count }, why });
    const groups = parseFinish(answer, 4, () => ok, item, 'Sonnet');
    expect(groups.map((g) => g.title)).toEqual(['✦ Lands · 4']);
    expect(groups[0].items[0].add?.quantity).toBe(4);
    const roomy = parseFinish(answer, 20, () => ok, item, 'Sonnet');
    expect(roomy.map((g) => [g.title, g.items.map((i) => i.add?.name)])).toEqual([['✦ Lands · 5', ['Mountain']], ['✦ Interaction · 1', ['Rakdos Charm']]]);
    expect(roomy[1].items[0].why).toBe('Instant and flexible.');
  });

  it('remembers the choice per deck, and shows the rules’ picks beside Claude’s only when asked', async () => {
    vi.doMock('./card-store', async (orig) => ({ ...(await orig<typeof import('./card-store')>()), localCards: (names: string[]) => pool.filter((c) => names.includes(c.name)), allLocalCards: () => pool }));
    const { list } = await deck(40);
    const { finishPicks } = await import('./tune-claude');
    const tune = await import('./tune');
    const store = await import('./tune-store');
    // A fake model: no network, no spend.
    const model = vi.fn(async () => ({ data: answer, model: 'fake' }));
    const groups = await finishPicks(model as never, list, 'dk', '');
    expect(model).toHaveBeenCalledTimes(1);
    expect(groups.flatMap((g) => g.items.map((i) => i.add?.name))).toEqual(['Mountain', 'Rakdos Charm']);
    expect(store.tuneStore(list.id).finishPicks).toBe('claude');
    const s = await tune.tuneState(list, 'dk', { intent: 'finish' });
    expect(s.finish).toEqual({ picks: 'claude', showRules: false, claudeReady: true, claudeEmpty: false });
    expect(s.groups.every((g) => g.source === 'claude')).toBe(true);
    store.updateTune(list.id, (x) => { x.finishShowRules = true; });
    expect((await tune.tuneState(list, 'dk', { intent: 'finish' })).finish?.showRules).toBe(true);
    store.updateTune(list.id, (x) => { x.finishPicks = 'rules'; });
    const rules = await tune.tuneState(list, 'dk', { intent: 'finish' });
    expect(rules.groups.some((g) => g.source === 'claude')).toBe(false);
    vi.doUnmock('./card-store');
  });
});

describe('fixing a problem', () => {
  it('maps each problem to the job it needs and the cards it must not cut', async () => {
    const { FIX_PLAN } = await import('./tune');
    expect(FIX_PLAN.gas.job).toBe('draw');
    expect(FIX_PLAN.late).toMatchObject({ job: 'ramp', avoid: ['ramp'] });
    expect(FIX_PLAN.close.job).toBe('finishers');
    expect(FIX_PLAN.wiped.avoid).toContain('protection');
    expect(FIX_PLAN.mana.job).toBe('lands');
  });
});

describe('lands', { timeout: 30_000 }, () => {
  it('adds the basics a short deck needs, to the colour its spells ask for most', async () => {
    const db = await import('./db');
    const plan = await import('./deck-plan');
    const list = db.createList('dk', 'Prosper', '', { kind: 'deck', commander });
    db.addCardToList(list.id, swamp, 15);
    db.addCardToList(list.id, card('Mountain', { type_line: 'Basic Land — Mountain', cmc: 0, produced_mana: ['R'] }), 15);
    for (let i = 0; i < 62; i++) db.addCardToList(list.id, card(`Black ${i}`, { mana_cost: '{1}{B}{B}', cmc: 3, color_identity: ['B'] }));
    plan.changePlan(list.id, { confirm: true });
    const tune = await import('./tune');
    const s = await tune.tuneState(db.getList(list.id, 'dk')!, 'dk', { intent: 'lands' });
    const items = s.groups[0].items;
    const total = items.reduce((n, i) => n + (i.add?.quantity ?? 0), 0);
    expect(total).toBe(Math.ceil(s.lands!.range[0] - s.lands!.have));
    expect(items[0].add?.name).toBe('Swamp');
    // Seven under the low end: far enough under for a badge.
    expect(s.badges.lands).toMatch(/under/);
  });
});

describe('the Swaps tab and the cut guards', { timeout: 30_000 }, () => {
  it('opens for a five-colour deck: a same-job lookup, no upgrades, nothing ranked', async () => {
    const db = await import('./db');
    const plan = await import('./deck-plan');
    const five = card('Five Leader', { type_line: 'Legendary Creature — Human', cmc: 5, color_identity: ['W', 'U', 'B', 'R', 'G'] });
    const list = db.createList('dk', 'El Daddy', '', { kind: 'deck', commander: five });
    db.addCardToList(list.id, swamp, 37);
    for (let i = 0; i < 62; i++) db.addCardToList(list.id, card(`Spell ${i}`));
    db.addCardToList(list.id, card('Waiting Rock'), 1, 'nonfoil', 'maybe');
    plan.changePlan(list.id, { confirm: true });
    const tune = await import('./tune');
    const s = await tune.tuneState(db.getList(list.id, 'dk')!, 'dk', { intent: 'swaps' });
    expect(s.groups.some((g) => g.key === 'swaps:upgrades')).toBe(false);
    expect(JSON.stringify(s.groups)).not.toMatch(/upgrade|better/i);
    for (const intent of ['cuts', 'find', 'lands'] as const) await expect(tune.tuneState(db.getList(list.id, 'dk')!, 'dk', { intent })).resolves.toBeTruthy();
  });

  it('never stages a cut of a never-cut card, or a land under the floor', async () => {
    const { db, list } = await deck(70);
    // 33 lands against the formula's 37: at the far-under line, so no land may go.
    db.setQuantity(list.id, 'Swamp', 33);
    const roles = await import('./deck-roles');
    roles.setKeep(list.id, 'o-Spell 1', true);
    const tune = await import('./tune');
    const done = await tune.stage(list, 'dk', [cutOf('Spell 1'), cutOf('Swamp'), cutOf('Spell 2')]);
    expect(done).toMatchObject({ staged: 1, blocked: 2 });
    const { tuneStore } = await import('./tune-store');
    expect(tuneStore(list.id).changes.cut.map((c) => c.card.name)).toEqual(['Spell 2']);
    void db;
  });

  it('lets a land go from a deliberately low deck, unless the owner’s own range says no', async () => {
    const { db, list } = await deck(70);
    db.setQuantity(list.id, 'Swamp', 35);
    const tune = await import('./tune');
    // The formula wants 37: 35 is low but not far under, so a land may go.
    expect(await tune.stage(list, 'dk', [cutOf('Swamp')])).toMatchObject({ staged: 1, blocked: 0 });
    const plan = await import('./deck-plan');
    const store = await import('./tune-store');
    store.updateTune(list.id, (s) => { s.changes = { add: [], cut: [] }; });
    // The owner's own range is theirs: at 35–36, none may go.
    plan.changePlan(list.id, { targets: { lands: [35, 36] } });
    expect(await tune.stage(list, 'dk', [cutOf('Swamp')])).toMatchObject({ staged: 0, blocked: 1 });
  });

  it('clamps Claude’s review to the count, and drops never-cut cards and lands', async () => {
    const { db, list } = await deck(68);
    db.setQuantity(list.id, 'Swamp', 33); // 102: two to cut, lands at the far-under line
    const roles = await import('./deck-roles');
    roles.setKeep(list.id, 'o-Spell 5', true);
    const review = await import('./cut-review');
    review.saveReview(list.id, { at: new Date().toISOString(), model: 'fake', instructions: '', over: 2, mode: 'top', items: [
      { name: 'Spell 5', verdict: 'cut', why: 'kept by the owner' },
      { name: 'Swamp', verdict: 'cut', why: 'too many lands' },
      { name: 'Spell 1', verdict: 'cut', why: 'a' },
      { name: 'Spell 2', verdict: 'cut', why: 'b' },
      { name: 'Spell 3', verdict: 'cut', why: 'c' },
    ] });
    const tune = await import('./tune');
    const s = await tune.tuneState(list, 'dk', { intent: 'cuts' });
    const claude = s.groups.find((g) => g.key === 'cuts:claude')!;
    const sure = claude.items.filter((i) => !i.warn).map((i) => i.cut!.name);
    expect(sure).toEqual(['Spell 1', 'Spell 2']);
    expect(claude.items.find((i) => i.cut!.name === 'Spell 3')?.warn).toMatch(/past the 2/);
    expect(claude.items.some((i) => i.cut!.name === 'Spell 5' || i.cut!.name === 'Swamp')).toBe(false);
  });
});
