/**
 * Finish with cards to buy (handoff 10, Part C) with a stand-in Claude: "the
 * ones that matter" checks the essentials, takes owned ones free and ones to
 * buy up to the total, and the search fills the rest around them; "any card"
 * on a profile with no collection names a list instead of stopping.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type Anthropic from '@anthropic-ai/sdk';
import { Database } from 'node-sqlite3-wasm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClaudeParams } from './ai-claude';
import type { ScryfallCard } from './scryfall';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-finish-buy-'));
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
  ({ id: name, oracle_id: `o-${name}`, name, type_line: 'Instant', cmc: 2, mana_cost: '{1}{B}', oracle_text: `${name} draws a card.`, color_identity: ['B'], legalities: { commander: 'legal' }, prices: { usd: '1.00' }, layout: 'normal', ...over }) as ScryfallCard;
const commander = card('The Ghoul', { type_line: 'Legendary Creature — Zombie', cmc: 3, mana_cost: '{2}{B}' });

async function setup(opts: { boxed?: ScryfallCard[]; data?: ScryfallCard[] } = {}) {
  const db = await import('./db');
  const col = await import('./collection');
  const store = await import('./card-store');
  store.localCards(['nothing yet']);
  const cdb = new Database(join(dir, 'cards.db'));
  for (const c of opts.data ?? []) cdb.run('INSERT INTO oracle_cards (oracleId, name, nameKey, data) VALUES (?, ?, ?, ?)', [c.oracle_id!, c.name, c.name.toLowerCase(), JSON.stringify(c)]);
  cdb.close();
  db.addProfile('dk', 'DK');
  const list = db.createList('dk', 'Ghoul', '', { kind: 'deck', commander });
  for (let i = 1; i <= 5; i++) db.addCardToList(list.id, card(`Deck Spell ${i}`));
  for (const c of opts.boxed ?? []) col.addToCollection('dk', c, 1);
  const { ROLES_VERSION } = await import('./roles');
  const ids = [...(opts.boxed ?? []), ...(opts.data ?? []), commander, ...Array.from({ length: 5 }, (_, i) => card(`Deck Spell ${i + 1}`))].map((c) => c.oracle_id!);
  db.saveRoles(new Map([...new Set(ids)].map((id) => [id, []] as [string, string[]])), ROLES_VERSION);
  return { db, list: db.getList(list.id, 'dk')! };
}

type Turn = { name?: string; input: unknown };
function stand(turns: Turn[]) {
  const asked: Array<{ params: ClaudeParams; step: string }> = [];
  let k = 0;
  const call = async (params: ClaudeParams, step: string) => {
    asked.push({ params: structuredClone(params), step });
    const t = turns[Math.min(k++, turns.length - 1)];
    const uses = Array.isArray(t.input) ? (t.input as string[]).map((q, j) => ({ type: 'tool_use', id: `s${k}-${j}`, name: 'search', input: { query: q } })) : [{ type: 'tool_use', id: `t${k}`, name: t.name, input: t.input }];
    return { content: uses, stop_reason: 'tool_use', model: 'claude-opus-5-5', usage: {} } as unknown as Anthropic.Beta.BetaMessage;
  };
  return { call, asked };
}
const named = (names: string[]) => ({ name: 'give_cards', input: { cards: names.map((name) => ({ name, group: 'theme', theme: 'Aristocrats', why: `${name} matters.` })), reply: 'Built around the drain.' } });
const picks = (names: string[]) => ({ name: 'give_picks', input: { groups: [{ group: 'draw', cards: names.map((name) => ({ name, why: 'fits' })) }], reply: 'Filled from your cards.' } });

describe('cards to buy', { timeout: 180_000 }, () => {
  it('"the ones that matter": essentials are checked, owned ones are free, to-buy ones stop at the total, the search fill counts them as in the deck', async () => {
    const owned = [card('Blood Artist'), card('Owned Filler 1'), card('Owned Filler 2'), card('Owned Filler 3')];
    const shop = [card('Zulaport Cutthroat', { prices: { usd: '2.00' } }), card('Pitiless Plunderer', { prices: { usd: '3.00' } }), card('Teysa Karlov', { prices: { usd: '4.00' } }), card('Red Card', { color_identity: ['R'] })];
    const { list } = await setup({ boxed: owned, data: shop });
    const f = await import('./finish');
    f.setFinish(list.id, { buy: 'matter', spend: 5, want: 6 });
    const st = stand([named(['Blood Artist', 'Zulaport Cutthroat', 'Pitiless Plunderer', 'Teysa Karlov', 'Red Card']), { input: ['filler'] }, picks(['Owned Filler 1', 'Owned Filler 2', 'Owned Filler 3'])]);
    await f.runFinish(st.call, 'claude-opus-5-5', list, 'dk');
    const v = await f.finishView(list, 'dk');
    const items = v.run!.items.map((i) => [i.name, i.src, i.price ?? undefined]);
    expect(items).toEqual([
      ['Blood Artist', 'spare', undefined],
      ['Zulaport Cutthroat', 'buy', 2],
      ['Pitiless Plunderer', 'buy', 3],
      ['Owned Filler 1', 'spare', undefined], ['Owned Filler 2', 'spare', undefined], ['Owned Filler 3', 'spare', undefined],
    ]);
    // $5 in all: Teysa ($4) is over the limit, listed with its price; the off-colour name is dropped with why.
    expect(v.run!.buy!.over).toEqual([{ name: 'Teysa Karlov', price: 4 }]);
    expect(v.run!.buy!.dropped.map((d) => d.name)).toEqual(['Red Card']);
    // The essentials call ran first, and the search was told they're already chosen, with only the rest to pick.
    expect(st.asked[0].step).toBe('essentials: the ones that matter');
    const task = JSON.stringify(st.asked[1].params.messages);
    expect(task).toMatch(/Already chosen[^"]*Blood Artist; Zulaport Cutthroat; Pitiless Plunderer/);
    expect(task).toMatch(/Pick exactly 3 non-land cards/);
    // Apply: the cards to buy go into the main deck, and the done screen has the buy list.
    const done = await f.applyFinish(list, 'dk');
    expect(done.buy).toEqual([{ name: 'Zulaport Cutthroat', price: 2 }, { name: 'Pitiless Plunderer', price: 3 }]);
    const db = await import('./db');
    expect(db.cardsInList(list.id).filter((c) => c.board === 'main').map((c) => c.card.name)).toEqual(expect.arrayContaining(['Zulaport Cutthroat', 'Pitiless Plunderer', 'Blood Artist']));
  });

  it('"any card" on a profile with no collection returns a list, not "none of your cards"', async () => {
    const shop = [card('Shop One'), card('Shop Two', { prices: {} as ScryfallCard['prices'] }), card('Shop Three')];
    const { list } = await setup({ data: shop });
    const f = await import('./finish');
    f.setFinish(list.id, { want: 3 });
    expect((await f.finishView(list, 'dk')).noCollection).toBe(true);
    const st = stand([named(['Shop One', 'Shop Two', 'Shop Three'])]);
    await f.runFinish(st.call, 'claude-opus-5-5', list, 'dk');
    const v = await f.finishView(list, 'dk');
    expect(v.run!.items.map((i) => [i.name, i.src, i.price])).toEqual([['Shop One', 'buy', 1], ['Shop Two', 'buy', null], ['Shop Three', 'buy', 1]]);
    expect(v.run!.buy!.kind).toBe('any');
    // One call: no search.
    expect(st.asked.map((a) => a.step)).toEqual(['essentials: any card']);
  });
});

describe('review PR56: Finish with cards to buy', { timeout: 180_000 }, () => {
  const gc = (name: string) => card(name, { game_changer: true });
  const roles = async (db: typeof import('./db'), names: string[]) => { const { ROLES_VERSION } = await import('./roles'); db.saveRoles(new Map(names.map((n) => [`o-${n}`, []] as [string, string[]])), ROLES_VERSION); };

  it('2: the bracket is counted across the named cards and the searched picks together', async () => {
    const owned = [gc('Owned GC'), card('Owned Plain')];
    const { db, list } = await setup({ boxed: owned, data: [gc('Shop GC 1'), gc('Shop GC 2')] });
    const plan = await import('./deck-plan');
    plan.changePlan(list.id, { bracket: 3 });
    db.addCardToList(list.id, gc('Deck GC A'));
    db.addCardToList(list.id, gc('Deck GC B'));
    await roles(db, ['Deck GC A', 'Deck GC B']);
    const f = await import('./finish');
    f.setFinish(list.id, { buy: 'matter', want: 4 });
    // One Game Changer of room: the first named one takes it; the second named one and the searched one are refused.
    await f.runFinish(stand([named(['Shop GC 1', 'Shop GC 2']), { input: ['owned'] }, picks(['Owned GC', 'Owned Plain'])]).call, 'claude-opus-5-5', db.getList(list.id, 'dk')!, 'dk');
    const v = await f.finishView(db.getList(list.id, 'dk')!, 'dk');
    expect(v.run!.items.map((i) => i.name)).toEqual(['Shop GC 1', 'Owned Plain']);
    expect(v.run!.buy!.dropped.find((d) => d.name === 'Shop GC 2')?.why).toMatch(/bracket 3/);
  });

  it('5: with a total set, a card to buy with no price is listed as over (no price), not taken', async () => {
    const { list } = await setup({ data: [card('Priced', { prices: { usd: '1.00' } }), card('Unpriced', { prices: {} as ScryfallCard['prices'] })] });
    const f = await import('./finish');
    f.setFinish(list.id, { buy: 'any', spend: 0, want: 2 });
    await expect(f.runFinish(stand([named(['Unpriced', 'Priced'])]).call, 'claude-opus-5-5', list, 'dk')).rejects.toThrow('over your $0 total or had no price: Unpriced (no price); Priced ($1.00)');
    f.setFinish(list.id, { spend: 5 });
    await f.runFinish(stand([named(['Unpriced', 'Priced'])]).call, 'claude-opus-5-5', list, 'dk');
    const v = await f.finishView(list, 'dk');
    expect(v.run!.items.map((i) => i.name)).toEqual(['Priced']);
    expect(v.run!.buy!.over).toEqual([{ name: 'Unpriced', price: null }]);
    const { withinTotal } = await import('./essentials');
    const b = (price: number | null) => ({ own: { kind: 'buy' as const, price } });
    expect(withinTotal([b(null), b(2)], 5)).toEqual({ taken: [b(2)], over: [b(null)] });
    expect(withinTotal([b(null)], null)).toEqual({ taken: [b(null)], over: [] });
  });

  it('10: on a later round a kept pick that left the owner\'s cards opens its slot again', async () => {
    const owned = [card('Owned A'), card('Owned B'), card('Owned C')];
    const { db, list } = await setup({ boxed: owned });
    const f = await import('./finish');
    f.setFinish(list.id, { want: 2 });
    await f.runFinish(stand([{ input: ['owned'] }, picks(['Owned A', 'Owned B'])]).call, 'claude-opus-5-5', list, 'dk');
    // Owned A goes into the deck by hand: no longer on offer, so the next round refills its slot.
    db.addCardToList(list.id, owned[0]);
    f.setChoices(list.id, { 'Owned B': { choice: 'add', text: 'good' } });
    const st = stand([{ input: ['owned'] }, picks(['Owned C'])]);
    await f.runFinish(st.call, 'claude-opus-5-5', db.getList(list.id, 'dk')!, 'dk', { rerun: true, message: 'more draw' });
    expect(f.finishStore(list.id).run!.items.map((i) => i.name)).toEqual(['Owned B', 'Owned C']);
  });

  it('11: "the ones that matter" with none of the owner\'s cards on offer runs as any card', async () => {
    const { buyModeFor } = await import('./finish');
    const pool = (lines: number, any: number) => ({ lines: Array.from({ length: lines }) as never[], counts: { held: 0, fit: 0, spare: 0, any, otherOnly: 0 } });
    expect(buyModeFor('matter', false, pool(0, 5))).toBe('any');
    expect(buyModeFor('none', false, pool(0, 0))).toBe('any');
    expect(buyModeFor('none', false, pool(0, 5))).toBe('none');
    expect(buyModeFor('matter', false, pool(3, 3))).toBe('matter');
    // 14: "only cards I own" turns buying off.
    expect(buyModeFor('matter', true, pool(3, 3))).toBe('none');
    expect(buyModeFor('any', true, pool(0, 0))).toBe('none');
  });

  it('12: "Add anyway" brings back a card that was over the total, as one to buy, with no paid round', async () => {
    const { list } = await setup({ data: [card('Cheap', { prices: { usd: '1.00' } }), card('Dear', { prices: { usd: '30.00' } })] });
    const f = await import('./finish');
    f.setFinish(list.id, { buy: 'any', spend: 5, want: 2 });
    await f.runFinish(stand([named(['Dear', 'Cheap'])]).call, 'claude-opus-5-5', list, 'dk');
    expect((await f.finishView(list, 'dk')).run!.buy!.over).toEqual([{ name: 'Dear', price: 30 }]);
    await f.takeOver(list, 'dk', 'Dear');
    const v = await f.finishView(list, 'dk');
    expect(v.run!.items.map((i) => [i.name, i.src, i.price])).toEqual([['Cheap', 'buy', 1], ['Dear', 'buy', 30]]);
    expect(v.run!.buy!.over).toEqual([]);
  });

  it('13: "any card" with every pick on Add and a message asks Claude, which can take a kept card out and replace it', async () => {
    const { list } = await setup({ data: ['One', 'Two', 'Three'].map((n) => card(n)) });
    const f = await import('./finish');
    f.setFinish(list.id, { buy: 'any', want: 2 });
    await f.runFinish(stand([named(['One', 'Two'])]).call, 'claude-opus-5-5', list, 'dk');
    const st = stand([{ name: 'give_cards', input: { cards: [{ name: 'Three', group: 'draw', why: 'better' }], reply: 'Swapped Two for Three.', out: ['Two'] } }]);
    await f.runFinish(st.call, 'claude-opus-5-5', list, 'dk', { rerun: true, message: 'Two is too slow' });
    expect(JSON.stringify(st.asked[0].params.messages)).toMatch(/Two is too slow/);
    const run = f.finishStore(list.id).run!;
    expect(run.items.map((i) => i.name)).toEqual(['One', 'Three']);
    expect(run.changes!.out).toEqual([{ name: 'Two', because: 'message' }]);
  });

  it('14: the view says buying is off when the plan says only cards I own', async () => {
    const { list } = await setup({ boxed: [card('Mine')] });
    const plan = await import('./deck-plan');
    plan.changePlan(list.id, { own: true });
    const f = await import('./finish');
    f.setFinish(list.id, { buy: 'matter' });
    const v = await f.finishView(list, 'dk');
    expect(v.ownOnly).toBe(true);
    expect(v.noCollection).toBe(false);
  });
});

describe('review PR56, 9: one cut pairs with one add', { timeout: 120_000 }, () => {
  it('staging refuses a second swap on a card already staged to go out', async () => {
    const { db, list } = await setup({ data: [card('In One'), card('In Two')] });
    const plan = await import('./deck-plan');
    plan.changePlan(list.id, { confirm: true });
    const tune = await import('./tune');
    const ref = (c: ScryfallCard) => ({ id: c.id, name: c.name, cmc: 2, manaCost: '', typeLine: '', image: null, quantity: 1 });
    const out = db.cardsInList(list.id).find((c) => c.card.name === 'Deck Spell 1')!.card;
    const r1 = await tune.stage(list, 'dk', [{ key: 'a', add: ref(card('In One')), cut: ref(out), why: '' }]);
    const r2 = await tune.stage(list, 'dk', [{ key: 'b', add: ref(card('In Two')), cut: ref(out), why: '' }]);
    expect([r1.staged, r2.staged, r2.blocked]).toEqual([1, 0, 1]);
  });
});
