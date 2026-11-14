/**
 * Upgrades (handoff 10, Part A) with a stand-in Claude (no paid call): the
 * app's checks on every name, ownership from the app, prices, the card it
 * replaces, what a swap does to the job counts, later rounds and "Not for
 * me", apply with an exact undo. Each test has its own database.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type Anthropic from '@anthropic-ai/sdk';
import { Database } from 'node-sqlite3-wasm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClaudeParams } from './ai-claude';
import type { ScryfallCard } from './scryfall';
import { buyListText, buyTotal } from './upgrades-shared';
import { suggestedIntent } from './tune-shared';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-upgrades-'));
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
const commander = card('The Ghoul', { type_line: 'Legendary Creature — Zombie', cmc: 3, mana_cost: '{2}{B}', oracle_text: 'Whenever a creature dies, make a Treasure.' });
const swamp = card('Swamp', { type_line: 'Basic Land — Swamp', cmc: 0, mana_cost: '', oracle_text: '', color_identity: [] });

/** The Ghoul's deck: the commander, 5 Swamps and 10 spells; another deck; the owner's boxes; cards in the card data. */
async function setup(opts: { boxed?: ScryfallCard[]; other?: ScryfallCard[]; data?: ScryfallCard[] } = {}) {
  const db = await import('./db');
  const col = await import('./collection');
  const store = await import('./card-store');
  store.localCards(['nothing yet']);
  const cdb = new Database(join(dir, 'cards.db'));
  for (const c of opts.data ?? []) cdb.run('INSERT INTO oracle_cards (oracleId, name, nameKey, data) VALUES (?, ?, ?, ?)', [c.oracle_id!, c.name, c.name.toLowerCase(), JSON.stringify(c)]);
  cdb.close();
  db.addProfile('dk', 'DK');
  const list = db.createList('dk', 'War Never Changes', '', { kind: 'deck', commander });
  db.addCardToList(list.id, swamp, 5);
  for (let i = 1; i <= 10; i++) db.addCardToList(list.id, card(`Deck Spell ${i}`));
  const second = db.createList('dk', 'Treasures!', '', { kind: 'deck', commander: card('Other', { type_line: 'Legendary Creature' }) });
  for (const c of opts.other ?? []) db.addCardToList(second.id, c);
  for (const c of opts.boxed ?? []) col.addToCollection('dk', c, 1);
  const { ROLES_VERSION } = await import('./roles');
  const ids = (db.database().all('SELECT data FROM cards') as Array<{ data: string }>).map((r) => (JSON.parse(r.data) as ScryfallCard).oracle_id!).filter(Boolean);
  db.saveRoles(new Map([...new Set([...ids, commander.oracle_id!, ...(opts.data ?? []).map((c) => c.oracle_id!)])].map((id) => [id, []] as [string, string[]])), ROLES_VERSION);
  return { db, list: db.getList(list.id, 'dk')!, second };
}

type Turn = { search?: string[]; give?: unknown };
function stand(turns: Turn[]) {
  const asked: ClaudeParams[] = [];
  let k = 0;
  let id = 0;
  const call = async (params: ClaudeParams) => {
    asked.push(structuredClone(params));
    const t = turns[Math.min(k++, turns.length - 1)];
    const content = t.give
      ? [{ type: 'tool_use', id: `t${id++}`, name: 'give_upgrades', input: t.give }]
      : (t.search ?? []).map((q) => ({ type: 'tool_use', id: `t${id++}`, name: 'search', input: { query: q } }));
    return { content, stop_reason: 'tool_use', model: 'claude-opus-5-5', usage: {} } as unknown as Anthropic.Beta.BetaMessage;
  };
  return { call, asked };
}
const s = (name: string, replaces: string, source: 'mine' | 'buy' = 'buy') => ({ name, job: 'ramp', why: `${name} is better.`, replaces, replaces_why: 'the weakest', source });
const give = (suggestions: unknown[]) => ({ read: 'The engine is fine; short of ways to win.', suggestions });

describe('the step the deck size points to', () => {
  it('100 gives upgrades, 99 gives finish, 101 gives cuts', () => {
    expect(suggestedIntent(100, 0)).toBe('upgrades');
    expect(suggestedIntent(99, 0)).toBe('finish');
    expect(suggestedIntent(40, 0)).toBe('finish');
    expect(suggestedIntent(101, 0)).toBe('cuts');
  });
});

describe('the buy list', () => {
  it('sums the prices, leaving a card with no price out of the total and saying so', () => {
    const rows = [{ name: 'A', price: 1.25 }, { name: 'B', price: null }, { name: 'C', price: 10 }];
    expect(buyTotal(rows)).toEqual({ total: 11.25, priced: 2, unpriced: 1 });
    expect(buyListText(rows)).toBe('1 A $1.25\n1 B (no price)\n1 C $10.00\nTotal: $11.25 (1 with no price not counted)');
  });
});

describe('Upgrades\' checks', { timeout: 180_000 }, () => {
  it('drops and counts an off-colour name, a card over the budget, a name that isn\'t a card; no price is "no price", not free', async () => {
    const red = card('Red Ramp', { color_identity: ['R'] });
    const dear = card('Dear Ramp', { prices: { usd: '40.00' } });
    const free = card('Unpriced Ramp', { prices: {} as ScryfallCard['prices'] });
    const good = card('Good Ramp', { prices: { usd: '2.50' } });
    const { list } = await setup({ data: [red, dear, free, good] });
    const { runUpgrades, upgradesView } = await import('./upgrades');
    const { call } = stand([{ give: give([s('Red Ramp', 'Deck Spell 1'), s('Dear Ramp', 'Deck Spell 2'), s('Unpriced Ramp', 'Deck Spell 3'), s('Good Ramp', 'Deck Spell 4'), s('Made Up Card', 'Deck Spell 5')]) }]);
    await runUpgrades(call, 'claude-opus-5-5', list, 'dk');
    let v = await upgradesView(list, 'dk');
    expect(v.run!.items.map((i) => i.name)).toEqual(['Dear Ramp', 'Unpriced Ramp', 'Good Ramp']);
    expect(v.run!.items.find((i) => i.name === 'Unpriced Ramp')!.own).toEqual({ kind: 'buy', price: null });
    expect(v.run!.items.find((i) => i.name === 'Good Ramp')!.own).toEqual({ kind: 'buy', price: 2.5 });
    expect(v.run!.dropped.map((d) => d.name)).toEqual(['Red Ramp', 'Made Up Card']);
    expect(v.run!.dropped[0].why).toMatch(/outside this deck's colours/);
    // With a $5 budget a card: the dear one and the one with no price are left out, with why.
    const plan = await import('./deck-plan');
    plan.changePlan(list.id, { budget: 5 });
    const { resetUpgrades } = await import('./upgrades');
    resetUpgrades(list.id);
    await runUpgrades(stand([{ give: give([s('Dear Ramp', 'Deck Spell 2'), s('Unpriced Ramp', 'Deck Spell 3'), s('Good Ramp', 'Deck Spell 4')]) }]).call, 'claude-opus-5-5', list, 'dk');
    v = await upgradesView(list, 'dk');
    expect(v.run!.items.map((i) => i.name)).toEqual(['Good Ramp']);
    expect(v.run!.dropped.map((d) => [d.name, /budget/.test(d.why)])).toEqual([['Dear Ramp', true], ['Unpriced Ramp', true]]);
    expect(v.run!.dropped[1].why).toMatch(/no price/);
  });

  it('a card Claude called one to buy that the owner holds is shown as owned, with where', async () => {
    const boxed = card('Syr Konrad, the Grim', { prices: { usd: '0.50' } });
    const inOther = card('Black Market Connections', { prices: { usd: '14.70' } });
    const { list } = await setup({ boxed: [boxed], other: [inOther] });
    const { runUpgrades, upgradesView } = await import('./upgrades');
    await runUpgrades(stand([{ give: give([s('Syr Konrad, the Grim', 'Deck Spell 1', 'buy'), s('Black Market Connections', 'Deck Spell 2', 'buy')]) }]).call, 'claude-opus-5-5', list, 'dk');
    const v = await upgradesView(list, 'dk');
    expect(v.run!.items.map((i) => [i.name, i.own, i.wasBuy])).toEqual([
      ['Syr Konrad, the Grim', { kind: 'spare' }, true],
      ['Black Market Connections', { kind: 'deck', deck: 'Treasures!' }, true],
    ]);
  });

  it('a replaced card that is the commander or never cut turns the row into an add', async () => {
    const a = card('Upgrade A');
    const b = card('Upgrade B');
    const c = card('Upgrade C');
    const { list } = await setup({ data: [a, b, c] });
    const roles = await import('./deck-roles');
    roles.setKeep(list.id, 'o-Deck Spell 3', true);
    const { runUpgrades, upgradesView } = await import('./upgrades');
    await runUpgrades(stand([{ give: give([s('Upgrade A', 'The Ghoul'), s('Upgrade B', 'Deck Spell 3'), s('Upgrade C', 'Deck Spell 1')]) }]).call, 'claude-opus-5-5', list, 'dk');
    const v = await upgradesView(list, 'dk');
    const by = (n: string) => v.run!.items.find((i) => i.name === n)!;
    expect(by('Upgrade A').out).toBeNull();
    expect(by('Upgrade A').outNote).toMatch(/commander/);
    expect(by('Upgrade B').out).toBeNull();
    expect(by('Upgrade B').outNote).toMatch(/never cut/);
    expect(by('Upgrade C').out!.name).toBe('Deck Spell 1');
  });

  it('only the owner\'s cards: "from my cards" drops a card to buy, and the plan\'s "only cards I own" forces it', async () => {
    const mine = card('My Ramp');
    const theirs = card('Shop Ramp');
    const { list } = await setup({ boxed: [mine], data: [theirs] });
    const plan = await import('./deck-plan');
    plan.changePlan(list.id, { own: true });
    const { runUpgrades, upgradesView } = await import('./upgrades');
    const st = stand([{ search: ['ramp'] }, { give: give([s('My Ramp', 'Deck Spell 1', 'mine'), s('Shop Ramp', 'Deck Spell 2')]) }]);
    await runUpgrades(st.call, 'claude-opus-5-5', list, 'dk');
    const v = await upgradesView(list, 'dk');
    expect(v.sources).toBe('mine');
    expect(v.ownOnly).toBe(true);
    expect(v.run!.items.map((i) => i.name)).toEqual(['My Ramp']);
    expect(JSON.stringify(st.asked[0].messages)).toMatch(/the plan says only cards they own/);
    // The search ran over the owner's cards.
    expect(JSON.stringify(st.asked[1].messages)).toMatch(/My Ramp/);
  });

  it('sends the deck with rules text and the "not for me" list; searches are counted and refused past the limit', async () => {
    const mine = Array.from({ length: 12 }, (_, i) => card(`Owned ${i + 1}`));
    const { list } = await setup({ boxed: mine });
    const { runUpgrades, UPGRADES_SYSTEM } = await import('./upgrades');
    const { UPGRADE_SEARCHES } = await import('./upgrades-shared');
    const st = stand([...Array.from({ length: UPGRADE_SEARCHES + 1 }, () => ({ search: ['draws'] })), { give: give([s('Owned 1', 'Deck Spell 1', 'mine')]) }]);
    await runUpgrades(st.call, 'claude-opus-5-5', list, 'dk');
    const sys = st.asked[0].system as Array<{ text: string }>;
    expect(sys[0].text).toBe(UPGRADES_SYSTEM);
    expect(sys[1].text).toMatch(/- Deck Spell 1 \{1\}\{B\} - Instant - Deck Spell 1 draws a card\./);
    const last = JSON.stringify(st.asked.at(-1)!.messages);
    expect(last).toMatch(/No searches left/);
    // The cache point is the newest result only.
    const marks = (st.asked.at(-1)!.messages as Array<{ content: unknown }>).flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => (b as { cache_control?: unknown }).cache_control);
    expect(marks).toHaveLength(1);
  });
});

describe('what a swap does to the job counts', () => {
  it('a swap that would take a job under its range carries the warning; a like-for-like inside a short job says it doesn\'t fix it', async () => {
    const { swapEffects } = await import('./tune');
    const ramp = card('Sol Ring', { cmc: 1 });
    const bauble = card('Wayfarer\'s Bauble', { cmc: 1 });
    const drain = card('Blood Artist', { cmc: 2 });
    const rolesOf = (c: ScryfallCard) => (c.name === 'Blood Artist' ? ['drain'] : ['ramp']);
    const ctx = {
      main: [{ card: ramp, quantity: 1 }], roles: [], styles: [], plan: { snapshot: { themes: [], routeCards: [] } }, protectedWhy: new Map(),
      jobs: [{ id: 'ramp', label: 'Ramp', count: 5, range: [10, 12], cards: ['Sol Ring'] }, { id: 'finishers', label: 'Ways to finish', count: 10, range: [3, 5], cards: [] }],
      rolesOf,
    } as unknown as Parameters<typeof swapEffects>[0];
    expect(swapEffects(ctx, drain, ramp)).toContain('Ramp would drop to 4, under 10–12');
    expect(swapEffects(ctx, bauble, ramp)).toContain('Ramp stays at 5, under 10–12: this trade doesn’t fix it');
  });
});

describe('later rounds and "Not for me"', { timeout: 180_000 }, () => {
  it('a Swap in stays, a "Not for me" is never offered again here (later round, later run) but is on another deck', async () => {
    const cards = ['Up A', 'Up B', 'Up C', 'Up D'].map((n) => card(n));
    const { db, list } = await setup({ data: cards });
    const { runUpgrades, upgradesView, setUpgradeChoices, resetUpgrades, setUpgrades } = await import('./upgrades');
    setUpgrades(list.id, { count: 2 });
    await runUpgrades(stand([{ give: give([s('Up A', 'Deck Spell 1'), s('Up B', 'Deck Spell 2')]) }]).call, 'claude-opus-5-5', list, 'dk');
    setUpgradeChoices(list.id, { 'Up B': { choice: 'skip', text: 'too slow' } });
    const st = stand([{ give: give([s('Up B', 'Deck Spell 3'), s('Up C', 'Deck Spell 3')]) }]);
    await runUpgrades(st.call, 'claude-opus-5-5', list, 'dk', { rerun: true });
    let v = await upgradesView(list, 'dk');
    expect(v.run!.items.map((i) => i.name)).toEqual(['Up A', 'Up C']);
    expect(v.run!.changes).toEqual({ round: 2, out: [{ name: 'Up B', because: 'skipped' }], in: ['Up C'], back: [] });
    expect(v.notForMe).toEqual([{ name: 'Up B', why: 'too slow' }]);
    expect(JSON.stringify(st.asked[0])).toMatch(/Up B: \\"too slow\\"/);
    // A later run on the same deck: still never offered.
    resetUpgrades(list.id);
    await runUpgrades(stand([{ give: give([s('Up B', 'Deck Spell 4'), s('Up D', 'Deck Spell 5')]) }]).call, 'claude-opus-5-5', list, 'dk');
    v = await upgradesView(list, 'dk');
    expect(v.run!.items.map((i) => i.name)).toEqual(['Up D']);
    // Another deck doesn't share it.
    const other = db.createList('dk', 'Second Ghoul', '', { kind: 'deck', commander });
    for (let i = 1; i <= 3; i++) db.addCardToList(other.id, card(`Other Spell ${i}`));
    const o = db.getList(other.id, 'dk')!;
    await runUpgrades(stand([{ give: give([s('Up B', 'Other Spell 1')]) }]).call, 'claude-opus-5-5', o, 'dk');
    expect((await upgradesView(o, 'dk')).run!.items.map((i) => i.name)).toEqual(['Up B']);
  });
});

describe('apply and undo', { timeout: 180_000 }, () => {
  it('keeps the deck\'s size, the replaced card goes to the cuts section, a Maybeboard choice adds nothing to the deck; undo is exact', async () => {
    const buy = card('Bought Card', { prices: { usd: '3.00' } });
    const owned = card('Boxed Card');
    const maybe = card('Maybe Card');
    const { db, list } = await setup({ boxed: [owned], data: [buy, maybe] });
    const before = db.cardsInList(list.id).map((c) => `${c.card.name}:${c.board}:${c.quantity}`).sort();
    const { runUpgrades, setUpgradeChoices, applyUpgrades, undoUpgrades, upgradesView } = await import('./upgrades');
    await runUpgrades(stand([{ give: give([s('Bought Card', 'Deck Spell 1'), s('Boxed Card', 'Deck Spell 2', 'mine'), s('Maybe Card', 'Deck Spell 3')]) }]).call, 'claude-opus-5-5', list, 'dk');
    setUpgradeChoices(list.id, { 'Maybe Card': { choice: 'in', text: '', where: 'maybe' } });
    const done = await applyUpgrades(list, 'dk');
    expect(done).toMatchObject({ swapped: 2, maybe: 1, size: 16, cutsTo: 'Sideboard', buy: [{ name: 'Bought Card', price: 3 }] });
    const rows = db.cardsInList(list.id);
    const at = (n: string) => rows.find((c) => c.card.name === n)?.board;
    expect([at('Bought Card'), at('Boxed Card'), at('Maybe Card'), at('Deck Spell 1'), at('Deck Spell 2'), at('Deck Spell 3')]).toEqual(['main', 'main', 'maybe', 'side', 'side', 'main']);
    expect((await upgradesView(list, 'dk')).done!.swapped).toBe(2);
    undoUpgrades(list);
    expect(db.cardsInList(list.id).map((c) => `${c.card.name}:${c.board}:${c.quantity}`).sort()).toEqual(before);
    // The list is back to choose from again.
    expect((await upgradesView(list, 'dk')).run!.items).toHaveLength(3);
  });
});
