/**
 * The combo service's answers are shared while a call is on its way and kept
 * in the database, so a restart doesn't ask again; and an AI step's price
 * before it runs follows the deck's size. Fetch is a stub; nothing calls out.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScryfallCard } from './scryfall';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-spellbook-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.stubEnv('MTG_CARDS_DB_PATH', join(dir, 'cards.db'));
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

const deck = { commanders: ['Azula'], main: [{ name: 'Sol Ring', quantity: 1 }] };

describe('combo answers', () => {
  it('shares a call on its way, and keeps the answer across a restart', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ results: { included: [], almostIncluded: [] } }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    let sb = await import('./spellbook');
    await Promise.all([sb.combosInDeck(deck), sb.combosInDeck(deck)]);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.resetModules();
    sb = await import('./spellbook');
    await sb.combosInDeck(deck);
    expect(fetch).toHaveBeenCalledTimes(1);
    // A different list is asked for.
    await sb.combosInDeck({ ...deck, main: [...deck.main, { name: 'Arcane Signet', quantity: 1 }] });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps nothing when the call fails', async () => {
    const fetch = vi.fn(async () => { throw new Error('offline'); });
    vi.stubGlobal('fetch', fetch);
    const sb = await import('./spellbook');
    await expect(sb.combosInDeck(deck)).rejects.toThrow();
    await expect(sb.combosInDeck(deck)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('the price before a run', { timeout: 60_000 }, () => {
  const card = (name: string) => ({ id: name, oracle_id: `o-${name}`, name, type_line: 'Instant', cmc: 1, legalities: { commander: 'legal' } }) as ScryfallCard;
  it('follows the deck’s size, then this deck’s own runs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const db = await import('./db');
    db.addProfile('dk', 'DK');
    const big = db.createList('dk', 'Big', '', { kind: 'deck', commander: card('Azula') });
    for (let i = 0; i < 119; i++) db.addCardToList(big.id, card(`S${i}`));
    const small = db.createList('dk', 'Small', '', { kind: 'deck', commander: card('Azula') });
    for (let i = 0; i < 15; i++) db.addCardToList(small.id, card(`S${i}`));
    const { estimateCost } = await import('./ai-estimate');
    const b = estimateCost(big.id, 'plan suggestions');
    const s = estimateCost(small.id, 'plan suggestions');
    // Measured with Opus: 13¢ on 120 cards, 6¢ on 16.
    expect(Math.round(b.usd * 100)).toBe(13);
    expect(Math.round(s.usd * 100)).toBe(6);
    expect(b.measured).toBe(false);
    db.database().run(`INSERT INTO ai_calls (at, profileId, feature, label, step, model, inputTokens, outputTokens, cost, outcome) VALUES (?, 'dk', 'tagging', 'Small', 'plan suggestions', 'claude-opus-5-5', 1, 1, 0.07, 'ok')`, [new Date().toISOString()]);
    expect(estimateCost(small.id, 'plan suggestions')).toEqual({ usd: 0.07, measured: true });
    // Another deck's run is scaled to this deck's size, still an estimate.
    const o = estimateCost(big.id, 'plan suggestions');
    expect(o.measured).toBe(false);
    expect(o.usd).toBeCloseTo(0.07 * (0.4 + 0.6 * 1.2), 5);
  });
});
