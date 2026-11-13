/**
 * Finish from the owner's collection (handoff 8) with a stand-in Claude (no
 * paid call): which cards are on offer under each copies setting, the search
 * tool and its limit, the check on Claude's picks, combos, the conversation,
 * how many, and apply with an exact undo. Each test has its own database.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClaudeParams } from './ai-claude';
import { chunkPairs, completeCombos, finishCount, parseQuery, searchLines, searchText, SEARCH_LIMIT, type PoolLine } from './finish-shared';
import type { ScryfallCard } from './scryfall';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-finish-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.stubEnv('MTG_CARDS_DB_PATH', join(dir, 'cards.db'));
  // Scryfall and Commander Spellbook can't be reached.
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

const card = (name: string, over: Partial<ScryfallCard> = {}) =>
  ({ id: name, oracle_id: `o-${name}`, name, type_line: 'Instant', cmc: 2, mana_cost: '{1}{U}', oracle_text: `${name} draws a card.`, color_identity: ['U'], legalities: { commander: 'legal' }, prices: { usd: '1.00' }, ...over }) as ScryfallCard;
const commander = card('Azula, Fire Lord', { type_line: 'Legendary Creature — Human Noble', cmc: 4, mana_cost: '{1}{U}{B}{R}', oracle_text: 'Whenever you cast a spell while Azula is attacking, copy it.', color_identity: ['U', 'B', 'R'] });
const island = card('Island', { type_line: 'Basic Land — Island', cmc: 0, mana_cost: '', oracle_text: '', color_identity: [] });

/** A 16-card Azula deck (the commander, 5 Islands, 10 spells) and a second deck; the owner's boxes hold `boxed`. */
async function setup(boxed: ScryfallCard[] = [], other: ScryfallCard[] = []) {
  const db = await import('./db');
  const col = await import('./collection');
  db.addProfile('dk', 'DK');
  const list = db.createList('dk', 'Azula', '', { kind: 'deck', commander });
  db.addCardToList(list.id, island, 5);
  for (let i = 1; i <= 10; i++) db.addCardToList(list.id, card(`Deck Spell ${i}`));
  const second = db.createList('dk', 'Zuko', '', { kind: 'deck', commander: card('Zuko', { type_line: 'Legendary Creature', color_identity: ['G'] }) });
  for (const c of other) db.addCardToList(second.id, c);
  for (const c of boxed) col.addToCollection('dk', c, 1);
  const { ROLES_VERSION } = await import('./roles');
  const ids = (db.database().all('SELECT data FROM cards') as Array<{ data: string }>).map((r) => (JSON.parse(r.data) as ScryfallCard).oracle_id!).filter(Boolean);
  db.saveRoles(new Map([...new Set([...ids, commander.oracle_id!])].map((id) => [id, []] as [string, string[]])), ROLES_VERSION);
  return { db, list: db.getList(list.id, 'dk')!, second };
}

const owned = Array.from({ length: 60 }, (_, i) => card(`Owned ${i + 1}`, { oracle_text: i % 2 ? 'Draw two cards.' : 'Destroy target creature.', cmc: (i % 5) + 1 }));

// --- a stand-in Claude: a script of turns -------------------------------------------------

type Turn = { search?: string[]; picks?: unknown };
function stand(turns: Turn[]) {
  const asked: ClaudeParams[] = [];
  let k = 0;
  let id = 0;
  const call = async (params: ClaudeParams) => {
    asked.push(structuredClone(params));
    const t = turns[Math.min(k++, turns.length - 1)];
    const content = t.picks
      ? [{ type: 'tool_use', id: `t${id++}`, name: 'give_picks', input: t.picks }]
      : (t.search ?? []).map((q) => ({ type: 'tool_use', id: `t${id++}`, name: 'search', input: { query: q } }));
    return { content, stop_reason: 'tool_use', model: 'claude-opus-5-5', usage: {} } as unknown as Anthropic.Beta.BetaMessage;
  };
  return { call, asked };
}
const pick = (names: string[], group = 'draw') => ({ groups: [{ group, cards: names.map((name) => ({ name, why: `${name} fits.` })) }], reply: 'Built around copies.' });
const text = (p: ClaudeParams) => JSON.stringify(p.messages);

describe('the cards on offer', { timeout: 60_000 }, () => {
  it('keeps to the colours, Commander-legal, not lands, not in the deck, within budget, rule and bracket', async () => {
    const red = card('Red Card', { color_identity: ['R'], colors: ['R'] });
    const green = card('Green Card', { color_identity: ['G'] });
    const banned = card('Banned Card', { legalities: { commander: 'banned' } });
    const land = card('Sulfur Falls', { type_line: 'Land', color_identity: ['U', 'R'], produced_mana: ['U', 'R'] });
    const inDeck = card('Deck Spell 1');
    const gc = card('Rhystic Study', { game_changer: true });
    const { list } = await setup([red, green, banned, land, inDeck, gc]);
    const { tuneContext } = await import('./tune');
    const { finishPool } = await import('./finish-pool');
    const names = (copies: 'spare' | 'any' = 'spare') => tuneContext(list, 'dk').then((ctx) => finishPool(ctx, copies).lines.map((l) => l.name));
    expect(await names()).toEqual(['Red Card', 'Rhystic Study']);
    // Budget: a card the owner has is never over it. Bracket 2: no Game Changers.
    const plan = await import('./deck-plan');
    plan.changePlan(list.id, { budget: 5, bracket: 2 });
    expect(await names()).toEqual(['Red Card']);
    // The deck rule.
    plan.changePlan(list.id, { rule: { text: 'Only red', filter: 'c:r' } });
    expect(await names()).toEqual(['Red Card']);
  });

  it('only spare copies: a card with one copy in another deck is held back; with a second copy in a box it is on offer', async () => {
    const lone = card('Lone Copy');
    const two = card('Two Copies');
    const { list } = await setup([two], [lone, two]);
    const { tuneContext } = await import('./tune');
    const { finishPool } = await import('./finish-pool');
    const ctx = await tuneContext(list, 'dk');
    const spare = finishPool(ctx, 'spare');
    expect(spare.lines.map((l) => l.name)).toEqual(['Two Copies']);
    expect(spare.lines[0].src).toBe('spare');
    expect(spare.counts).toMatchObject({ spare: 1, any: 2, otherOnly: 1 });
    const any = finishPool(ctx, 'any');
    expect(any.lines.map((l) => [l.name, l.src, l.deck ?? null])).toEqual([['Lone Copy', 'other', 'Zuko'], ['Two Copies', 'spare', null]]);
    // The search line says which deck it sits in.
    expect(any.lines[0].line).toMatch(/\(in Zuko\)$/);
  });

  it('offers a card waiting in this deck’s Maybeboard under both settings', async () => {
    const { db, list } = await setup();
    db.addCardToList(list.id, card('Maybe Card'), 1, 'nonfoil', 'maybe');
    const { tuneContext } = await import('./tune');
    const { finishPool } = await import('./finish-pool');
    const lines = finishPool(await tuneContext(list, 'dk'), 'spare').lines;
    expect(lines.map((l) => [l.name, l.src])).toEqual([['Maybe Card', 'maybe']]);
  });
});

describe('the search', () => {
  const line = (name: string, type: string, cmc: number, text: string, deck?: string): PoolLine => ({ name, line: `${name} {${cmc}} - ${type} - ${text}${deck ? ` (in ${deck})` : ''}`, cmc, typeLine: type, src: deck ? 'other' : 'spare', ...(deck ? { deck } : {}) });
  const pool = [line('Opt', 'Instant', 1, 'Scry 1. Draw a card.'), line('Divination', 'Sorcery', 3, 'Draw two cards.'), line('Brainstorm', 'Instant', 1, 'Draw three cards, then put two back.'), line('Murder', 'Instant', 3, 'Destroy target creature.', 'Zuko')];

  it('matches every word, narrows by t: and mv<=, and says the true count past 40', () => {
    expect(searchLines(pool, 'draw card').lines.map((l) => l.name)).toEqual(['Opt', 'Divination', 'Brainstorm']);
    expect(searchLines(pool, 'draw t:instant').lines.map((l) => l.name)).toEqual(['Opt', 'Brainstorm']);
    expect(searchLines(pool, 'draw mv<=1').lines.map((l) => l.name)).toEqual(['Opt', 'Brainstorm']);
    expect(searchLines(pool, 'destroy').lines[0].line).toContain('(in Zuko)');
    expect(parseQuery('"draw a card" t:Instant mv<=2')).toEqual({ words: ['draw', 'a', 'card'], not: [], types: ['instant'], notTypes: [], mv: 2, mvMin: null, ignored: [] });
    // What Claude tends to write beyond that: mv>=, mv=, o:, -word; anything else is named, not matched as a word.
    expect(parseQuery('o:treasure mv>=3 -creature c:r pow>=4')).toEqual({ words: ['treasure'], not: ['creature'], types: [], notTypes: [], mv: null, mvMin: 3, ignored: ['c:r', 'pow>=4'] });
    expect(parseQuery('mv=2')).toMatchObject({ mv: 2, mvMin: 2 });
    expect(searchLines(pool, 'o:draw mv>=3').lines.map((l) => l.name)).toEqual(['Divination']);
    expect(searchLines(pool, 'draw -scry').lines.map((l) => l.name)).not.toContain('Opt');
    expect(searchText(searchLines(pool, 'draw c:u'))).toContain('Ignored, not understood: c:u');
    const many = Array.from({ length: 55 }, (_, i) => line(`Card ${i}`, 'Instant', 1, 'Draw a card.'));
    const r = searchLines(many, 'draw');
    expect(r.total).toBe(55);
    expect(r.lines).toHaveLength(40);
  });
});

describe('a round with the stand-in Claude', { timeout: 60_000 }, () => {
  it('runs two searches, then keeps only picks that are on offer, were searched and are not lands; says how many short', async () => {
    const { list } = await setup([...owned, card('Unsearched Owned', { oracle_text: 'Gain 3 life.' })]);
    const finish = await import('./finish');
    const { call, asked } = stand([{ search: ['draw'] }, { search: ['destroy t:instant'] }, { picks: pick(['Owned 2', 'Owned 1', 'Not Owned', 'Unsearched Owned', 'Island', 'Owned 2']) }]);
    finish.setFinish(list.id, { want: 5 });
    await finish.runFinish(call as never, 'claude-opus-5-5', list, 'dk');
    expect(asked).toHaveLength(3);
    // No card list is sent: only the deck, the plan and the task.
    expect(text(asked[0])).not.toContain('Owned 1');
    expect(text(asked[0])).toContain('Pick exactly 5 non-land cards');
    const s = finish.finishStore(list.id);
    expect(s.run!.items.map((i) => i.name)).toEqual(['Owned 2', 'Owned 1']);
    expect(s.run!.short).toBe(3);
    expect(s.run!.dropped).toBe(4);
    expect(s.searches.map((x) => x.q)).toEqual(['draw', 'destroy t:instant']);
    // A search's result names the owner's cards and their rules text.
    const results = JSON.stringify(asked[1].messages.at(-1));
    expect(results).toContain('30 match');
    expect(results).toContain('Owned 2 {1}{U} - Instant - Draw two cards.');
  });

  it('marks only the newest search result as the cache point, so earlier searches are read from the cache', async () => {
    const { list } = await setup(owned);
    const finish = await import('./finish');
    const { call, asked } = stand([{ search: ['draw 1', 'draw 2'] }, { search: ['draw 3'] }, { search: ['draw 4'] }, { picks: pick(['Owned 2']) }]);
    finish.setFinish(list.id, { want: 1 });
    await finish.runFinish(call as never, 'claude-opus-5-5', list, 'dk');
    const last = asked.at(-1)!.messages;
    const marked = last.flatMap((m, i) => (Array.isArray(m.content) ? m.content.map((b, j) => ((b as { cache_control?: unknown }).cache_control ? `${i}.${j}` : '')) : [])).filter(Boolean);
    expect(marked).toEqual([`${last.length - 1}.0`]);
    // The second call had two results: only the later one is marked.
    expect((asked[1].messages.at(-1)!.content as Array<{ cache_control?: unknown }>).map((b) => !!b.cache_control)).toEqual([false, true]);
  });

  it('refuses the 26th search in code', async () => {
    const { list } = await setup(owned);
    const finish = await import('./finish');
    const { call, asked } = stand([{ search: Array.from({ length: 26 }, (_, i) => `draw ${i}`) }, { picks: pick(['Owned 2']) }]);
    finish.setFinish(list.id, { want: 1 });
    await finish.runFinish(call as never, 'claude-opus-5-5', list, 'dk');
    const results = (asked[1].messages.at(-1)!.content as Array<{ content: string }>).map((r) => r.content);
    expect(results.slice(0, SEARCH_LIMIT).every((r) => /match/.test(r))).toBe(true);
    expect(results[SEARCH_LIMIT]).toBe('No searches left, give your picks now.');
    expect(finish.finishStore(list.id).searches).toHaveLength(SEARCH_LIMIT);
  });

  it('sends the combos list only when the plan says combos first or none, and a failed lookup does not fail Finish', async () => {
    const { list } = await setup(owned);
    const finish = await import('./finish');
    const plan = await import('./deck-plan');
    const run = async () => { const { call, asked } = stand([{ search: ['draw'] }, { picks: pick(['Owned 2']) }]); await finish.runFinish(call as never, 'claude-opus-5-5', list, 'dk'); return asked; };
    finish.setFinish(list.id, { want: 1 });
    expect(JSON.stringify((await run())[0].system)).not.toContain('Combos the owner owns');
    // A plan that says combos first: the lookup is offline here, so Finish runs without the list and says so.
    plan.changePlan(list.id, { goal: { chips: [], text: '', combos: 'first' } });
    const asked = await run();
    expect(JSON.stringify(asked[0].system)).not.toContain('Combos the owner owns');
    expect(finish.finishStore(list.id).run!.combosFailed).toBe(true);
    // With a lookup that answers, the list goes with the request.
    vi.doMock('./finish-combos', () => ({ ownedCombos: async () => [{ id: 'c1', cards: ['Owned 2', 'Owned 4'], produces: ['Infinite mana'] }] }));
    vi.resetModules();
    const f2 = await import('./finish');
    const { call, asked: a2 } = stand([{ search: ['draw'] }, { picks: pick(['Owned 2']) }]);
    await f2.runFinish(call as never, 'claude-opus-5-5', list, 'dk');
    expect(JSON.stringify(a2[0].system)).toContain('Owned 2 + Owned 4 => Infinite mana');
    expect(JSON.stringify(a2[0].system)).toContain('build in complete combos the owner owns before anything else');
    vi.doUnmock('./finish-combos');
  });

  it('later rounds: a keep stays, a skipped card is never offered again, Rethink sends the reason, only open slots refill', async () => {
    const { list } = await setup(owned);
    const finish = await import('./finish');
    finish.setFinish(list.id, { want: 3 });
    await finish.runFinish(stand([{ search: ['draw'] }, { picks: pick(['Owned 2', 'Owned 4', 'Owned 6']) }]).call as never, 'claude-opus-5-5', list, 'dk');
    finish.setChoices(list.id, { 'Owned 4': { choice: 'skip', text: 'too slow' }, 'Owned 6': { choice: 'ask', text: 'is it good enough?' } });
    // Claude names the skipped card again: it is dropped. It brings back the rethought one with an argument.
    const { call, asked } = stand([{ search: ['draw t:instant'] }, { picks: pick(['Owned 4', 'Owned 6', 'Owned 8']) }]);
    await finish.runFinish(call as never, 'claude-opus-5-5', list, 'dk', { rerun: true, message: 'more instants' });
    const t = text(asked[0]);
    expect(t).toContain('asked you to rethink Owned 6 (\\"is it good enough?\\")');
    expect(t).toContain('skipped Owned 4 (\\"too slow\\")');
    expect(t).toContain('said: \\"more instants\\"');
    expect(t).toContain('Pick exactly 2 more');
    expect(t).toContain('You have 8 searches');
    const s = finish.finishStore(list.id);
    // A Rethink Claude picked again comes back with a new reason; a card that wasn't on the list is new.
    expect(s.run!.items.map((i) => [i.name, i.mark])).toEqual([['Owned 2', null], ['Owned 6', 'back'], ['Owned 8', 'new']]);
    expect(s.run!.changes).toEqual({ round: 2, out: [{ name: 'Owned 4', because: 'skipped' }], in: [{ name: 'Owned 8', group: 'draw' }], back: ['Owned 6'] });
    expect(s.skipped).toEqual(['Owned 4']);
    // A third round: the skipped card stays out.
    finish.setChoices(list.id, { 'Owned 8': { choice: 'skip', text: '' } });
    await finish.runFinish(stand([{ search: ['draw'] }, { picks: pick(['Owned 4', 'Owned 10']) }]).call as never, 'claude-opus-5-5', list, 'dk', { rerun: true });
    expect(finish.finishStore(list.id).run!.items.map((i) => i.name)).toEqual(['Owned 2', 'Owned 6', 'Owned 10']);
  });

  it('"+" takes a card a search returned without a paid round, and refuses one it did not', async () => {
    const { list } = await setup(owned);
    const finish = await import('./finish');
    finish.setFinish(list.id, { want: 1 });
    await finish.runFinish(stand([{ search: ['draw'] }, { picks: pick(['Owned 2']) }]).call as never, 'claude-opus-5-5', list, 'dk');
    await finish.takeCard(list, 'dk', 'Owned 10', 'draw');
    expect(finish.finishStore(list.id).run!.items.map((i) => [i.name, i.mark])).toEqual([['Owned 2', null], ['Owned 10', 'yours']]);
    await expect(finish.takeCard(list, 'dk', 'Owned 1', 'draw')).rejects.toThrow(/search/);
  });
});

describe('review, apply and undo', { timeout: 60_000 }, () => {
  it('adds the picks, moves a Maybeboard card in, and undo puts every row back exactly', async () => {
    const { db, list } = await setup(owned);
    db.addCardToList(list.id, card('Maybe Card'), 1, 'nonfoil', 'maybe');
    const rows = () => db.cardsInList(list.id).map((c) => [c.card.name, c.board, c.quantity]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    const before = rows();
    const finish = await import('./finish');
    finish.setFinish(list.id, { want: 3 });
    await finish.runFinish(stand([{ search: ['draw'] }, { search: ['maybe'] }, { picks: pick(['Owned 2', 'Maybe Card', 'Owned 4']) }]).call as never, 'claude-opus-5-5', list, 'dk');
    finish.setChoices(list.id, { 'Owned 4': { choice: 'skip', text: '' } });
    const done = await finish.applyFinish(list, 'dk');
    expect(done).toMatchObject({ added: 2, lands: 0, size: 18 });
    expect(db.cardsInList(list.id).find((c) => c.card.name === 'Maybe Card')!.board).toBe('main');
    finish.undoFinish(list);
    expect(rows()).toEqual(before);
    // The conversation is back after an undo.
    expect(finish.finishStore(list.id).run!.items).toHaveLength(3);
  });

  it('a full fill adds the app’s lands: the owner’s duals first, then basics by the colour symbols', async () => {
    const dual = card('Sulfur Falls', { type_line: 'Land', mana_cost: '', color_identity: ['U', 'R'], produced_mana: ['U', 'R'] });
    const { db, list } = await setup([...owned, dual]);
    const finish = await import('./finish');
    const view = await finish.finishView(list, 'dk');
    expect(view.howMany.lands).toBeGreaterThan(0);
    const n = view.howMany.nonland;
    expect(n + view.howMany.lands).toBe(100 - 16);
    finish.setFinish(list.id, { want: null });
    await finish.runFinish(stand([{ search: ['draw'] }, { search: ['destroy', 't:land'] }, { picks: { ...pick(owned.slice(0, n).map((c) => c.name)), lands: [{ name: 'Sulfur Falls', why: 'Both colours, untapped early.' }] } }]).call as never, 'claude-opus-5-5', list, 'dk');
    expect(finish.finishStore(list.id).run!.full).toBe(true);
    const done = await finish.applyFinish(list, 'dk');
    expect(done.size).toBe(100);
    const main = db.cardsInList(list.id).filter((c) => c.board === 'main');
    expect(main.find((c) => c.card.name === 'Sulfur Falls')).toBeTruthy();
    expect(main.find((c) => c.card.name === 'Island')!.quantity).toBeGreaterThan(5);
  });
});

describe('the lands on a fill to 100', { timeout: 60_000 }, () => {
  it('the owner sets the land total: the room for picks follows and Claude is told the total', async () => {
    const { list } = await setup(owned);
    const finish = await import('./finish');
    finish.setFinish(list.id, { lands: 30 });
    const view = await finish.finishView(list, 'dk');
    expect(view.howMany).toMatchObject({ target: 30, mine: true, lands: 25, nonland: 59 });
    const { call, asked } = stand([{ search: ['draw'] }, { picks: pick(['Owned 2']) }]);
    await finish.runFinish(call as never, 'claude-opus-5-5', list, 'dk');
    expect(text(asked[0])).toContain('Pick exactly 59 non-land cards');
    expect(text(asked[0])).toContain('so it will hold 30 lands when done (the number the owner chose)');
    finish.setFinish(list.id, { lands: null });
    expect((await finish.finishView(list, 'dk')).howMany.mine).toBe(false);
  });

  it('a dual can be left out and any number of a basic taken; apply adds exactly that', async () => {
    const dual = card('Sulfur Falls', { type_line: 'Land', mana_cost: '', color_identity: ['U', 'R'], produced_mana: ['U', 'R'] });
    const { db, list } = await setup([...owned, dual]);
    const finish = await import('./finish');
    finish.setFinish(list.id, { lands: 30 });
    const n = (await finish.finishView(list, 'dk')).howMany.nonland;
    await finish.runFinish(stand([{ search: ['draw'] }, { search: ['destroy', 't:land'] }, { picks: { ...pick(owned.slice(0, n).map((c) => c.name)), lands: [{ name: 'Sulfur Falls', why: 'Both colours.' }] } }]).call as never, 'claude-opus-5-5', list, 'dk');
    const before = (await finish.finishView(list, 'dk')).run!.lands!;
    expect(before.duals).toEqual([{ name: 'Sulfur Falls', on: true, why: 'Both colours.' }]);
    expect(before.total).toBe(25);
    // The dual out and 10 Islands typed (this test's card data has no other basic): the typed number stands.
    finish.setLands(list.id, { skip: ['Sulfur Falls'], basics: { Island: 10 } });
    const after = (await finish.finishView(list, 'dk')).run!.lands!;
    expect(after.total).toBe(10);
    expect(after.basics.find((b) => b.name === 'Island')).toMatchObject({ n: 10 });
    const done = await finish.applyFinish(list, 'dk');
    expect(done.lands).toBe(10);
    const main = db.cardsInList(list.id).filter((c) => c.board === 'main');
    expect(main.find((c) => c.card.name === 'Sulfur Falls')).toBeUndefined();
    expect(main.find((c) => c.card.name === 'Island')!.quantity).toBe(15);
  });
});

describe('Claude picks the lands worth playing; the app counts (Part E)', { timeout: 60_000 }, () => {
  const land = (name: string, makes: string[], extra: Partial<ScryfallCard> = {}) => card(name, { type_line: 'Land', mana_cost: '', cmc: 0, oracle_text: `{T}: Add ${makes.map((m) => `{${m}}`).join(' or ') || '{C}'}.`, color_identity: makes, produced_mana: makes.length ? makes : ['C'], ...extra });
  /** A mono-blue deck of 16 (commander, 5 Islands, 10 spells), the owner's lands in boxes or in another deck. */
  async function mono(boxed: ScryfallCard[], other: ScryfallCard[] = []) {
    const db = await import('./db');
    const col = await import('./collection');
    db.addProfile('dk', 'DK');
    const cmd = card('Talrand', { type_line: 'Legendary Creature', color_identity: ['U'], mana_cost: '{2}{U}{U}' });
    const list = db.createList('dk', 'Talrand', '', { kind: 'deck', commander: cmd });
    db.addCardToList(list.id, island, 5);
    for (let i = 1; i <= 10; i++) db.addCardToList(list.id, card(`Deck Spell ${i}`));
    const z = db.createList('dk', 'Zuko', '', { kind: 'deck', commander: card('Zuko', { type_line: 'Legendary Creature', color_identity: ['U'] }) });
    for (const c of other) db.addCardToList(z.id, c);
    for (const c of boxed) col.addToCollection('dk', c, 1);
    const { ROLES_VERSION } = await import('./roles');
    const ids = (db.database().all('SELECT data FROM cards') as Array<{ data: string }>).map((r) => (JSON.parse(r.data) as ScryfallCard).oracle_id!).filter(Boolean);
    db.saveRoles(new Map([...new Set([...ids, cmd.oracle_id!])].map((id) => [id, []] as [string, string[]])), ROLES_VERSION);
    return { db, list: db.getList(list.id, 'dk')! };
  }
  const tower = land('Reliquary Tower', []);
  const academy = land('Academy Ruins', ['C'].slice(1), { oracle_text: '{T}: Add {C}. {1}{U}, {T}: Put target artifact card from your graveyard on top of your library.' });
  const lagoon = land('Lonely Lagoon', ['U']);
  const fall = land('Sulfur Falls', ['U', 'R']);
  const lent = land('Lent Land', ['U']);

  it('a one-colour deck is offered its nonbasic lands; the basics drop by as many and the total stays', async () => {
    const { list } = await mono([...owned, tower, academy, lagoon, fall], [lent]);
    const finish = await import('./finish');
    finish.setFinish(list.id, { lands: 30 });
    const n = (await finish.finishView(list, 'dk')).howMany.nonland;
    const { call, asked } = stand([{ search: ['draw', 't:land'] }, { picks: { ...pick(owned.slice(0, n).map((c) => c.name)), lands: [{ name: 'Reliquary Tower', why: 'No hand size.' }, { name: 'Lonely Lagoon', why: 'Fixes nothing, finds an Island.' }] } }]);
    await finish.runFinish(call as never, 'claude-opus-5-5', list, 'dk');
    // The task asks for up to a third of 30 (10), and the land search shows only nonbasic lands that fit, under the copies setting.
    expect(text(asked[0])).toContain('Also choose up to 10 of the owner\'s nonbasic lands');
    const landResult = JSON.stringify(asked[1].messages.at(-1));
    expect(landResult).toContain('Reliquary Tower');
    // Each land says what it makes and how it enters, as words a search can match.
    expect(landResult).toContain('Lonely Lagoon {T}: Add {U}. - Land'.slice(0, 0) + '[makes-blue, untapped]');
    expect(landResult).not.toContain('Sulfur Falls'); // red: outside the colours
    expect(landResult).not.toContain('Lent Land'); // only in another deck, spare copies only
    expect(landResult).not.toMatch(/Island \{/);
    // The spell search never shows a land.
    expect(JSON.stringify(asked[1].messages.at(-1)).split('tool_use_id')[1]).not.toContain('Reliquary');
    const v = (await finish.finishView(list, 'dk')).run!.lands!;
    expect(v.duals.map((d) => d.name)).toEqual(['Reliquary Tower', 'Lonely Lagoon']);
    expect(v.total).toBe(25);
    expect(v.basics.find((b) => b.name === 'Island')!.n).toBe(23);
    // A colourless land takes a basic's place: blue has 24 sources of the 25 its share wanted, and the box says so.
    expect(v.short).toEqual([{ colour: 'U', have: 24, want: 25 }]);
    // Unticking a land gives its slot back to a basic.
    finish.setLands(list.id, { skip: ['Reliquary Tower'] });
    const after = (await finish.finishView(list, 'dk')).run!.lands!;
    expect(after.total).toBe(25);
    expect(after.basics.find((b) => b.name === 'Island')!.n).toBe(24);
    expect(after.short).toEqual([]);
  });

  it('cuts a land answer to the limit, and never takes a land already in the deck', async () => {
    const many = Array.from({ length: 14 }, (_, i) => land(`Blue Land ${i + 1}`, ['U']));
    const { db, list } = await mono([...owned, ...many]);
    db.addCardToList(list.id, many[0]);
    const finish = await import('./finish');
    finish.setFinish(list.id, { lands: 30 });
    const n = (await finish.finishView(list, 'dk')).howMany.nonland;
    const { asked, call } = stand([{ search: ['draw', 't:land'] }, { picks: { ...pick(owned.slice(0, n).map((c) => c.name)), lands: many.map((l) => ({ name: l.name, why: 'Blue.' })) } }]);
    await finish.runFinish(call as never, 'claude-opus-5-5', list, 'dk');
    // A third of 30, less the one nonbasic already in the deck: 9.
    expect(text(asked[0])).toContain('Also choose up to 9 of');
    const picks = finish.finishStore(list.id).run!.landPicks!;
    expect(picks).toHaveLength(9);
    expect(picks.map((l) => l.name)).not.toContain('Blue Land 1');
  });

  it('remembers what was skipped on this deck through Apply and Start over, with the reason, until taken off', async () => {
    const { list } = await setup(owned);
    const finish = await import('./finish');
    finish.setFinish(list.id, { want: 2 });
    await finish.runFinish(stand([{ search: ['draw'] }, { picks: pick(['Owned 2', 'Owned 4']) }]).call as never, 'claude-opus-5-5', list, 'dk');
    finish.setChoices(list.id, { 'Owned 4': { choice: 'skip', text: 'too slow for this deck' } });
    finish.resetFinish(list.id);
    expect(finish.finishStore(list.id).skippedBefore).toEqual([{ name: 'Owned 4', why: 'too slow for this deck' }]);
    const { call, asked } = stand([{ search: ['draw'] }, { picks: pick(['Owned 4', 'Owned 6']) }]);
    await finish.runFinish(call as never, 'claude-opus-5-5', list, 'dk');
    // Not on offer, and the reason goes with the request.
    expect(JSON.stringify(asked[0].system)).toContain('Owned 4: \\"too slow for this deck\\"');
    expect(JSON.stringify(asked[1].messages.at(-1))).not.toContain('Owned 4 {');
    expect(finish.finishStore(list.id).run!.items.map((i) => i.name)).toEqual(['Owned 6']);
    // Searched: how many cards, and the colours in words.
    expect((await finish.finishView(list, 'dk')).offer).toEqual({ n: 59, lands: 0, colours: 'blue, black and red' });
    finish.unskip(list.id, 'Owned 4');
    expect(finish.finishStore(list.id).skippedBefore).toEqual([]);
  });
});

describe('Finish review fixes (PR 55, items 11-19)', { timeout: 60_000 }, () => {
  const dual = card('Sulfur Falls', { type_line: 'Land', mana_cost: '', color_identity: ['U', 'R'], produced_mana: ['U', 'R'] });
  const fill = async (list: { id: string }, finish: typeof import('./finish'), lands: Array<{ name: string; why: string }>) => {
    const n = (await finish.finishView(list as never, 'dk')).howMany.nonland;
    await finish.runFinish(stand([{ search: ['draw', 't:land'] }, { picks: { ...pick(owned.slice(0, n).map((c) => c.name)), lands } }]).call as never, 'claude-opus-5-5', list as never, 'dk');
  };

  it('11: with every basic typed, unticking a land still keeps the land number', async () => {
    const { list } = await setup([...owned, dual]);
    const finish = await import('./finish');
    finish.setFinish(list.id, { lands: 30 });
    await fill(list, finish, [{ name: 'Sulfur Falls', why: 'Both colours.' }]);
    const v0 = (await finish.finishView(list, 'dk')).run!.lands!;
    finish.setLands(list.id, { basics: Object.fromEntries(v0.basics.map((b) => [b.name, b.n])), room: v0.basics.reduce((k, b) => k + b.n, 0) });
    expect((await finish.finishView(list, 'dk')).run!.lands!.total).toBe(v0.total);
    finish.setLands(list.id, { skip: ['Sulfur Falls'] });
    const v1 = (await finish.finishView(list, 'dk')).run!.lands!;
    expect(v1.total).toBe(v0.total);
    expect(v1.basics.reduce((k, b) => k + b.n, 0)).toBe(v0.basics.reduce((k, b) => k + b.n, 0) + 1);
  });

  it('12: a run stored before Claude chose lands asks for them on its next round', async () => {
    const { list } = await setup([...owned, dual]);
    const finish = await import('./finish');
    finish.setFinish(list.id, { lands: 30 });
    await fill(list, finish, []);
    // As a run from before this change was stored: no land picks at all.
    const db = await import('./db');
    const raw = JSON.parse((db.database().get('SELECT state FROM deck_finish WHERE listId = ?', [list.id]) as { state: string }).state);
    delete raw.run.landPicks; delete raw.run.landsLimit;
    db.database().run('UPDATE deck_finish SET state = ? WHERE listId = ?', [JSON.stringify(raw), list.id]);
    finish.setChoices(list.id, { 'Owned 1': { choice: 'skip', text: '' } });
    const { call, asked } = stand([{ search: ['t:land'] }, { picks: { ...pick(['Owned 61'.slice(0, 0) || 'Owned 3']), lands: [{ name: 'Sulfur Falls', why: 'Both colours.' }] } }]);
    await finish.runFinish(call as never, 'claude-opus-5-5', list, 'dk', { rerun: true });
    expect(text(asked[0])).toContain('Also choose up to');
    expect(finish.finishStore(list.id).run!.landPicks).toEqual([{ name: 'Sulfur Falls', why: 'Both colours.' }]);
  });

  it('13: a colourless commander\'s fill reaches 100 with Wastes', async () => {
    const { finishLands } = await import('./finish-pool');
    const wastes = card('Wastes', { type_line: 'Basic Land', mana_cost: '', color_identity: [], produced_mana: ['C'] });
    const ctx = { identity: new Set<string>(), main: [{ card: wastes, quantity: 1, board: 'main' }], commanders: [] } as never;
    const { lands } = finishLands(ctx, new Map(), 'spare', 30, [], []);
    expect(lands).toEqual([expect.objectContaining({ n: 30, card: expect.objectContaining({ name: 'Wastes' }) })]);
  });

  it('16: Undo takes back the skips that Apply remembered; 17: a card taken off meanwhile stays off', async () => {
    const { list } = await setup(owned);
    const finish = await import('./finish');
    finish.setFinish(list.id, { want: 3 });
    await finish.runFinish(stand([{ search: ['draw'] }, { picks: pick(['Owned 2', 'Owned 4', 'Owned 6']) }]).call as never, 'claude-opus-5-5', list, 'dk');
    finish.setChoices(list.id, { 'Owned 4': { choice: 'skip', text: 'slow' } });
    await finish.applyFinish(list, 'dk');
    expect(finish.finishStore(list.id).skippedBefore.map((x) => x.name)).toEqual(['Owned 4']);
    finish.undoFinish(list);
    expect(finish.finishStore(list.id).skippedBefore).toEqual([]);
    // Skip again and send: the skip is remembered; taking another off while a round runs is kept.
    finish.setChoices(list.id, { 'Owned 4': { choice: 'skip', text: 'slow' } });
    const db = await import('./db');
    const st = JSON.parse((db.database().get('SELECT state FROM deck_finish WHERE listId = ?', [list.id]) as { state: string }).state);
    st.skippedBefore = [{ name: 'Owned 10', why: '' }];
    db.database().run('UPDATE deck_finish SET state = ? WHERE listId = ?', [JSON.stringify(st), list.id]);
    const slow = stand([{ search: ['draw'] }, { picks: pick(['Owned 8']) }]);
    const call = async (p: never) => { finish.unskip(list.id, 'Owned 10'); return slow.call(p); };
    await finish.runFinish(call as never, 'claude-opus-5-5', list, 'dk', { rerun: true });
    expect(finish.finishStore(list.id).skippedBefore.map((x) => x.name)).toEqual(['Owned 4']);
  });

  it('15: the measured price counts only calls that answered', async () => {
    const { measuredRounds } = await import('./finish-shared');
    const c = (at: string, step: string, cost: number) => ({ at, profileId: 'dk', label: 'A', step, cost });
    const ok = [c('1', 'finish: first list', 0.3), c('2', 'finish: first list', 0.3), c('3', 'finish: first list', 0.3)];
    expect(measuredRounds(ok)).toEqual({ first: 0.3, later: null });
    const lib = await import('./finish');
    expect(typeof lib.finishView).toBe('function');
  });

  it('18: a kept card Claude takes out and picks again comes back, and is listed as back', async () => {
    const { list } = await setup(owned);
    const finish = await import('./finish');
    finish.setFinish(list.id, { want: 2 });
    await finish.runFinish(stand([{ search: ['draw'] }, { picks: pick(['Owned 2', 'Owned 4']) }]).call as never, 'claude-opus-5-5', list, 'dk');
    await finish.runFinish(stand([{ search: ['draw'] }, { picks: { ...pick(['Owned 2']), out: ['Owned 2'] } }]).call as never, 'claude-opus-5-5', list, 'dk', { rerun: true, message: 'rethink everything' });
    const run = finish.finishStore(list.id).run!;
    expect(run.items.find((i) => i.name === 'Owned 2')!.mark).toBe('back');
    expect(run.changes!.back).toEqual(['Owned 2']);
    expect(run.changes!.in).toEqual([]);
  });

  it('19: a refused land search isn\'t counted; t:"land" is a land search; "+" takes only lands a land search found', async () => {
    const { parseQuery } = await import('./finish-shared');
    expect(parseQuery('t:"land" makes-blue').types).toEqual(['land']);
    const { list } = await setup([...owned, dual]);
    const finish = await import('./finish');
    finish.setFinish(list.id, { want: 2 });
    const { call, asked } = stand([{ search: ['t:land', 'draw'] }, { picks: pick(['Owned 2', 'Owned 4']) }]);
    await finish.runFinish(call as never, 'claude-opus-5-5', list, 'dk');
    expect(JSON.stringify(asked[1].messages.at(-1))).toContain('That search wasn');
    expect(finish.finishStore(list.id).searches.map((x) => x.q)).toEqual(['draw']);
    expect(() => finish.setLands(list.id, { add: 'Owned 6' })).toThrow(/land search/);
  });
});

describe('how many', () => {
  it('5 adds no lands; exactly the room left fills to 100 with lands; past 100 is allowed with no lands', () => {
    expect(finishCount(16, 33, 5)).toEqual({ want: 5, full: false, room: 84, nonland: 51, lands: 0 });
    expect(finishCount(16, 33, 51)).toEqual({ want: 51, full: true, room: 84, nonland: 51, lands: 33 });
    expect(finishCount(16, 33, null)).toMatchObject({ want: 51, full: true });
    expect(finishCount(95, 0, 12)).toEqual({ want: 12, full: false, room: 5, nonland: 5, lands: 0 });
    expect(finishCount(100, 0, null)).toMatchObject({ want: 5, full: false });
  });

  it('Trim: cut 5, cut to 95, and down to 100', async () => {
    const { cutsFor, targetWords, cleanTarget } = await import('./trim-shared');
    expect(cutsFor(108, null)).toBe(8);
    expect(cutsFor(100, null)).toBe(0);
    expect(cutsFor(100, { kind: 'cut', n: 5 })).toBe(5);
    expect(cutsFor(108, { kind: 'to', n: 95 })).toBe(13);
    expect(targetWords(108, { kind: 'to', n: 95 })).toBe('cut 13 to reach 95');
    expect(cleanTarget({ kind: 'to', n: 0 })).toBeNull();
  });
});

describe('combos', { timeout: 30_000 }, () => {
  it('every pair of 290-card chunks is one request, so any two cards meet in some request', () => {
    const names = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`);
    expect(chunkPairs(names(200))).toHaveLength(1);
    expect(chunkPairs(names(767))).toHaveLength(3);
    expect(chunkPairs(names(1935))).toHaveLength(21);
    const reqs = chunkPairs(names(767)).map((r) => new Set(r));
    expect(reqs.every((r) => r.size <= 580)).toBe(true);
    for (const [a, b] of [[0, 766], [10, 400], [300, 700], [5, 6]]) expect(reqs.some((r) => r.has(`c${a}`) && r.has(`c${b}`))).toBe(true);
  });

  it('the re-check finds a complete combo and loses it when a piece is skipped', () => {
    const combos = [{ id: 'x', cards: ['Reiterate', 'Rousing Refrain'], produces: ['Infinite mana'] }];
    expect(completeCombos(combos, ['Azula', 'Reiterate', 'Rousing Refrain // Back'])).toHaveLength(1);
    expect(completeCombos(combos, ['Azula', 'Reiterate'])).toHaveLength(0);
  });

  it('the lookup is kept per profile and commander until the cards sent change', async () => {
    await setup();
    const { ownedCombos } = await import('./finish-combos');
    const ask = vi.fn(async () => ({ included: [{ id: 'a', cards: ['A', 'B'], produces: ['Win the game'] }] }));
    expect(await ownedCombos('dk', 'Azula', ['A', 'B'], ask, 0)).toHaveLength(1);
    await ownedCombos('dk', 'Azula', ['B', 'A'], ask, 0);
    expect(ask).toHaveBeenCalledTimes(1);
    await ownedCombos('dk', 'Azula', ['A', 'B', 'C'], ask, 0);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('counts a combo one card short in a request when the owner holds the missing card in another chunk', async () => {
    await setup();
    const { ownedCombos } = await import('./finish-combos');
    const names = Array.from({ length: 700 }, (_, i) => `c${i}`);
    const ask = vi.fn(async (deck: { main: Array<{ name: string }> }) => {
      const has = new Set(deck.main.map((m) => m.name));
      // A three-card combo of c1, c400 and c650: never all in one request.
      const parts = ['c1', 'c400', 'c650'];
      const missing = parts.filter((p) => !has.has(p));
      return { included: [], almost: missing.length === 1 ? [{ id: 'three', cards: parts, produces: ['Infinite mana'], missing }, { id: 'unowned', cards: ['c1', 'Not Owned'], produces: [], missing: ['Not Owned'] }] : [] };
    });
    const found = await ownedCombos('dk', 'Azula', names, ask, 0);
    expect(found.map((c) => c.id)).toEqual(['three']);
  });
});

describe('held review fixes (handoff 9, Part D)', { timeout: 60_000 }, () => {
  it('the done message names only borrowed cards that went in, and says which picks were left out', async () => {
    const lent = card('Lent Copy');
    const { db, list } = await setup(owned, [lent]);
    const finish = await import('./finish');
    finish.setFinish(list.id, { want: 2, copies: 'any' });
    await finish.runFinish(stand([{ search: ['copy'] }, { search: ['draw'] }, { picks: pick(['Lent Copy', 'Owned 2']) }]).call as never, 'claude-opus-5-5', list, 'dk');
    expect(finish.finishStore(list.id).run!.items.map((i) => i.name)).toEqual(['Lent Copy', 'Owned 2']);
    // Before apply, the borrowed card goes into this deck another way: it is no longer on offer.
    db.addCardToList(list.id, lent);
    const done = await finish.applyFinish(list, 'dk');
    expect(done.added).toBe(1);
    expect(done.borrowed).toEqual([]);
    expect(done.left).toEqual(['Lent Copy']);
  });

  it('the combo lookup is keyed on the owner’s holdings, so an apply does not run it again', async () => {
    const asks: number[] = [];
    vi.doMock('./spellbook', async (orig) => ({ ...(await orig<typeof import('./spellbook')>()), combosInDeck: async (deck: { main: unknown[] }) => { asks.push(deck.main.length); return { included: [], almost: [] }; } }));
    vi.resetModules();
    const { list } = await setup(owned);
    const finish = await import('./finish');
    const plan = await import('./deck-plan');
    plan.changePlan(list.id, { goal: { chips: [], text: '', combos: 'first' } });
    finish.setFinish(list.id, { want: 2 });
    await finish.runFinish(stand([{ search: ['draw'] }, { picks: pick(['Owned 2', 'Owned 4']) }]).call as never, 'claude-opus-5-5', list, 'dk');
    // One lookup over the holdings (big), one re-check of the picks (the deck and two picks).
    const first = asks.filter((n) => n > 20).length;
    expect(first).toBe(1);
    await finish.applyFinish(list, 'dk');
    finish.resetFinish(list.id);
    await finish.runFinish(stand([{ search: ['draw'] }, { picks: pick(['Owned 6']) }]).call as never, 'claude-opus-5-5', list, 'dk');
    expect(asks.filter((n) => n > 20).length).toBe(first);
    vi.doUnmock('./spellbook');
  });

  it('Finish’s price: a guess that grows with the cards asked for, then the average of real rounds by round', async () => {
    const { measuredRounds, roundPrice } = await import('./finish-shared');
    const guess = { usd: 0.38, measured: false, base: 0.06, perCard: 0.008 };
    expect(roundPrice(guess, 5).usd).toBeCloseTo(0.1);
    expect(roundPrice(guess, 43).usd).toBeCloseTo(0.404);
    const call = (at: string, step: string, cost: number, label = 'Azula') => ({ at, profileId: 'dk', label, step, cost });
    const calls = [
      call('1', 'finish: first list', 0.1), call('2', 'finish: search', 0.05), call('3', 'finish: search', 0.05),
      call('4', 'finish: later list', 0.03), call('5', 'finish: search', 0.02),
      call('6', 'finish: first list', 0.3, 'Kratos'), call('7', 'finish: first list', 0.2), call('8', 'finish: search', 0.1, 'Kratos'),
    ];
    // A round is its first call and the searches after it on the same deck: 0.2, 0.4 and 0.2. One later round isn't enough.
    const m = measuredRounds(calls);
    expect(m.first).toBeCloseTo((0.2 + 0.4 + 0.2) / 3);
    expect(m.later).toBeNull();
    expect(measuredRounds(calls.slice(0, 5))).toEqual({ first: null, later: null });
    expect(roundPrice({ usd: 0.27, measured: true }, 5)).toEqual({ usd: 0.27, measured: true });
  });

  it('the header budget chip: the cap that runs out first, quiet, amber from 80%, red when used up', async () => {
    const { chipTone, tightest } = await import('./spend-chip');
    expect(tightest({ today: 1, profileToday: 0.5, caps: { daily: 5, perProfile: 2 } })).toEqual({ spent: 0.5, cap: 2, whose: 'yours' });
    expect(tightest({ today: 4.8, profileToday: 0.5, caps: { daily: 5, perProfile: 2 } })).toEqual({ spent: 4.8, cap: 5, whose: 'everyone' });
    expect(chipTone(0.5, 2)).toBe('quiet');
    expect(chipTone(1.6, 2)).toBe('amber');
    expect(chipTone(2, 2)).toBe('red');
    expect(chipTone(0, 0)).toBe('quiet');
    const { soundsUnsure } = await import('./finish-shared');
    expect(soundsUnsure('kind of expensive for what it does')).toBe(true);
    expect(soundsUnsure('is this good enough?')).toBe(true);
    expect(soundsUnsure('the best draw spell here')).toBe(false);
  });
});

describe('the plan’s combos choice', { timeout: 60_000 }, () => {
  it('is set on its own and kept when the goal chips or words change', async () => {
    const { list } = await setup();
    const ph = await import('./plan-help');
    const plan = await import('./deck-plan');
    const ctx = await import('./plan-context');
    await ph.act(list, 'dk', { action: 'goal', combos: 'first' });
    await ph.act(list, 'dk', { action: 'goal', chips: ['Faster'], text: 'Go fast' });
    expect(plan.planFor(list.id, '', list.commander, []).goal).toEqual({ chips: ['Faster'], text: 'Go fast', combos: 'first' });
    expect(await ctx.planContext(list)).toContain('- Combos: build around them');
    await ph.act(list, 'dk', { action: 'goal', combos: null });
    expect(plan.planFor(list.id, '', list.commander, []).goal.combos).toBeUndefined();
    expect(await ctx.planContext(list)).not.toContain('- Combos:');
  });
});
