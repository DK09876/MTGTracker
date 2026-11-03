/**
 * Passwords, sign-in and admins.
 *
 * A profile may have a password; an admin must. A profile with one is only
 * used by a browser signed in as it (a session cookie); one without is
 * open, as every profile was before - picking it is enough. Admins (DK and
 * Haley to start) also get the app-wide settings: models and budgets, the
 * error log and checks, the card data, and the people list.
 *
 * Passwords are hashed with scrypt; sessions are random tokens kept hashed,
 * good for 90 days. Server only.
 */

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';

import { database } from './db';

export const SESSION_COOKIE = 'mtg_session';
const SESSION_DAYS = 90;
export const MIN_PASSWORD = 8;
const START_ADMINS = ['dk', 'haley'];

let ready = false;
function db() {
  const d = database();
  if (!ready) {
    const cols = (d.all('PRAGMA table_info(profiles)') as Array<{ name: string }>).map((c) => c.name);
    if (!cols.includes('passwordHash')) d.run('ALTER TABLE profiles ADD COLUMN passwordHash TEXT');
    if (!cols.includes('isAdmin')) {
      d.run('ALTER TABLE profiles ADD COLUMN isAdmin INTEGER NOT NULL DEFAULT 0');
      d.run(`UPDATE profiles SET isAdmin = 1 WHERE id IN (${START_ADMINS.map(() => '?').join(',')})`, START_ADMINS);
    }
    d.run(`CREATE TABLE IF NOT EXISTS sessions (tokenHash TEXT PRIMARY KEY, profileId TEXT NOT NULL, createdAt TEXT NOT NULL, expiresAt TEXT NOT NULL)`);
    ready = true;
  }
  return d;
}

export interface Access {
  id: string;
  name: string;
  isAdmin: boolean;
  hasPassword: boolean;
}

export function access(profileId: string): Access | null {
  const row = db().get('SELECT id, name, isAdmin, passwordHash FROM profiles WHERE id = ?', [profileId]) as
    { id: string; name: string; isAdmin: number; passwordHash: string | null } | null;
  return row ? { id: row.id, name: row.name, isAdmin: !!row.isAdmin, hasPassword: !!row.passwordHash } : null;
}

export function everyone(): Access[] {
  return (db().all(`SELECT id, name, isAdmin, passwordHash FROM profiles WHERE id != 'tour' ORDER BY createdAt`) as Array<{ id: string; name: string; isAdmin: number; passwordHash: string | null }>)
    .map((r) => ({ id: r.id, name: r.name, isAdmin: !!r.isAdmin, hasPassword: !!r.passwordHash }));
}

/** Whether using this profile needs a signed-in browser. */
export const guarded = (a: Access) => a.hasPassword || a.isAdmin;

// --- passwords -------------------------------------------------------------

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${scryptSync(password, salt, 32).toString('base64')}`;
}

export function checkPassword(password: string, stored: string): boolean {
  const [kind, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const got = scryptSync(password, Buffer.from(salt, 'base64'), want.length);
  return timingSafeEqual(want, got);
}

export function setPassword(profileId: string, password: string | null): void {
  db().run('UPDATE profiles SET passwordHash = ? WHERE id = ?', [password ? hashPassword(password) : null, profileId]);
}

export function passwordMatches(profileId: string, password: string): boolean {
  const row = db().get('SELECT passwordHash FROM profiles WHERE id = ?', [profileId]) as { passwordHash: string | null } | null;
  return !!row?.passwordHash && checkPassword(password, row.passwordHash);
}

export function setAdmin(profileId: string, admin: boolean): void {
  db().run('UPDATE profiles SET isAdmin = ? WHERE id = ?', [admin ? 1 : 0, profileId]);
}

// Five wrong tries lock a profile for a minute.
const failures = ((globalThis as { __mtgFailures?: Map<string, { n: number; until: number }> }).__mtgFailures ??= new Map());
const MAX_TRIES = 5;
const LOCK_MS = 60_000;

export function lockedFor(profileId: string, now = Date.now()): number {
  const f = failures.get(profileId);
  return f && f.until > now ? f.until - now : 0;
}

export function noteFailure(profileId: string, now = Date.now()): void {
  const f = failures.get(profileId) ?? { n: 0, until: 0 };
  f.n += 1;
  if (f.n >= MAX_TRIES) { f.until = now + LOCK_MS; f.n = 0; }
  failures.set(profileId, f);
}

export const clearFailures = (profileId: string) => failures.delete(profileId);

// --- sessions --------------------------------------------------------------

const digest = (token: string) => createHash('sha256').update(token).digest('hex');

export function startSession(profileId: string, now = new Date()): { token: string; expires: Date } {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400_000);
  const d = db();
  d.run('INSERT INTO sessions (tokenHash, profileId, createdAt, expiresAt) VALUES (?, ?, ?, ?)', [digest(token), profileId, now.toISOString(), expires.toISOString()]);
  d.run('DELETE FROM sessions WHERE expiresAt < ?', [now.toISOString()]);
  return { token, expires };
}

export function endSession(token: string): void {
  db().run('DELETE FROM sessions WHERE tokenHash = ?', [digest(token)]);
}

export function endSessionsFor(profileId: string): void {
  db().run('DELETE FROM sessions WHERE profileId = ?', [profileId]);
}

export function cookieToken(request: Request): string | null {
  const header = request.headers.get('cookie') ?? '';
  const m = header.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/** The profile this browser is signed in as, if any. */
export function signedIn(request: Request, now = new Date()): string | null {
  const token = cookieToken(request);
  if (!token) return null;
  const row = db().get('SELECT profileId, expiresAt FROM sessions WHERE tokenHash = ?', [digest(token)]) as { profileId: string; expiresAt: string } | null;
  return row && row.expiresAt > now.toISOString() ? row.profileId : null;
}

/** The cookie that holds a session: secure when the app is reached over https. */
export function sessionCookie(request: Request, token: string, expires: Date | null): string {
  const https = request.headers.get('x-forwarded-proto') === 'https' || new URL(request.url).protocol === 'https:';
  const parts = [`${SESSION_COOKIE}=${expires ? encodeURIComponent(token) : ''}`, 'Path=/', 'HttpOnly', 'SameSite=Lax',
    expires ? `Expires=${expires.toUTCString()}` : 'Max-Age=0'];
  if (https) parts.push('Secure');
  return parts.join('; ');
}
