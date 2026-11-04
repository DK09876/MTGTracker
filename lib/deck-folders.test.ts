/**
 * Deck folders: one level, a deck in at most one, owned by a profile.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-folders-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe('deck folders', () => {
  it('files decks, keeps names unique per profile, and lets go of decks when a folder goes', async () => {
    const db = await import('./db');
    const f = await import('./deck-folders');
    const a = db.createList('kevin', 'A', '', { kind: 'deck' });
    const b = db.createList('kevin', 'B', '', { kind: 'deck' });
    const azula = f.createFolder('kevin', 'Azula')!;
    expect(f.createFolder('kevin', 'azula')).toBeNull();
    expect(f.createFolder('mia', 'Azula')).not.toBeNull();
    const fun = f.createFolder('kevin', 'Fun')!;

    f.placeDeck(a.id, azula.id);
    f.placeDeck(b.id, azula.id);
    f.placeDeck(b.id, fun.id);
    expect(f.foldersFor('kevin')).toEqual({ folders: [azula, fun], placed: { [a.id]: azula.id, [b.id]: fun.id } });

    expect(f.renameFolder('kevin', fun.id, 'AZULA')).toBe(false);
    expect(f.renameFolder('kevin', fun.id, 'Casual')).toBe(true);

    f.deleteFolder('kevin', azula.id);
    expect(f.foldersFor('kevin').placed).toEqual({ [b.id]: fun.id });
    // Another profile cannot delete it.
    f.deleteFolder('mia', fun.id);
    expect(f.foldersFor('kevin').folders.map((x) => x.name)).toEqual(['Casual']);

    // A deleted deck drops out; a copy goes where the deck was.
    const c = db.createList('kevin', 'C', '', { kind: 'deck' });
    f.copyPlacement(b.id, c.id);
    db.deleteList(b.id);
    expect(f.foldersFor('kevin').placed).toEqual({ [c.id]: fun.id });
    f.placeDeck(c.id, null);
    expect(f.foldersFor('kevin').placed).toEqual({});
  });
});
