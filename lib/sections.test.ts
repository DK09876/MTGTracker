/**
 * A deck's sections and its second commander and companion, stored. Each
 * test gets its own database file, as in db.test.ts.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cutBoard } from './sections-shared';
import type { ScryfallCard } from './scryfall';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-sec-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

const load = async () => ({ db: await import('./db'), sec: await import('./sections'), slots: await import('./slots') });
const card = (name: string, over: Partial<ScryfallCard> = {}) =>
  ({ id: name, oracle_id: `o-${name}`, name, type_line: 'Instant', legalities: { commander: 'legal' }, prices: { usd: '1.00' }, ...over }) as ScryfallCard;
const tymna = card('Tymna the Weaver', { color_identity: ['W', 'B'], type_line: 'Legendary Creature — Human', oracle_text: 'Partner (You can have two commanders if both have partner.)' });
const thrasios = card('Thrasios, Triton Hero', { color_identity: ['G', 'U'], type_line: 'Legendary Creature — Merfolk', oracle_text: 'Partner (You can have two commanders if both have partner.)' });
const kraum = card('Kraum, Ludevic\'s Opus', { color_identity: ['U', 'R'], type_line: 'Legendary Creature — Zombie', oracle_text: 'Partner (You can have two commanders if both have partner.)' });
const lurrus = card('Lurrus of the Dream-Den', { color_identity: ['W', 'B'], type_line: 'Legendary Creature — Cat', keywords: ['Companion'], oracle_text: 'Companion — Each permanent card in your starting deck has mana value 2 or less.' });

describe('sections', () => {
  it('starts every deck with a Maybeboard to try and a Sideboard for cuts, with no rows needed', async () => {
    const { db, sec } = await load();
    const deck = db.createList('dk', 'Deck', '', { kind: 'deck', commander: tymna });
    const sections = sec.sectionsOf(deck.id);
    expect(sections.map((s) => [s.id, s.name, s.purpose])).toEqual([['maybe', 'Maybeboard', 'in'], ['side', 'Sideboard', 'out']]);
    expect(cutBoard(sections)).toBe('side');
    expect(sec.hasBoard(deck.id, 'main')).toBe(true);
    expect(sec.hasBoard(deck.id, 's-nope')).toBe(false);
  });

  it('adds, renames and re-purposes sections, and cuts follow the "came out" one', async () => {
    const { db, sec } = await load();
    const deck = db.createList('dk', 'Deck', '', { kind: 'deck', commander: tymna });
    const wish = sec.addSection(deck.id, '  Wishlist  ', 'list')!;
    expect(wish.id).toMatch(/^s-/);
    expect(wish.name).toBe('Wishlist');
    expect(sec.addSection(deck.id, '   ', 'list')).toBeNull();
    const cuts = sec.addSection(deck.id, 'Old cuts', 'out')!;
    sec.changeSection(deck.id, 'side', { purpose: 'list', name: 'Tokens' });
    const sections = sec.sectionsOf(deck.id);
    expect(sections.map((s) => s.name)).toEqual(['Maybeboard', 'Tokens', 'Wishlist', 'Old cuts']);
    expect(cutBoard(sections)).toBe(cuts.id);
    expect(sec.hasBoard(deck.id, wish.id)).toBe(true);
  });

  it('deletes only the owner\'s own sections, moving their cards to the Maybeboard', async () => {
    const { db, sec } = await load();
    const deck = db.createList('dk', 'Deck', '', { kind: 'deck', commander: tymna });
    const wish = sec.addSection(deck.id, 'Wishlist', 'list')!;
    db.addCardToList(deck.id, card('Opt'), 1, 'nonfoil', wish.id);
    expect(sec.deleteSection(deck.id, 'side')).toBeNull();
    expect(sec.deleteSection(deck.id, wish.id)).toBe(1);
    expect(db.cardsInList(deck.id)[0].board).toBe('maybe');
    expect(sec.sectionsOf(deck.id)).toHaveLength(2);
  });

  it('keeps the owner\'s sections when the list is replaced from text, unless the text has the card', async () => {
    const { db, sec } = await load();
    const deck = db.createList('dk', 'Deck', '', { kind: 'deck', commander: tymna });
    const wish = sec.addSection(deck.id, 'Wishlist', 'list')!;
    db.addCardToList(deck.id, card('Opt'), 1, 'nonfoil', wish.id);
    db.addCardToList(deck.id, card('Brainstorm'), 1, 'nonfoil', wish.id);
    db.addCardToList(deck.id, card('Ponder'), 1, 'nonfoil', 'main');
    db.replaceListCards(deck.id, [{ card: card('Opt'), quantity: 1 }, { card: card('Preordain'), quantity: 1 }]);
    const now = db.cardsInList(deck.id).map((c) => [c.card.name, c.board]).sort();
    expect(now).toEqual([['Brainstorm', wish.id], ['Opt', 'main'], ['Preordain', 'main']]);
  });
});

describe('second commander and companion', () => {
  it('counts a second commander in the 100 and a companion outside it', async () => {
    const { db } = await load();
    const deck = db.createList('dk', 'Deck', '', { kind: 'deck', commander: tymna });
    db.addCardToList(deck.id, thrasios, 1, 'nonfoil', 'maybe');
    db.addCardToList(deck.id, lurrus, 1, 'nonfoil', 'main');
    db.addCardToList(deck.id, card('Plains', { type_line: 'Basic Land — Plains' }), 97, 'nonfoil', 'main');
    expect(db.setSlot(deck.id, thrasios.id, 'partner')).toBe(true);
    expect(db.setSlot(deck.id, lurrus.id, 'companion')).toBe(true);
    const cards = db.cardsInList(deck.id);
    expect(cards.find((c) => c.card.id === thrasios.id)).toMatchObject({ board: 'main', slot: 'partner' });
    expect(cards.find((c) => c.card.id === lurrus.id)).toMatchObject({ board: 'side', slot: 'companion' });
    // Tymna + Thrasios + 97 Plains: the companion isn't one of them.
    expect(db.getList(deck.id, 'dk')!.totalCards).toBe(99);
  });

  it('keeps one of each, and a card moved off its board stops being one', async () => {
    const { db } = await load();
    const deck = db.createList('dk', 'Deck', '', { kind: 'deck', commander: tymna });
    db.addCardToList(deck.id, thrasios, 1);
    db.addCardToList(deck.id, kraum, 1);
    db.setSlot(deck.id, thrasios.id, 'partner');
    db.setSlot(deck.id, kraum.id, 'partner');
    expect(db.cardsInList(deck.id).filter((c) => c.slot === 'partner').map((c) => c.card.name)).toEqual([kraum.name]);
    db.updateListCard(deck.id, kraum.id, { board: 'maybe' });
    expect(db.cardsInList(deck.id).some((c) => c.slot)).toBe(false);
  });

  it('after an import, takes the clear ones and keeps a question for the rest', async () => {
    const { db, slots } = await load();
    const deck = db.createList('dk', 'Deck', '', { kind: 'deck', commander: tymna });
    db.addCardToList(deck.id, thrasios, 1);
    db.addCardToList(deck.id, kraum, 1);
    db.addCardToList(deck.id, lurrus, 1, 'nonfoil', 'side');
    slots.settleSlots(deck.id);
    expect(db.cardsInList(deck.id).find((c) => c.slot === 'companion')?.card.name).toBe(lurrus.name);
    expect(db.slotQuestions(deck.id)).toEqual([{ kind: 'partner', options: [kraum.id, thrasios.id].sort((a, b) => (a < b ? -1 : 1)) }]);
    // A list that named its second commander settles it.
    slots.settleSlots(deck.id, new Map([[thrasios.id, 'commander']]));
    expect(db.cardsInList(deck.id).find((c) => c.slot === 'partner')?.card.name).toBe(thrasios.name);
    expect(db.slotQuestions(deck.id)).toEqual([]);
  });
});
