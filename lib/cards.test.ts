/**
 * Getting a card (lib/cards.ts): the app's own cards first, then the weekly copy, then Scryfall for a card newer
 * than both, stored so the next ask is local. Each test has its own database; Scryfall is a stand-in.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScryfallCard } from './scryfall';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-cards-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.stubEnv('MTG_CARDS_DB_PATH', join(dir, 'cards.db'));
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

const card = (name: string, over: Partial<ScryfallCard> = {}) =>
  ({ id: `id-${name}`, oracle_id: `o-${name}`, name, type_line: 'Artifact', cmc: 2, mana_cost: '{2}', oracle_text: 'Text.', color_identity: [], legalities: { commander: 'legal' }, prices: { usd: '1.00' }, ...over }) as ScryfallCard;

/** Scryfall's collection endpoint, answering for the cards given; every request is counted. */
function scryfall(known: ScryfallCard[]) {
  const asked: string[][] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { body?: string }) => {
    const ids = (JSON.parse(init?.body ?? '{}') as { identifiers?: Array<{ name: string }> }).identifiers ?? [];
    asked.push(ids.map((i) => i.name));
    const data = known.filter((c) => ids.some((i) => i.name.toLowerCase() === c.name.toLowerCase()));
    return new Response(JSON.stringify({ data, not_found: ids.filter((i) => !data.some((c) => c.name.toLowerCase() === i.name.toLowerCase())) }), { status: 200 });
  }));
  return asked;
}

describe('getting a card', () => {
  it('answers from the app’s own cards without reaching Scryfall, by any spelling of the name', async () => {
    const db = await import('./db');
    db.storeCard(card('Forsaken Monument'));
    db.storeCard(card('Delver of Secrets // Insectile Aberration'));
    const asked = scryfall([]);
    const { findCards } = await import('./cards');
    const found = await findCards(['forsaken monument', 'Delver of Secrets']);
    expect(found.get('Forsaken Monument')?.name).toBe('Forsaken Monument');
    expect(found.get('FORSAKEN MONUMENT')?.name).toBe('Forsaken Monument');
    expect(found.get('Delver of Secrets // Insectile Aberration')?.name).toBe('Delver of Secrets // Insectile Aberration');
    expect(asked).toEqual([]);
  });

  it('reaches Scryfall only for a card the app doesn’t hold, stores it, and asks only once', async () => {
    const asked = scryfall([card('Brand New Card')]);
    const { findCards, cardsNamed } = await import('./cards');
    expect((await findCards(['Brand New Card', 'No Such Card'])).get('Brand New Card')?.name).toBe('Brand New Card');
    expect(asked).toEqual([['Brand New Card', 'No Such Card']]);
    // Stored: the next ask is local, and the weekly refresh sees it (it re-prices every stored card).
    expect(cardsNamed(['brand new card']).get('Brand New Card')?.id).toBe('id-Brand New Card');
    await findCards(['Brand New Card']);
    expect(asked).toHaveLength(1);
  });

  it('never matches a similar name: Monument is not Forsaken Monument', async () => {
    const db = await import('./db');
    db.storeCard(card('Forsaken Monument'));
    scryfall([]);
    const { findCards } = await import('./cards');
    expect((await findCards(['Monument'])).get('Monument')).toBeUndefined();
  });

  it('a card by id: the stored copy, else Scryfall’s, stored', async () => {
    const db = await import('./db');
    db.storeCard(card('Sol Ring'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(card('Fresh')), { status: 200 })));
    const { cardById, cardsNamed } = await import('./cards');
    expect((await cardById('id-Sol Ring'))?.name).toBe('Sol Ring');
    expect((await cardById('id-Fresh'))?.name).toBe('Fresh');
    expect(cardsNamed(['Fresh']).get('Fresh')).toBeTruthy();
  });
});
