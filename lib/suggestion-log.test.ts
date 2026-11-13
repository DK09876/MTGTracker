/**
 * The suggestion log: shown once per distinct group, outcomes by key,
 * untouched suggestions ignored when a group closes, regret from the deck's
 * history, rates, the export without names or typed reasons, and nothing
 * at all for a profile that does not share. Each test has its own database.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScryfallCard } from './scryfall';
import type { ShownBatch } from './suggestion-log';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-suggestion-log-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

const card = (name: string) => ({ id: name, oracle_id: `o-${name}`, name, type_line: 'Artifact', cmc: 2, legalities: { commander: 'legal' } }) as ScryfallCard;
const batch = (key: string, names: string[], over: Partial<ShownBatch> = {}): ShownBatch => ({
  key, task: 'trim', method: 'code', deckHash: 'h1',
  items: names.map((n) => ({ key: `k:${n}`, cardOut: { oracleId: `o-${n}`, name: n }, reasonShown: `why ${n}` })), ...over,
});

async function setup() {
  const db = await import('./db');
  db.addProfile('dk', 'DK');
  const list = db.createList('dk', 'Deck', '', { kind: 'deck' });
  const log = await import('./suggestion-log');
  return { db, log, list };
}
const count = async (sql: string) => ((await import('./db')).database().get(sql) as { n: number }).n;

describe('the suggestion log', { timeout: 30_000 }, () => {
  it('starts sharing on for profiles that exist, off for new ones', async () => {
    const { db, log } = await setup();
    expect(log.shareOn('dk')).toBe(true);
    db.addProfile('newbie', 'New');
    expect(log.shareOn('newbie')).toBe(false);
    log.setShare('dk', false);
    expect(log.shareOn('dk')).toBe(false);
  });

  it('keeps a group open while it is shown, adding only suggestions new to it', async () => {
    const { log, list } = await setup();
    log.logShown('dk', list.id, 'tune:cuts:', [batch('tune:cuts:a', ['A', 'B'])]);
    log.logShown('dk', list.id, 'tune:cuts:', [batch('tune:cuts:a', ['A', 'B'])]);
    expect(await count('SELECT COUNT(*) AS n FROM suggestion_events')).toBe(2);
    // B drops out, C comes in: one new row, nothing closed, nothing ignored.
    log.logShown('dk', list.id, 'tune:cuts:', [batch('tune:cuts:a', ['A', 'C'])]);
    expect(await count('SELECT COUNT(*) AS n FROM suggestion_events')).toBe(3);
    expect(await count('SELECT COUNT(*) AS n FROM suggestion_batches')).toBe(1);
    expect(await count(`SELECT COUNT(*) AS n FROM suggestion_outcomes`)).toBe(0);
    expect(await count(`SELECT rank AS n FROM suggestion_events WHERE cardOutName = 'C'`)).toBe(2);
  });

  it('ignores an AI round’s untouched suggestions when a new round replaces it', async () => {
    const { log, list } = await setup();
    const ai = (key: string, names: string[]) => batch(key, names, { method: 'ai', model: 'claude-opus-5-5' });
    log.logShown('dk', list.id, 'tune:cuts:', [ai('tune:cuts:claude@1', ['A', 'B'])]);
    log.logOutcome(list.id, ['k:A'], 'accepted');
    log.logShown('dk', list.id, 'tune:cuts:', [ai('tune:cuts:claude@2', ['C'])]);
    expect(log.rates().method[0]).toMatchObject({ shown: 3, accepted: 1, ignored: 1, open: 1 });
  });

  it('leaves a rules list’s untouched suggestions undecided when the list goes away', async () => {
    const { log, list } = await setup();
    log.logShown('dk', list.id, 'tune:cuts:', [batch('tune:cuts:curve', ['A', 'B'])]);
    log.logShown('dk', list.id, 'tune:cuts:', []);
    expect(await count('SELECT COUNT(*) AS n FROM suggestion_batches WHERE closedAt IS NOT NULL')).toBe(1);
    expect(log.rates().method[0]).toMatchObject({ shown: 2, ignored: 0, open: 2 });
  });

  it('records ranks in the order shown', async () => {
    const { log, list } = await setup();
    log.logShown('dk', list.id, 'tune:cuts:', [batch('tune:cuts:a', ['A', 'B', 'C'])]);
    const ranks = (await import('./db')).database().all('SELECT cardOutName, rank FROM suggestion_events ORDER BY rank');
    expect(ranks).toEqual([{ cardOutName: 'A', rank: 1 }, { cardOutName: 'B', rank: 2 }, { cardOutName: 'C', rank: 3 }]);
  });

  it('closes a group that is no longer shown under the same place', async () => {
    const { log, list } = await setup();
    log.logShown('dk', list.id, 'tune:swaps:', [batch('tune:swaps:x', ['A']), batch('tune:swaps:y', ['B'])]);
    log.logShown('dk', list.id, 'tune:swaps:', [batch('tune:swaps:x', ['A'])]);
    expect(await count('SELECT COUNT(*) AS n FROM suggestion_batches WHERE closedAt IS NULL')).toBe(1);
  });

  it('records accept, refuse with a reason, and takes an outcome back', async () => {
    const { log, list } = await setup();
    log.logShown('dk', list.id, 'tune:cuts:', [batch('tune:cuts:a', ['A', 'B', 'C'])]);
    log.logOutcome(list.id, ['k:A'], 'accepted');
    log.logOutcome(list.id, ['k:B'], 'refused');
    expect(log.logReason(list.id, 'k:B', 'pet_card', 'I love the art')).toBe(true);
    log.logOutcome(list.id, ['k:C'], 'accepted');
    log.clearOutcome(list.id, ['k:C']);
    const r = log.rates();
    expect(r.task[0]).toMatchObject({ value: 'trim', shown: 3, accepted: 1, refused: 1, open: 1, acceptRate: 0.5 });
    expect(log.reasons()).toEqual([{ chip: 'pet_card', count: 1, typed: 1 }]);
    // Applying closes the group: the open one is ignored.
    log.closeAll(list.id, 'tune:');
    expect(log.rates().task[0]).toMatchObject({ ignored: 1, open: 0, acceptRate: 1 / 3 });
  });

  it('logs nothing for a profile that does not share', async () => {
    const { log, list } = await setup();
    log.setShare('dk', false);
    log.logShown('dk', list.id, 'tune:cuts:', [batch('tune:cuts:a', ['A'])]);
    log.logConversation('dk', list.id, 'plan', 'question_asked', 'What is this deck for?');
    expect(await count('SELECT COUNT(*) AS n FROM suggestion_events')).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM conversation_events')).toBe(0);
  });

  it('exports with no names and no typed reasons', async () => {
    const { log, list } = await setup();
    log.logShown('dk', list.id, 'tune:cuts:', [batch('tune:cuts:a', ['A'])]);
    log.logOutcome(list.id, ['k:A'], 'refused', { chip: 'other', text: 'My friend Kevin hates it' });
    log.logConversation('dk', list.id, 'plan', 'question_answered', 'Secret answer');
    const out = JSON.stringify(log.exportLog());
    expect(out).not.toContain('Kevin');
    expect(out).not.toContain('Secret answer');
    expect(out).not.toContain('"dk"');
    expect(out).not.toContain(list.id);
    expect(log.exportLog().events[0]).toMatchObject({ reasonChip: 'other', typedReason: true, profile: expect.stringMatching(/^p-/), deck: expect.stringMatching(/^d-/) });
  });

  it('marks a cut regretted when the card comes back to the main board within two weeks', async () => {
    const { db, log, list } = await setup();
    const history = await import('./deck-history');
    for (const n of ['A', 'B']) db.addCardToList(list.id, card(n));
    log.logShown('dk', list.id, 'tune:cuts:', [batch('tune:cuts:a', ['A', 'B'])]);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-01T10:00:00Z'));
    log.logOutcome(list.id, ['k:A', 'k:B'], 'accepted');
    vi.setSystemTime(new Date('2026-11-01T10:05:00Z'));
    await history.recorded(list.id, { profile: 'dk' }, 'tune', 'Applied', () => { db.updateListCard(list.id, 'A', { board: 'side' }); db.updateListCard(list.id, 'B', { board: 'side' }); });
    // A comes back after three days; B after twenty.
    vi.setSystemTime(new Date('2026-11-04T10:00:00Z'));
    await history.recorded(list.id, { profile: 'dk' }, 'edit', 'Back', () => db.updateListCard(list.id, 'A', { board: 'main' }));
    vi.setSystemTime(new Date('2026-11-21T10:00:00Z'));
    await history.recorded(list.id, { profile: 'dk' }, 'edit', 'Back', () => db.updateListCard(list.id, 'B', { board: 'main' }));
    expect(log.rates().task[0]).toMatchObject({ accepted: 2, regretted: 1 });
  });
});

describe('the deck hash', () => {
  it('ignores printing and order, and counts copies', async () => {
    const { deckHash, deckKeys, cardsChanged } = await import('./deck-hash');
    const a = [{ card: card('A'), quantity: 1 }, { card: card('Island'), quantity: 30 }];
    const b = [{ card: { ...card('Island'), id: 'other-printing' }, quantity: 30 }, { card: card('A'), quantity: 1 }];
    expect(deckHash(null, a)).toBe(deckHash(null, b));
    expect(deckHash(null, a)).not.toBe(deckHash(null, [{ card: card('A'), quantity: 1 }, { card: card('Island'), quantity: 29 }]));
    expect(cardsChanged(deckKeys(null, a), deckKeys(null, [{ card: card('B'), quantity: 1 }, { card: card('Island'), quantity: 29 }]))).toBe(3);
  });
});
