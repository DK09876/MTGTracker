/** A deck card's collection mark, its filter words, the summary lines and undoing a move. Pure. */

import { describe, expect, it } from 'vitest';

import type { Holding } from './collection';
import { holdingIndex, markOf, statusWord, summaryLine, tileLine, undoFor } from './copy-status';
import type { ScryfallCard } from './scryfall';

const card = (oracle: string) => ({ id: `${oracle}-1`, oracle_id: oracle, name: oracle }) as ScryfallCard;
const h = (over: Partial<Holding>): Holding => ({
  key: 'opt', name: 'Opt', need: 1, pulled: 0, proxies: 0, short: 1, status: 'missing', board: 'main',
  pulledCopies: [], inBoxes: [], inDecks: [], price: 0.25, cardIds: ['opt-1'], commander: false, basic: false, image: null, ...over,
});
const real = { cardId: 'opt-1', set: 'abc', number: '1', finish: 'nonfoil' as const, fromLocation: 'Blue box', variant: '', quantity: 1 };

describe('marks', () => {
  it('says what each status means, with the box or deck', () => {
    expect(markOf(h({ status: 'in-deck', pulled: 1, short: 0, pulledCopies: [real] }))).toMatchObject({ symbol: '✓', label: 'Yours', tip: 'Your copy is in this deck, taken from Blue box.' });
    expect(markOf(h({ status: 'proxy', proxies: 1, short: 0 }))).toMatchObject({ symbol: 'P', tip: 'Marked as a proxy: it fills the slot without a real copy.' });
    expect(markOf(h({ status: 'proxy', pulled: 1, proxies: 1, short: 0, pulledCopies: [{ ...real, variant: 'proxy', fromLocation: '' }] }))!.tip).toBe('A proxy copy from Unsorted stands in for it.');
    expect(markOf(h({ status: 'in-box', inBoxes: [{ cardId: 'opt-1', set: 'abc', number: '1', finish: 'nonfoil', location: 'Binder', variant: '', quantity: 2, exact: true }] })))
      .toMatchObject({ symbol: '↓', label: 'In your boxes', tip: 'A copy is free in Binder: pull it into this deck.' });
    expect(markOf(h({ status: 'in-other-deck', inDecks: [{ listId: 'b', listName: 'Vorthos', quantity: 1 }] }))).toMatchObject({ symbol: '⇄', tip: 'Your copies are in Vorthos.' });
    expect(markOf(h({}))).toMatchObject({ symbol: '$', label: 'To buy', tip: 'Not in your collection - about $0.25 each.' });
  });

  it('says how many are in already when some are', () => {
    expect(markOf(h({ need: 2, pulled: 1, short: 1, status: 'in-other-deck', inDecks: [{ listId: 'b', listName: 'Vorthos', quantity: 1 }] }))!.tip)
      .toBe('1 of 2 in this deck. Your copies are in Vorthos.');
  });

  it('gives a basic land, or a card with no holding, no mark', () => {
    expect(markOf(h({ status: 'basic', basic: true }))).toBeNull();
    expect(markOf(undefined)).toBeNull();
  });
});

describe('finding a card\'s holding', () => {
  const o = { cards: [h({ key: 'opt', status: 'in-deck' }), h({ key: 'sol', board: 'side', status: 'proxy' })], extras: [h({ key: 'bolt', board: 'maybe' })] };
  const of = holdingIndex(o);
  it('looks up by board and card, the companion on the main board, and a side card falls back to the 100', () => {
    expect(of({ card: card('opt'), board: 'main' })?.status).toBe('in-deck');
    expect(of({ card: card('sol'), board: 'side' })?.status).toBe('proxy');
    expect(of({ card: card('bolt'), board: 'maybe' })?.status).toBe('missing');
    expect(of({ card: card('opt'), board: 'side' })?.status).toBe('in-deck');
    expect(of({ card: card('sol'), board: 'side', slot: 'companion' })).toBeUndefined();
    expect(of({ card: card('opt'), board: 's-ideas' })).toBeUndefined();
    expect(holdingIndex(null)({ card: card('opt'), board: 'main' })).toBeUndefined();
  });
});

describe('filter words', () => {
  it('answers is:held, is:proxy, is:inbox, is:otherdeck and is:tobuy, and nothing for other words', () => {
    const words = ['held', 'proxy', 'inbox', 'otherdeck', 'tobuy'];
    const statuses = ['in-deck', 'proxy', 'in-box', 'in-other-deck', 'missing'] as const;
    statuses.forEach((status, i) => {
      expect(words.filter((w) => statusWord(h({ status }), w))).toEqual([words[i]]);
    });
    expect(statusWord(h({}), 'TOBUY')).toBe(true);
    expect(statusWord(undefined, 'held')).toBe(false);
    expect(statusWord(h({}), 'creature')).toBeUndefined();
  });
});

describe('summary lines', () => {
  const s = { need: 100, inDeck: 86, proxies: 2, inBoxes: 9, inOtherDecks: 1, missing: 0, basics: 2, missingCost: 0 };
  it('says the deck chip in DeckCollection\'s words', () => {
    expect(summaryLine(s)).toBe('86/100 yours · 2 proxies · 9 in your boxes · 1 in other decks · 0 to buy');
    expect(summaryLine({ ...s, proxies: 1 })).toContain('· 1 proxy ·');
  });
  it('puts proxies and to-buy on a tile only when there are some', () => {
    expect(tileLine(s)).toEqual({ owned: '86/100', extra: ['2 proxies'] });
    expect(tileLine({ ...s, proxies: 0, missing: 3 })).toEqual({ owned: '86/100', extra: ['3 to buy'] });
  });
});

describe('undo', () => {
  it('returns a pull, pulls a return back from the same box, gives a take back, and restores a proxy count', () => {
    expect(undoFor('a', { action: 'pull', key: 'opt', quantity: 1 }, h({}), 1)).toEqual({ listId: 'a', act: { action: 'return', key: 'opt', quantity: 1 } });
    expect(undoFor('a', { action: 'pull', key: 'opt' }, h({}), 0)).toBeNull();
    expect(undoFor('a', { action: 'return', key: 'opt' }, h({ pulled: 1, pulledCopies: [real] }), 1)).toEqual({
      listId: 'a', act: { action: 'pull', key: 'opt', quantity: 1, from: { cardId: 'opt-1', finish: 'nonfoil', location: 'Blue box', variant: '' } },
    });
    expect(undoFor('a', { action: 'take', fromListId: 'b', key: 'opt' }, h({}), 1)).toEqual({ listId: 'b', act: { action: 'take', fromListId: 'a', key: 'opt', quantity: 1 } });
    expect(undoFor('a', { action: 'proxies', cardId: 'opt-1', proxies: 2 }, h({ proxies: 1 }), 0)).toEqual({ listId: 'a', act: { action: 'proxies', cardId: 'opt-1', proxies: 1 } });
  });
});
