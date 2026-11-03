/**
 * Checks the app runs on itself every quarter hour: is last night's backup
 * there, did the nightly card refresh run, is a job stuck. A check that
 * starts failing goes in the error log (and so raises the banner); one that
 * keeps failing is not logged again until it has passed in between.
 *
 * The app cannot see itself being down, so a timer on the Pi (mtg-watch)
 * pings it and writes each failed ping to data/outages.log; the checks turn
 * new lines there into errors. Server only.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

import { database, getSetting, setSetting } from './db';
import { recordError } from './errors';

export interface Check {
  id: string;
  label: string;
  ok: boolean;
  /** "OK · 3:50 AM, 14 kept", or what is wrong. */
  detail: string;
}

export interface CheckRun { at: string; checks: Check[] }

const DAY = 86400_000;
const STUCK_MS = 15 * 60_000;
const KEY = 'checks.latest';
const OUTAGES_SEEN = 'checks.outagesSeen';

const when = (ms: number) => new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function backup(now: number): Check {
  const dir = process.env.MTG_BACKUP_DIR ?? join(homedir(), 'backups', 'mtg');
  const label = 'Nightly database backup';
  if (!existsSync(dir)) return { id: 'backup', label, ok: true, detail: 'Not set up on this machine' };
  const snaps = readdirSync(dir).filter((f) => /^mtg_.*\.db\.gz$/.test(f)).map((f) => statSync(join(dir, f)).mtimeMs).sort((a, b) => b - a);
  // The backup skips a night when nothing changed, so its marker counts too.
  const marker = existsSync(join(dir, '.last-run')) ? statSync(join(dir, '.last-run')).mtimeMs : 0;
  const last = Math.max(snaps[0] ?? 0, marker);
  if (!last) return { id: 'backup', label, ok: false, detail: 'No backup yet' };
  const ok = now - last < 1.5 * DAY;
  return { id: 'backup', label, ok, detail: `${ok ? 'OK' : 'Late'} · last ${when(last)}, ${snaps.length} kept` };
}

function refresh(now: number): Check {
  const label = 'Nightly card refresh';
  const last = getSetting('cards.refreshedAt');
  const failed = getSetting('cards.refreshError');
  if (!last && !failed) return { id: 'refresh', label, ok: true, detail: 'Not run yet' };
  if (failed) return { id: 'refresh', label, ok: false, detail: `Failed · ${failed}` };
  const ok = now - Date.parse(last!) < 1.5 * DAY;
  return { id: 'refresh', label, ok, detail: `${ok ? 'OK' : 'Late'} · ${when(Date.parse(last!))}` };
}

function stuck(now: number): Check {
  const rows = database().all(`SELECT job FROM jobs WHERE status = 'running'`) as Array<{ job: string }>;
  const old = rows.map((r) => JSON.parse(r.job) as { label: string; startedAt: string })
    .filter((j) => now - Date.parse(j.startedAt) > STUCK_MS);
  return { id: 'stuck', label: 'Jobs stuck over 15 minutes', ok: !old.length, detail: old.length ? old.map((j) => j.label).join(', ') : 'None' };
}

/** Failed pings the watcher wrote since the last look, turned into errors. */
function outages(dbPath: string): void {
  const log = join(dirname(dbPath), 'outages.log');
  if (!existsSync(log)) return;
  const seen = Number(getSetting(OUTAGES_SEEN) ?? 0);
  const lines = readFileSync(log, 'utf8').split('\n').filter(Boolean);
  for (const line of lines.slice(seen)) {
    recordError({ source: 'App was down', message: line.slice(0, 300) });
  }
  setSetting(OUTAGES_SEEN, String(lines.length));
}

export function latestChecks(): CheckRun | null {
  const raw = getSetting(KEY);
  return raw ? JSON.parse(raw) as CheckRun : null;
}

export function runChecks(now = Date.now()): CheckRun {
  try {
    database().run(`CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, profileId TEXT, listId TEXT, startedAt TEXT NOT NULL, status TEXT NOT NULL, job TEXT NOT NULL)`);
    outages(process.env.MTG_DB_PATH ?? join(process.cwd(), 'data', 'mtg.db'));
  } catch (error) {
    console.error('[checks] outages', error);
  }
  const before = new Map((latestChecks()?.checks ?? []).map((c) => [c.id, c.ok]));
  const checks: Check[] = [
    { id: 'app', label: 'App is up', ok: true, detail: 'Answering' },
    backup(now), refresh(now), stuck(now),
  ];
  for (const c of checks) {
    if (!c.ok && before.get(c.id) !== false) recordError({ source: c.label, message: c.detail });
  }
  const run = { at: new Date(now).toISOString(), checks };
  setSetting(KEY, JSON.stringify(run));
  return run;
}
