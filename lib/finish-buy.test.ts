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
