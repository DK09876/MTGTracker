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
    db.addProfile('aiko', 'Aiko');
    db.addProfile('kevin', 'Kevin');
    const list = db.createList('aiko', 'Azula');

    const mine = requireList(request('?profile=aiko'), list.id);
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

  it('lets a profile with a password, or an admin, in only when signed in as it', async () => {
    const db = await import('./db');
    db.addProfile('dk', 'DK');
    db.addProfile('kevin', 'Kevin');
    const auth = await import('./auth');
    const { requireList, requireAdmin } = await import('./profile-route');
    const list = db.createList('dk', 'Azula');
    // DK is an admin from the start, so needs signing in even before a password is set.
    expect(auth.access('dk')).toMatchObject({ isAdmin: true, hasPassword: false });
    const out = requireList(request('?profile=dk'), list.id);
    expect(out instanceof Response && out.status).toBe(401);

    auth.setPassword('dk', 'correct horse');
    expect(auth.passwordMatches('dk', 'correct horse')).toBe(true);
    expect(auth.passwordMatches('dk', 'wrong')).toBe(false);
    const { token } = auth.startSession('dk');
    const signed = (q: string) => new Request(`http://localhost/api/lists/x${q}`, { headers: { cookie: `${auth.SESSION_COOKIE}=${token}` } });
    const mine = requireList(signed('?profile=dk'), list.id);
    expect('list' in mine && mine.list.name).toBe('Azula');
    expect('profile' in requireAdmin(signed('?profile=dk'))).toBe(true);

    // Kevin has no password: open, but not an admin.
    expect(requireAdmin(request('?profile=kevin')) instanceof Response).toBe(true);
    auth.endSession(token);
    expect(requireList(signed('?profile=dk'), list.id) instanceof Response).toBe(true);
  });
});
