/**
 * The suggestion log through Tune's own route, as the page uses it: what a
 * GET shows is logged once, staging is accepted, dismissing is refused (with
 * a reason), and applying leaves the rest ignored. Offline; own database.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScryfallCard } from './scryfall';
import type { TuneState } from './tune';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-suggestion-route-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.resetModules();
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

describe('logging through the Tune route', { timeout: 60_000 }, () => {
  it('logs what is shown once, and what the owner does with it', async () => {
    const db = await import('./db');
    db.addProfile('dk', 'DK');
    db.addProfile('kevin', 'Kevin');
    const plan = await import('./deck-plan');
    const list = db.createList('kevin', 'Prosper', '', { kind: 'deck', commander });
    db.addCardToList(list.id, card('Swamp', { type_line: 'Basic Land — Swamp', cmc: 0 }), 37);
    for (let i = 0; i < 66; i++) db.addCardToList(list.id, card(`Spell ${i}`, { cmc: i % 7 }));
    plan.changePlan(list.id, { confirm: true });
    // A review from Claude, so Cuts shows an AI group too.
    (await import('./cut-review')).saveReview(list.id, { at: new Date().toISOString(), model: 'claude-opus-5-5', instructions: '', over: 4, mode: 'top',
      items: ['Spell 1', 'Spell 2', 'Spell 3'].map((name) => ({ name, verdict: 'cut' as const, why: 'test' })) });

    const route = await import('../app/api/lists/[id]/tune/route');
    const params = { params: Promise.resolve({ id: list.id }) };
    const get = async () => (await route.GET(new Request(`http://x/api/lists/${list.id}/tune?intent=cuts&profile=kevin`), params)).json() as Promise<TuneState>;
    const post = (body: object) => route.POST(new Request(`http://x/api/lists/${list.id}/tune?profile=kevin`, { method: 'POST', body: JSON.stringify(body) }), params);

    const state = await get();
    await get();
    const log = await import('./suggestion-log');
    const shown = state.groups.reduce((n, g) => n + g.items.length, 0);
    expect(shown).toBeGreaterThan(3);
    expect((db.database().get('SELECT COUNT(*) AS n FROM suggestion_events') as { n: number }).n).toBe(shown);

    const claude = state.groups.find((g) => g.key === 'cuts:claude')!;
    await post({ action: 'stage', items: [claude.items[0]] });
    await post({ action: 'dismiss', keys: [claude.items[1].key] });
    expect(await (await post({ action: 'reason', key: claude.items[1].key, chip: 'part_of_plan' })).json()).toMatchObject({ saved: true });
    await post({ action: 'apply' });

    const byMethod = Object.fromEntries(log.rates().method.map((r) => [r.value, r]));
    expect(byMethod.ai).toMatchObject({ shown: 3, accepted: 1, refused: 1, ignored: 1, open: 0 });
    expect(byMethod.code.open).toBe(0);
    expect(log.rates().model.find((r) => r.value === 'claude-opus-5-5')).toBeTruthy();
    expect(log.rates().promptVersion.find((r) => r.value === 'cut-review-1')).toBeTruthy();
    expect(log.reasons()).toEqual([{ chip: 'part_of_plan', count: 1, typed: 0 }]);
  });

  it('keeps a group open while the owner works through it: show 10, dismiss 1, accept 1, reload', async () => {
    const db = await import('./db');
    db.addProfile('dk', 'DK');
    db.addProfile('kevin', 'Kevin');
    const plan = await import('./deck-plan');
    const list = db.createList('kevin', 'Prosper', '', { kind: 'deck', commander });
    db.addCardToList(list.id, card('Swamp', { type_line: 'Basic Land — Swamp', cmc: 0 }), 37);
    for (let i = 0; i < 72; i++) db.addCardToList(list.id, card(`Spell ${i}`, { cmc: i % 7 }));
    plan.changePlan(list.id, { confirm: true });
    const names = Array.from({ length: 10 }, (_, i) => `Spell ${i}`);
    (await import('./cut-review')).saveReview(list.id, { at: new Date().toISOString(), model: 'claude-opus-5-5', instructions: '', over: 10, mode: 'top',
      items: names.map((name) => ({ name, verdict: 'cut' as const, why: 'test' })) });
    const route = await import('../app/api/lists/[id]/tune/route');
    const params = { params: Promise.resolve({ id: list.id }) };
    const get = async () => (await route.GET(new Request(`http://x/api/lists/${list.id}/tune?intent=cuts&profile=kevin`), params)).json() as Promise<TuneState>;
    const post = (body: object) => route.POST(new Request(`http://x/api/lists/${list.id}/tune?profile=kevin`, { method: 'POST', body: JSON.stringify(body) }), params);

    const first = (await get()).groups.find((g) => g.key === 'cuts:claude')!;
    expect(first.items).toHaveLength(10);
    await post({ action: 'dismiss', keys: [first.items[0].key] });
    await get();
    await post({ action: 'stage', items: [first.items[1]] });
    await get();
    // A ★ keep elsewhere takes one card out of the group (the cut guards): the rest must stay open, not become "ignored".
    await post({ action: 'keep', cardId: first.items[9].cut!.id, keep: true });
    const after = (await get()).groups.find((g) => g.key === 'cuts:claude')!;
    expect(after.items).toHaveLength(9);
    await get();

    const log = await import('./suggestion-log');
    const ai = log.rates().method.find((r) => r.value === 'ai')!;
    expect(ai).toMatchObject({ shown: 10, refused: 1, accepted: 1, open: 8, ignored: 0 });
    // Ranks stay as first shown.
    expect(log.rates().rank.filter((r) => ['1', '2'].includes(r.value)).map((r) => r.shown)).toEqual([expect.any(Number), expect.any(Number)]);
  });
});
