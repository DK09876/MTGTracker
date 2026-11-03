/**
 * Background jobs, the error log and deck reads, each on a fresh database.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-jobs-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.resetModules();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('jobs', () => {
  it('runs in the background and keeps the result', async () => {
    const { startJob, getJob } = await import('./jobs');
    let finish!: (v: unknown) => void;
    const job = startJob({ kind: 'brief', label: 'Drafting', subject: 'Deck', profileId: 'dk', listId: 'l1' }, () => new Promise((r) => { finish = r; }));
    expect(job.status).toBe('running');
    finish({ readId: 'r1' });
    await settle();
    expect(getJob(job.id)).toMatchObject({ status: 'done', result: { readId: 'r1' } });
  });

  it('gives back the running job rather than starting a second on the same deck', async () => {
    const { startJob } = await import('./jobs');
    const work = vi.fn(() => new Promise(() => {}));
    const a = startJob({ kind: 'brief', label: 'x', subject: '', profileId: 'dk', listId: 'l1' }, work);
    const b = startJob({ kind: 'brief', label: 'x', subject: '', profileId: 'dk', listId: 'l1' }, work);
    expect(b.id).toBe(a.id);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('logs a failure at the level asked for', async () => {
    const { startJob, getJob } = await import('./jobs');
    const { listErrors, openErrors } = await import('./errors');
    const job = startJob({ kind: 'brief', label: 'Drafting', subject: 'Azula', profileId: 'dk', listId: 'l1', errorLevel: () => 'warn' },
      async () => { throw new Error('model busy'); });
    await settle();
    expect(getJob(job.id)).toMatchObject({ status: 'failed', error: 'model busy' });
    expect(listErrors()[0]).toMatchObject({ source: 'Drafting · Azula', level: 'warn' });
    // A warning is logged but raises no banner.
    expect(openErrors()).toEqual([]);
  });

  it('lists a profile\'s running and just-finished jobs', async () => {
    const { startJob, recentJobs } = await import('./jobs');
    startJob({ kind: 'roles', label: 'Roles', subject: '', profileId: 'dk', listId: 'l1' }, () => new Promise(() => {}));
    startJob({ kind: 'roles', label: 'Roles', subject: '', profileId: 'kevin', listId: 'l2' }, () => new Promise(() => {}));
    expect(recentJobs('dk').map((j) => j.listId)).toEqual(['l1']);
  });
});

describe('errors', () => {
  it('shows an error until it is acknowledged', async () => {
    const { recordError, openErrors, acknowledge, listErrors } = await import('./errors');
    const e = recordError({ source: 'Nightly card refresh', message: 'Scryfall timed out' });
    recordError({ source: 'Tagging', message: 'busy', level: 'warn' });
    expect(openErrors().map((x) => x.id)).toEqual([e.id]);
    expect(acknowledge('dk', e.id)).toBe(1);
    expect(openErrors()).toEqual([]);
    expect(listErrors().find((x) => x.id === e.id)).toMatchObject({ ackBy: 'dk' });
  });
});

describe('deck reads', () => {
  const read = (cards: string[], lines: Array<{ how: string; cards: string[]; label?: string }>) =>
    ({ listId: 'l1', profileId: 'dk', mode: 'build' as const, model: 'claude-opus-5-5', winConditions: lines, missing: '', brief: 'b', cards });

  it('keeps one waiting draft, and saved reads apart', async () => {
    const { addRead, readsFor, setSaved } = await import('./reads');
    const first = addRead(read(['A'], []));
    setSaved('l1', first.id, true);
    addRead(read(['A', 'B'], []));
    const second = addRead(read(['A', 'C'], []));
    const { draft, saved } = readsFor('l1');
    expect(draft?.id).toBe(second.id);
    expect(saved.map((r) => r.id)).toEqual([first.id]);
  });

  it('says what changed in the deck and in the routes', async () => {
    const { cardChange, compareReads, addRead } = await import('./reads');
    expect(cardChange(['A', 'B', 'C'], ['A', 'C', 'D'])).toEqual({ added: ['D'], removed: ['B'] });
    const old = addRead(read([], [{ how: 'Tokens go wide', cards: ['Young Pyromancer', 'Empty the Warrens'] }, { how: 'Storm', cards: ['Storm-Kiln Artist', 'Past in Flames'] }]));
    const now = addRead(read([], [{ how: 'One big storm turn', cards: ['Storm-Kiln Artist', 'Past in Flames', 'Reiterate'] }, { how: 'Bounce lock', cards: ['Hullbreaker Horror'] }]));
    const change = compareReads(old, now);
    expect(change.kept.map((w) => w.how)).toEqual(['One big storm turn']);
    expect(change.gained.map((w) => w.how)).toEqual(['Bounce lock']);
    expect(change.lost.map((w) => w.how)).toEqual(['Tokens go wide']);
  });
});
