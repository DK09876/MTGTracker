/**
 * The check every list route makes before touching a list.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-route-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

const request = (query: string) => new Request(`http://localhost/api/lists/x${query}`);

describe('requireList', () => {
  it('lets a profile reach its own list, and nobody else\'s', async () => {
    const db = await import('./db');
    const { requireList } = await import('./profile-route');
    db.addProfile('dk', 'DK');
    db.addProfile('kevin', 'Kevin');
    const list = db.createList('dk', 'Azula');

    const mine = requireList(request('?profile=dk'), list.id);
    expect('list' in mine && mine.list.name).toBe('Azula');

    const theirs = requireList(request('?profile=kevin'), list.id);
    expect(theirs instanceof Response && theirs.status).toBe(404);
  });

  it('refuses a request with no profile, or one that does not exist', async () => {
    const db = await import('./db');
    const { requireList } = await import('./profile-route');
    const list = db.createList('dk', 'Azula');

    for (const query of ['', '?profile=', '?profile=nobody']) {
      const result = requireList(request(query), list.id);
      expect(result instanceof Response && result.status).toBe(400);
    }
  });
});
