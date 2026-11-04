/**
 * Background jobs: work that takes long enough that nobody should sit and
 * watch it - drafting a deck's brief, reading a new deck's roles, the
 * nightly card refresh. A job runs on the server whether or not the page
 * that started it is still open; the header's jobs menu shows what is
 * running and what just finished, and the page picks the result up when it
 * comes back.
 *
 * Tagging has its own runner (tag-jobs.ts) with its own progress and log;
 * the jobs menu shows those too. Jobs live in this server process: one that
 * was running when the server restarted is reported as interrupted.
 * Server only.
 */

import { randomUUID } from 'crypto';

import { database } from './db';
import { recordError, type Level } from './errors';

export type JobKind = 'brief' | 'roles' | 'refresh' | 'chat' | 'starter' | 'printings';
export type JobStatus = 'running' | 'done' | 'failed' | 'interrupted';

export interface Job {
  id: string;
  kind: JobKind;
  /** What it is doing, for the jobs menu: "Drafting the brief". */
  label: string;
  profileId: string | null;
  listId: string | null;
  /** The deck or thing it is for: "Azula Madness". */
  subject: string;
  status: JobStatus;
  /** What it is on right now. */
  detail: string;
  done: number | null;
  total: number | null;
  result: unknown;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface JobContext {
  progress: (detail: string, done?: number, total?: number) => void;
}

/** How long a finished job stays in the jobs menu. */
export const RECENT_MS = 15 * 60_000;
const KEEP_DAYS = 14;

const running = ((globalThis as { __mtgJobs?: Set<string> }).__mtgJobs ??= new Set());
let ready = false;

function db() {
  const d = database();
  if (!ready) {
    d.run(`CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, profileId TEXT, listId TEXT, startedAt TEXT NOT NULL,
      status TEXT NOT NULL, job TEXT NOT NULL)`);
    d.run('CREATE INDEX IF NOT EXISTS idx_jobs_list ON jobs (listId, kind)');
    ready = true;
  }
  return d;
}

function save(job: Job): void {
  db().run(
    `INSERT INTO jobs (id, kind, profileId, listId, startedAt, status, job) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, job = excluded.job`,
    [job.id, job.kind, job.profileId, job.listId, job.startedAt, job.status, JSON.stringify(job)],
  );
}

/** A job read back; one this process lost track of is marked interrupted. */
function revive(raw: string): Job {
  const job = JSON.parse(raw) as Job;
  if (job.status === 'running' && !running.has(job.id)) {
    job.status = 'interrupted';
    job.finishedAt = new Date().toISOString();
    job.error = 'The server restarted while this was running - start it again';
    save(job);
  }
  return job;
}

export function getJob(id: string): Job | null {
  const row = db().get('SELECT job FROM jobs WHERE id = ?', [id]) as { job: string } | null;
  return row ? revive(row.job) : null;
}

/** The newest job of a kind on a deck. */
export function latestJob(kind: JobKind, listId: string): Job | null {
  const row = db().get('SELECT job FROM jobs WHERE kind = ? AND listId = ? ORDER BY startedAt DESC LIMIT 1', [kind, listId]) as { job: string } | null;
  return row ? revive(row.job) : null;
}

/** A profile's running jobs and the ones that finished in the last few minutes, newest first. */
export function recentJobs(profileId: string | null, now = Date.now()): Job[] {
  const since = new Date(now - RECENT_MS).toISOString();
  const rows = db().all(
    `SELECT job FROM jobs WHERE (profileId = ? OR profileId IS NULL) AND (status = 'running' OR startedAt >= ?)
     ORDER BY startedAt DESC LIMIT 20`,
    [profileId, new Date(now - 24 * 3600_000).toISOString()],
  ) as Array<{ job: string }>;
  return rows.map((r) => revive(r.job)).filter((j) => j.status === 'running' || (j.finishedAt ?? '') >= since);
}

/**
 * Start `work` in the background and return the job at once. A second start
 * of the same kind on the same deck while one runs gets the running one back.
 */
export function startJob(
  meta: { kind: JobKind; label: string; subject: string; profileId: string | null; listId: string | null; errorLevel?: (e: unknown) => Level },
  work: (ctx: JobContext) => Promise<unknown>,
): Job {
  if (meta.listId) {
    const current = latestJob(meta.kind, meta.listId);
    if (current?.status === 'running') return current;
  }
  const job: Job = {
    id: randomUUID(), kind: meta.kind, label: meta.label, subject: meta.subject, profileId: meta.profileId, listId: meta.listId,
    status: 'running', detail: '', done: null, total: null, result: null, error: null,
    startedAt: new Date().toISOString(), finishedAt: null,
  };
  running.add(job.id);
  save(job);
  const ctx: JobContext = {
    progress: (detail, done, total) => {
      job.detail = detail;
      if (done !== undefined) job.done = done;
      if (total !== undefined) job.total = total;
      save(job);
    },
  };
  void (async () => {
    try {
      job.result = await work(ctx);
      job.status = 'done';
    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : String(error);
      recordError({
        source: `${meta.label}${meta.subject ? ` · ${meta.subject}` : ''}`, message: job.error,
        level: meta.errorLevel?.(error) ?? 'error', detail: error, profileId: meta.profileId, listId: meta.listId,
      });
    } finally {
      job.finishedAt = new Date().toISOString();
      running.delete(job.id);
      save(job);
      db().run('DELETE FROM jobs WHERE startedAt < ?', [new Date(Date.now() - KEEP_DAYS * 86400_000).toISOString()]);
    }
  })();
  return job;
}
