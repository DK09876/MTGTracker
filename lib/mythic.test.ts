/**
 * Mythic Tools: its collection CSV, its deck exports, and a deck holding
 * the very copies the collection-linked list names. The fixtures are real
 * exports (lib/fixtures/mythic). A real database in a temporary file;
 * Scryfall's collection endpoint is stood in for by cards made from the
 * fixtures' own lines, so nothing goes out.
 */

import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Identifier, ScryfallCard } from './scryfall';

vi.setConfig({ testTimeout: 30_000 });

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures/mythic', name), 'utf8');
const LIST = fixture('zuko.list.txt');
const LINKED = fixture('zuko.linked.txt');
const CSV = fixture('collection-excerpt.csv');

// Every printing the fixtures name, as a card: "1 Name (SET) 123" and "1x Name (set) #123".
const cards = new Map<string, ScryfallCard>();
const typeOf = (name: string) =>
  /^(Fire Lord Zuko|Fire Lord Azula)$/.test(name) ? 'Legendary Creature — Human Noble'
    : /^(Mountain|Plains|Island|Swamp|Forest)$/.test(name) ? `Basic Land — ${name}` : 'Instant';
function remember(name: string, set: string, number: string) {
  const key = `${set.toLowerCase()}|${number}`;
  if (!cards.has(key)) {
    cards.set(key, {
      id: `${set.toLowerCase()}-${number}`, oracle_id: `o-${name}`, name, set: set.toLowerCase(), collector_number: number,
      type_line: typeOf(name), legalities: { commander: 'legal' }, prices: { usd: '1.00', usd_foil: '2.00', usd_etched: '2.00' },
      finishes: ['nonfoil', 'foil', 'etched'],
    } as ScryfallCard);
  }
}
for (const m of LIST.matchAll(/^\d+ (.+?) \(([A-Z0-9]+)\) (\S+)/gm)) remember(m[1], m[2], m[3]);
for (const m of LINKED.matchAll(/^\d+x (.+?) \(([a-z0-9]+)\) #(\S+)/gm)) {
  const english = m[1].match(/\(([^()]+)\)$/)?.[1];
  remember(english && /[^\x20-\x7E]|[|$]/.test(m[1]) ? english : m[1], m[2], m[3]);
}
// The CSV excerpt's printings, by their English names.
for (const [name, set, number] of [
  ['Shock', 'sta', '44'], ['Batterskull', 'sld', '1206'], ['Gemrazer', 'pip', '351'], ['Myr Convert', 'one', '479'],
  ['Plateau', 'ced', '280'], ['Arno Dorian', 'acr', '227'], ['Aura Shards', 'sld', '2694'], ['Abandoned Air Temple', 'tla', '263'],
  ['Academy Manufactor', 'sld', '7094'], ["Aang's Journey", 'tla', '1'],
] as const) remember(name, set, number);
const byId = (id: string) => [...cards.values()].find((c) => c.id === id);

const lookup = async (identifiers: Identifier[]) => {
  const found: ScryfallCard[] = [];
  for (const id of identifiers) {
    const hit = 'set' in id ? cards.get(`${id.set.toLowerCase()}|${id.collector_number}`)
      : 'name' in id ? [...cards.values()].find((c) => c.name.toLowerCase() === id.name.toLowerCase())
        : 'id' in id ? undefined : undefined;
    if (hit) found.push(hit);
  }
  return { cards: found, notFound: [] };
};

vi.mock('./scryfall', async (original) => ({
  ...(await original<typeof import('./scryfall')>()),
  collection: (identifiers: Identifier[]) => lookup(identifiers),
}));

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-mythic-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

const HEADER = 'Card Name,English Name,Set Code,Set Name,Collector Number,Rarity,Language,Quantity,Condition,Finish,Altered,Signed,Misprint,Proxy,Price (USD),Price (EUR),Price (USD Foil),Price (EUR Foil),Price (USD Etched),Price (EUR Etched),Scryfall ID,Container Type,Container Name,Purchase Price (USD),Purchase Price (EUR)';

/** A Mythic Tools CSV holding a copy of every card the linked list takes from a box, in that box. */
function zukoCollection(): string {
  const rows = [`﻿${HEADER}`];
  const proxies = new Set([...LINKED.split('Proxies:')[1].split('New cards')[0].matchAll(/\(([a-z0-9]+)\) #(\S+)/g)].map((m) => `${m[1]}|${m[2]}`));
  let box = '';
  let inGet = false;
  for (const line of LINKED.split('\n')) {
    if (line.startsWith('Cards to get')) inGet = true;
    else if (/^(Proxies|New cards|Available|Need to buy)/.test(line)) inGet = false;
    const from = line.match(/^From "(.*)"$/);
    if (from) box = from[1];
    const m = line.match(/^(\d+)x (.+?) \(([a-z0-9]+)\) #(\S+)( FOIL)?/);
    if (!inGet || !m) continue;
    const card = cards.get(`${m[3]}|${m[4]}`)!;
    rows.push([`"${m[2].replace(/"/g, '""')}"`, `"${card.name}"`, `"${m[3]}"`, '"Set"', `"${m[4]}"`, '"rare"', '"en"', m[1], '"NM"',
      `"${m[5] ? 'foil' : 'nonfoil'}"`, 'false', 'false', 'false', String(proxies.has(`${m[3]}|${m[4]}`)), '0', '0', '0', '0', '0', '0',
      `"${card.id}"`, '"box"', `"${box}"`, '', ''].join(','));
  }
  // A spare copy in a binder, free to pull.
  rows.push(['"Abandoned Air Temple"', '"Abandoned Air Temple"', '"tla"', '"Set"', '"263"', '"rare"', '"en"', '1', '"NM"', '"nonfoil"',
    'false', 'false', 'false', 'false', '0', '0', '0', '0', '0', '0', '"tla-263"', '"binder"', '"Trade"', '', ''].join(','));
  return rows.join('\n') + '\n';
}

async function load() {
  const db = await import('./db');
  db.addProfile('dk', 'DK');
  return {
    db,
    col: await import('./collection'),
    run: await import('./collection-import-run'),
    mythic: await import('./mythic'),
  };
}

describe('reading Mythic Tools exports', () => {
  it('reads the collection CSV: containers, language, condition, proxies, etched, and English names', async () => {
    const { readCollectionFile } = await import('./collection-import');
    const { rows, format, unreadable } = readCollectionFile(CSV);
    expect(format).toBe('Mythic Tools');
    expect(unreadable).toEqual([]);
    const at = (set: string, number: string) => rows.filter((r) => r.set === set && r.number === number);
    expect(at('sta', '44')[0]).toMatchObject({ name: 'Shock', variant: 'lang:ja', location: 'bulk', kind: 'box' });
    expect(at('sld', '1206')[0]).toMatchObject({ name: 'Batterskull', variant: 'lang:ph', finish: 'foil' });
    // No Scryfall id: found by set and number, or its English name.
    expect(at('pip', '351')[0]).toMatchObject({ name: 'Gemrazer', scryfallId: undefined, variant: 'lang:fr' });
    // A real copy and a proxy of one printing, in one box, stay apart.
    expect(at('one', '479').map((r) => r.variant)).toEqual(['', 'proxy']);
    expect(at('ced', '280')[0].variant).toBe('proxy');
    expect(at('acr', '227')[0].finish).toBe('etched');
    // Mint is as good as near mint: nothing to say.
    expect(at('sld', '2694')[0].variant).toBe('');
    expect(at('tla', '263').map((r) => [r.location, r.kind, r.quantity])).toEqual([['bulk', 'box', 2], ['Trade', 'binder', 1]]);
    expect(rows.reduce((n, r) => n + r.quantity, 0)).toBe(16);
  });

  it('reads the collection-linked list, section by section', async () => {
    const { parseLinkedList } = await import('./mythic');
    const p = parseLinkedList(LINKED);
    expect(p.title).toBe('Cooking with Zuko - Main');
    expect(p.unreadable).toEqual([]);
    expect(p.fromBoxes.every((l) => l.location === 'bulk')).toBe(true);
    expect(p.fromBoxes.find((l) => l.set === 'tla' && l.number === '315')).toMatchObject({ name: 'Fire Lord Zuko', set: 'tla', finish: 'foil', board: 'main' });
    // A card in another language is found by the English name after it.
    expect(p.fromBoxes.find((l) => l.set === 'soa' && l.number === '109')?.name).toBe("Jeska's Will");
    expect(p.fromBoxes.find((l) => l.set === 'snc' && l.number === '360')?.name).toBe('Urabrask, Heretic Praetor');
    expect(p.proxies.map((l) => l.name)).toEqual(['Plateau', "Jeska's Will"]);
    expect(p.newCards).toEqual([]);
    expect(p.available.find((l) => l.name === 'Hidden Courtyard')).toMatchObject({ board: 'side', where: 'bulk', exact: true });
    expect(p.available.find((l) => l.name === 'Temple of Triumph')).toMatchObject({ exact: false });
    expect(p.buy.find((l) => l.name === 'Wild Wasteland')).toMatchObject({ finish: 'foil', board: 'maybe' });
    expect(p.buy.filter((l) => l.board === 'maybe')).toHaveLength(12);
  });

  it('reads "*P*" in a deck list as a proxy', async () => {
    const { parseDecklist } = await import('./decklist');
    const proxies = parseDecklist(LIST).entries.filter((e) => e.proxy).map((e) => e.name);
    expect(proxies).toEqual(["Jeska's Will", 'Plateau']);
  });

  it('puts the commander under a heading and adds the maybeboard from the linked list', async () => {
    const { mythicDeckText } = await import('./mythic');
    const text = mythicDeckText(LIST, LINKED);
    expect(text.split('\n').slice(0, 4)).toEqual(['Commander', '1 Fire Lord Zuko (TLA) 315 *F*', '', 'Deck']);
    const maybe = text.split('Maybeboard:\n')[1].split('\n');
    expect(maybe).toHaveLength(15);
    expect(maybe).toContain('1 Wild Wasteland (pip) 599 *F*');
  });
});

describe('importing a Mythic Tools collection', () => {
  it('keeps every copy apart by box, language and proxy, and counts proxies without value', async () => {
    const { col, run } = await load();
    const r = await run.runCollectionImport('dk', CSV, { mode: 'add', lookup });
    expect(r).toMatchObject({ format: 'Mythic Tools', copies: 16, missing: [] });
    const copies = col.boxCopies('dk');
    expect(copies.filter((c) => c.card.id === 'one-479').map((c) => c.variant).sort()).toEqual(['', 'proxy']);
    expect(copies.find((c) => c.card.id === 'pip-351')?.variant).toBe('lang:fr');
    expect(col.locations('dk').map((l) => [l.name, l.kind, l.count]).sort()).toEqual([['', 'box', 0], ['Play', 'binder', 1], ['Trade', 'binder', 1], ['bulk', 'box', 14]]);
    const state = col.collectionState('dk');
    expect(state.totals).toMatchObject({ copies: 16, inBoxes: 16, inDecks: 0, proxies: 2 });
  });

  it('does not add the same file twice, and replacing with it again changes nothing', async () => {
    const { col, run } = await load();
    await run.runCollectionImport('dk', CSV, { mode: 'add', lookup });
    await expect(run.runCollectionImport('dk', CSV.replace(/\n/g, '\r\n'), { mode: 'add', lookup })).rejects.toBeInstanceOf(run.AlreadyImported);
    expect(col.collectionState('dk').totals.copies).toBe(16);
    expect(run.previewRows('dk', CSV).before).toMatchObject({ copies: 16, mode: 'add' });
    await run.runCollectionImport('dk', CSV, { mode: 'replace', lookup });
    await run.runCollectionImport('dk', CSV, { mode: 'replace', lookup });
    expect(col.collectionState('dk').totals.copies).toBe(16);
    // On purpose, it can be added again.
    await run.runCollectionImport('dk', CSV, { mode: 'add', again: true, lookup });
    expect(col.collectionState('dk').totals.copies).toBe(32);
  });

  it('previews what a file holds without writing', async () => {
    const { col, run } = await load();
    const p = run.previewRows('dk', CSV);
    expect(p).toMatchObject({ format: 'Mythic Tools', copies: 16, proxies: 2, etched: 1, otherLanguage: 3, before: null });
    expect(p.locations).toEqual([
      { name: 'bulk', kind: 'box', copies: 14 }, { name: 'Trade', kind: 'binder', copies: 1 }, { name: 'Play', kind: 'binder', copies: 1 },
    ]);
    expect(col.collectionState('dk').totals.copies).toBe(0);
  });
});

describe('importing a Mythic Tools deck with its collection links', () => {
  it('makes the deck and takes the copies the linked list names, proxies included', async () => {
    const { db, col, run, mythic } = await load();
    const csv = zukoCollection();
    await run.runCollectionImport('dk', csv, { mode: 'replace', lookup });
    const before = col.collectionState('dk').totals.copies;

    const r = await mythic.importMythicDeck('dk', { name: 'Cooking with Zuko', list: LIST, linked: LINKED });
    expect(r.imported.applied).toBe(true);
    expect(r.created).toBe(true);
    expect(r.list.commander?.name).toBe('Fire Lord Zuko');
    expect(r.link).toMatchObject({ notLinked: [], otherBox: [], proxiesLinked: 2, proxiesMarked: 0, returned: 0 });

    const boards = new Map<string, number>();
    for (const c of db.cardsInList(r.list.id)) boards.set(c.board, (boards.get(c.board) ?? 0) + c.quantity);
    expect(boards.get('main')).toBe(99);
    expect(boards.get('side')).toBe(15);
    expect(boards.get('maybe')).toBe(15);

    const o = col.ownership({ id: r.list.id });
    expect(o.summary.inDeck + o.summary.proxies).toBe(r.link!.linked);
    expect(o.summary.proxies).toBe(2);
    const plateau = o.cards.find((h) => h.name === 'Plateau')!;
    expect(plateau.status).toBe('proxy');
    expect(plateau.pulledCopies).toEqual([expect.objectContaining({ fromLocation: 'bulk', variant: 'proxy' })]);
    const zuko = o.cards.find((h) => h.name === 'Fire Lord Zuko')!;
    expect(zuko).toMatchObject({ status: 'in-deck', commander: true });
    expect(zuko.pulledCopies[0]).toMatchObject({ finish: 'foil', fromLocation: 'bulk' });
    // Basic lands are not tracked: not to buy.
    expect(o.cards.filter((h) => h.basic).every((h) => h.status === 'basic' || h.status === 'in-deck')).toBe(true);
    // Every copy is still counted once: in a box or in the deck.
    const totals = col.collectionState('dk').totals;
    expect(totals.copies).toBe(before);
    expect(totals.inDecks).toBe(r.link!.linked);
  });

  it('updates a deck of the same name in place, keeping its plan, notes, tags and sections, and links the same again', async () => {
    const { db, col, run, mythic } = await load();
    await run.runCollectionImport('dk', zukoCollection(), { mode: 'replace', lookup });
    const deck = db.createList('dk', 'Cooking with Zuko', 'my notes', { kind: 'deck', commander: byId('tla-315')! });
    db.addCardToList(deck.id, byId('cmr-411')!, 1);
    const d = db.database();
    d.run(`INSERT INTO deck_tags (id, listId, name, color, status, origin, position, createdAt) VALUES ('t1', ?, 'Burn', '#f00', 'on', 'user', 0, 'x')`, [deck.id]);
    d.run(`INSERT INTO deck_card_tags (listId, cardKey, tagId, source) VALUES (?, 'o-Comet Storm', 't1', 'user')`, [deck.id]);
    const { addSection } = await import('./sections');
    const mine = addSection(deck.id, 'Ideas', 'list')!;
    db.addCardToList(deck.id, byId('sta-44')!, 1, 'nonfoil', mine.id);

    const first = await mythic.importMythicDeck('dk', { name: 'cooking with zuko', list: LIST, linked: LINKED });
    expect(first.created).toBe(false);
    expect(first.list.id).toBe(deck.id);
    expect(db.getList(deck.id, 'dk')!.note).toBe('my notes');
    expect(d.get('SELECT COUNT(*) AS n FROM deck_tags WHERE listId = ?', [deck.id])).toEqual({ n: 1 });
    expect(d.get('SELECT COUNT(*) AS n FROM deck_card_tags WHERE listId = ?', [deck.id])).toEqual({ n: 1 });
    expect(db.cardsInList(deck.id).some((c) => c.board === mine.id)).toBe(true);
    expect(db.listLists('dk', 'deck')).toHaveLength(1);

    const pulls = () => d.all('SELECT cardId, finish, fromLocation, variant, quantity FROM deck_pulls WHERE listId = ? ORDER BY cardId, variant', [deck.id]);
    const once = pulls();
    const second = await mythic.importMythicDeck('dk', { name: 'Cooking with Zuko', list: LIST, linked: LINKED });
    expect(second.link?.linked).toBe(first.link?.linked);
    expect(pulls()).toEqual(once);
    expect(col.collectionState('dk').totals.inDecks).toBe(first.link!.linked);
  });

  it('marks proxies on the deck when no proxy copy is in a box', async () => {
    const { col, run, mythic } = await load();
    // The collection without its proxy copies.
    await run.runCollectionImport('dk', zukoCollection().split('\n').filter((l) => !/,true,0,0,0,0,0,0,/.test(l)).join('\n'), { mode: 'replace', lookup });
    const r = await mythic.importMythicDeck('dk', { name: 'Cooking with Zuko', list: LIST, linked: LINKED });
    expect(r.link).toMatchObject({ proxiesLinked: 0, proxiesMarked: 2 });
    expect(r.link!.notLinked).toHaveLength(2);
    const o = col.ownership({ id: r.list.id });
    expect(o.cards.find((h) => h.name === 'Plateau')).toMatchObject({ status: 'proxy', proxies: 1, pulled: 0 });
  });

  it('changes nothing when a line of the list cannot be found', async () => {
    const { db, mythic } = await load();
    const r = await mythic.importMythicDeck('dk', { name: 'Broken', list: `${LIST}\n1 Not A Real Card (zzz) 1` });
    expect(r.imported.applied).toBe(false);
    expect(db.listLists('dk', 'deck')).toHaveLength(0);
  });
});

describe('sideboard copies', () => {
  it('keeps a sideboard copy the import put there, and gives back one merely cut there', async () => {
    const { db, col } = await load();
    const deck = db.createList('dk', 'Deck', '', { kind: 'deck', commander: byId('tla-315')! });
    const kept = byId('lci-274')!;
    const cut = byId('cmr-411')!;
    col.addToCollection('dk', kept, 1, 'nonfoil', 'bulk');
    col.addToCollection('dk', cut, 1, 'nonfoil', 'bulk');
    db.addCardToList(deck.id, kept, 1, 'nonfoil', 'side');
    db.addCardToList(deck.id, cut, 1);
    expect(col.pullExact(deck.id, { cardId: kept.id, finish: 'nonfoil', location: 'bulk' }, 1, true)).toBe(1);
    col.pull(deck.id, tagKeyOf(cut));
    expect(col.collectionState('dk').totals.inDecks).toBe(2);
    db.updateListCard(deck.id, cut.id, { board: 'side' });
    const left = col.deckCopies('dk').map((c) => c.card.name);
    expect(left).toEqual([kept.name]);
    expect(col.ownership({ id: deck.id }).cards.find((h) => h.name === kept.name)).toMatchObject({ board: 'side', status: 'in-deck' });
  });
});

const tagKeyOf = (card: ScryfallCard) => card.oracle_id ?? card.id;
