/**
 * Reading cards from the Pi's copy of Scryfall's cards.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { Database } from 'node-sqlite3-wasm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-cards-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

async function withCards(cards: Array<Record<string, unknown>>) {
  const store = await import('./card-store');
  store.localCards(['nothing yet']); // makes the table
  const db = new Database(join(dir, 'cards.db'));
  for (const c of cards) {
    db.run('INSERT INTO oracle_cards (oracleId, name, nameKey, data) VALUES (?, ?, ?, ?)',
      [String(c.oracle_id), String(c.name), String(c.name).split(' // ')[0].toLowerCase(), JSON.stringify(c)]);
  }
  db.close();
  return store;
}

describe('the local copy', () => {
  const azula = { id: 'a1', oracle_id: 'o1', name: 'Fire Lord Azula', layout: 'normal', type_line: 'Legendary Creature — Human Noble', legalities: { commander: 'legal' }, edhrec_rank: 900 };
  const artCard = { id: 'a2', oracle_id: 'o2', name: 'Fire Lord Azula // Fire Lord Azula', layout: 'art_series', type_line: 'Card // Card' };
  const sliver = { id: 's1', oracle_id: 'o3', name: 'Sliver Overlord', layout: 'normal', type_line: 'Legendary Creature — Sliver Mutant', legalities: { commander: 'legal' }, edhrec_rank: 2000 };
  const hivelord = { id: 's2', oracle_id: 'o4', name: 'Sliver Hivelord', layout: 'normal', type_line: 'Legendary Creature — Sliver', legalities: { commander: 'legal' }, edhrec_rank: 1500 };
  const queen = { id: 's3', oracle_id: 'o5', name: 'The First Sliver', layout: 'normal', type_line: 'Legendary Creature — Sliver', legalities: { commander: 'legal' }, edhrec_rank: 100 };

  it('finds the playable card when an art card shares its name', async () => {
    const store = await withCards([azula, artCard]);
    expect(store.localCards(['Fire Lord Azula']).map((c) => c.id)).toEqual(['a1']);
  });

  it('suggests commanders whose names start with what was typed first, then the shortest names', async () => {
    const store = await withCards([azula, artCard, sliver, hivelord, queen]);
    expect(store.localCommanders('sliver').map((c) => c.name)).toEqual(['Sliver Hivelord', 'Sliver Overlord', 'The First Sliver']);
    expect(store.localCommanders('azula').map((c) => c.id)).toEqual(['a1']);
  });
});
