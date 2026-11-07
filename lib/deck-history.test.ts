/**
 * A deck's history: each change recorded with the deck before it, undo
 * that puts it back exactly, batches that undo as one, and snapshots that
 * compare and restore. A real database in a temporary file.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 20_000 });

import type { ScryfallCard } from './scryfall';

const card = (name: string, id: string, oracle = `o-${id}`): ScryfallCard =>
  ({ id, oracle_id: oracle, name, set: 'tst', collector_number: id, type_line: 'Instant', legalities: { commander: 'legal' } }) as ScryfallCard;
const bolt = card('Lightning Bolt', 'bolt');
const ring = card('Sol Ring', 'ring');
const brainstorm = card('Brainstorm', 'bs');
const kratos = card('Kratos, God of War', 'kratos');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-history-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

async function setup() {
  const db = await import('./db');
  const h = await import('./deck-history');
  db.addProfile('dk', 'DK');
  const list = db.createList('dk', 'Test', '', { kind: 'deck', commander: kratos });
  db.addCardToList(list.id, bolt, 1);
  db.addCardToList(list.id, ring, 1);
  const who = { profile: 'dk' };
  const rows = () => db.cardsInList(list.id).map((c) => [c.card.name, c.quantity, c.board]);
  return { db, h, id: list.id, who, rows };
}

describe('deck history', () => {
  it('records a change with what it did, and nothing when nothing changed', async () => {
    const { db, h, id, who } = await setup();
    const { change } = await h.recorded(id, who, 'edit', '', () => db.updateListCard(id, 'bolt', { board: 'maybe' }));
    expect(change?.label).toBe('Moved Lightning Bolt');
    expect(change?.diff.moved).toEqual([{ cardId: 'bolt', name: 'Lightning Bolt', from: 'main', to: 'maybe' }]);
    const none = await h.recorded(id, who, 'edit', '', () => db.updateListCard(id, 'bolt', { board: 'maybe' }));
    expect(none.change).toBeNull();
    expect(h.changes(id)).toHaveLength(1);
  });

  it('undoes the last change exactly, and the undo can itself be undone', async () => {
    const { db, h, id, who, rows } = await setup();
    const start = rows();
    await h.recorded(id, who, 'remove', '', () => db.removeCardFromList(id, 'ring'));
    await h.recorded(id, who, 'edit', '', () => db.setQuantity(id, 'bolt', 3));
    await h.undoLast(id, who);
    expect(rows()).toEqual([['Lightning Bolt', 1, 'main']]);
    await h.undoLast(id, who);
    expect(rows()).toEqual(start);
  });

  it('undoes a batch as one', async () => {
    const { db, h, id, who, rows } = await setup();
    const start = rows();
    const batch = { ...who, batch: 'b1' };
    await h.recorded(id, batch, 'edit', '', () => db.updateListCard(id, 'bolt', { board: 'side' }));
    await h.recorded(id, batch, 'edit', '', () => db.updateListCard(id, 'ring', { board: 'side' }));
    const undo = await h.undoLast(id, who);
    expect(undo?.label).toBe('Undid 2 changes');
    expect(rows()).toEqual(start);
  });

  it('puts tags and the commander back too', async () => {
    const { db, h, id, who } = await setup();
    const tag = db.createTag(id, { name: 'Burn', color: '#e0b64a', status: 'accepted', origin: 'manual' });
    await h.recorded(id, who, 'tag', '', () => db.setCardTag(id, 'o-bolt', tag.id, true));
    await h.recorded(id, who, 'commander', '', () => db.setCommander(id, ring));
    await h.undoLast(id, who);
    expect(db.getList(id, 'dk')!.commander?.name).toBe('Kratos, God of War');
    await h.undoLast(id, who);
    expect(db.deckTags(id).cardTags.filter((c) => c.on)).toEqual([]);
  });

  it('restores to before an older change, undoing what came after', async () => {
    const { db, h, id, who, rows } = await setup();
    const first = await h.recorded(id, who, 'add', '', () => db.addCardToList(id, brainstorm, 1));
    await h.recorded(id, who, 'remove', '', () => db.removeCardFromList(id, 'bolt'));
    await h.restoreBefore(id, first.change!.id, who);
    expect(rows()).toEqual([['Lightning Bolt', 1, 'main'], ['Sol Ring', 1, 'main']]);
    expect(h.changes(id).filter((c) => c.undone)).toHaveLength(2);
  });

  it('compares a snapshot with now and restores it', async () => {
    const { db, h, id, who, rows } = await setup();
    const start = rows();
    const snap = h.takeSnapshot(id, 'Before the upgrade', who);
    expect(snap.size).toBe(3);
    db.addCardToList(id, brainstorm, 1);
    db.updateListCard(id, 'ring', { board: 'maybe' });
    db.setQuantity(id, 'bolt', 0);
    const diff = h.compareSnapshot(id, snap.id)!;
    expect(h.countLine(diff)).toBe('+1, −1, 1 moved');
    await h.restoreSnapshot(id, snap.id, who);
    expect(rows()).toEqual(start);
    expect(h.changes(id)[0].label).toBe('Restored “Before the upgrade”');
  });
});

describe('saving a list over the deck', () => {
  it('previews what would change without changing anything', async () => {
    const { db, id } = await setup();
    vi.doMock('./scryfall', async (original) => ({
      ...(await original<typeof import('./scryfall')>()),
      collection: async () => ({ cards: [ring, brainstorm, kratos], notFound: [] }),
    }));
    vi.doMock('./card-store', async (original) => ({ ...(await original<typeof import('./card-store')>()), localCards: () => [] }));
    const { previewReplace } = await import('./import-into');
    const before = db.cardsInList(id).length;
    const { diff } = await previewReplace(db.getList(id, 'dk')!, 'Commander\n1 Kratos, God of War\nDeck\n1 Sol Ring\nMaybeboard\n1 Brainstorm');
    const { countLine } = await import('./deck-history');
    expect(countLine(diff)).toBe('+1, −1');
    expect(diff.added.map((c) => c.name)).toEqual(['Brainstorm']);
    expect(diff.removed.map((c) => c.name)).toEqual(['Lightning Bolt']);
    expect(db.cardsInList(id).length).toBe(before);
  });
});
