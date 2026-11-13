/**
 * The update banner's store (handoff 9, Part B): what counts as "can't reach
 * the app", the words a failed request gets, the version check, and no new
 * job while a deploy waits.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const answer = (status: number, headers: Record<string, string> = {}) => new Response(JSON.stringify({}), { status, headers });
const ours = (status: number, build = 'abc') => answer(status, { 'x-mtg': '1', 'x-mtg-build': build });

describe('reaching the app', () => {
  beforeEach(() => { vi.stubEnv('NEXT_PUBLIC_MTG_BUILD', 'abc'); vi.resetModules(); });
  afterEach(() => vi.unstubAllEnvs());

  it('unreachable on a thrown fetch and on 502/503/504 from in front of the app; not on the app’s own 400/404/500/503', async () => {
    const { classify } = await import('./reach');
    expect(classify('threw').reach).toBe('down');
    for (const s of [502, 503, 504]) expect(classify(answer(s)).reach).toBe('down');
    for (const s of [400, 404, 500, 503]) expect(classify(ours(s)).reach).toBe('ok');
    expect(classify(answer(200)).reach).toBe('ok');
  });

  it('a failed change may have been saved; a failed read says it will reconnect, "updating" only after the server said so; nothing is retried', async () => {
    const { reached, reachState, noteStatus, MAYBE_SAVED, NOT_READ, NO_REACH } = await import('./reach');
    const f = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(reached('/api/lists/x/chats', { method: 'POST' }, f as never)).rejects.toThrow(MAYBE_SAVED);
    // Offline, or the tailnet: not the deploy.
    await expect(reached('/api/lists/x', undefined, f as never)).rejects.toThrow(NO_REACH);
    noteStatus({ build: 'abc', updating: '2026-11-13T10:00:00Z' });
    await expect(reached('/api/lists/x', undefined, f as never)).rejects.toThrow(NOT_READ);
    expect(f).toHaveBeenCalledTimes(3);
    expect(reachState().down).toBe(true);
    // The app's own error passes through untouched, as an answer.
    const r = await reached('/api/lists/x', { method: 'POST' }, (async () => ours(500)) as never);
    expect(r.status).toBe(500);
  });

  it('clears on the next good answer, and tells listeners', async () => {
    const { note, onReach, reachState } = await import('./reach');
    const seen: boolean[] = [];
    onReach((s) => seen.push(s.down));
    note(answer(502));
    expect(reachState().down).toBe(true);
    note(ours(200));
    expect(reachState().down).toBe(false);
    expect(seen).toEqual([true, false]);
  });

  it('a new version only when the ids differ', async () => {
    const { isNewer, note, noteStatus, reachState } = await import('./reach');
    expect(isNewer('abc')).toBe(false);
    expect(isNewer(null)).toBe(false);
    expect(isNewer('def')).toBe(true);
    // A dev page never offers one.
    expect(isNewer('def', 'dev')).toBe(false);
    note(ours(200, 'abc'));
    expect(reachState().newer).toBe(false);
    noteStatus({ build: 'abc', updating: '2026-11-13T10:00:00Z' });
    expect(reachState()).toMatchObject({ down: false, updating: true, newer: false });
    noteStatus({ build: 'def', updating: null });
    expect(reachState()).toMatchObject({ down: false, updating: false, newer: true });
    // Rolled back to this page's build: the line clears.
    noteStatus({ build: 'abc', updating: null });
    expect(reachState().newer).toBe(false);
  });
});

describe('a deploy waiting for jobs', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mtg-updating-'));
    vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
    vi.resetModules();
  });
  afterEach(() => { vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });

  it('starts no new job while the updating file is there; the job comes back failed with the reason', async () => {
    const jobs = await import('./jobs');
    let release!: () => void;
    const running = jobs.startJob({ kind: 'chat', label: 'Deck chat', subject: 'Azula', profileId: 'dk', listId: 'l1' }, () => new Promise<void>((r) => { release = r; }));
    expect(jobs.runningCount()).toBe(1);
    const since = new Date().toISOString();
    writeFileSync(join(dir, 'updating'), since);
    const { updatingSince, UPDATING_MESSAGE } = await import('./updating');
    expect(updatingSince()).toBe(since);
    const work = vi.fn(async () => 'never');
    const refused = jobs.startJob({ kind: 'finish', label: 'Finish', subject: 'Azula', profileId: 'dk', listId: 'l1' }, work);
    expect(refused).toMatchObject({ status: 'failed', error: UPDATING_MESSAGE });
    expect(work).not.toHaveBeenCalled();
    // The job that was already running goes on, and the deploy can see it.
    expect(running.status).toBe('running');
    expect(jobs.runningCount()).toBe(1);
    release();
    await vi.waitFor(() => expect(jobs.runningCount()).toBe(0));
  });
});

describe('the updating file and refused jobs (review 24, 28)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mtg-updating2-'));
    vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
    vi.resetModules();
  });
  afterEach(() => { vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });

  it('the flag ends at its own time, or 15 minutes after it started; the app clears it when it starts', async () => {
    const { updatingSince, clearUpdating } = await import('./updating');
    const t0 = Date.parse('2026-11-13T10:00:00Z');
    writeFileSync(join(dir, 'updating'), '2026-11-13T10:00:00Z');
    expect(updatingSince(t0 + 60_000)).toBe('2026-11-13T10:00:00Z');
    expect(updatingSince(t0 + 16 * 60_000)).toBeNull();
    writeFileSync(join(dir, 'updating'), '2026-11-13T10:00:00Z 2026-11-13T10:05:00Z');
    expect(updatingSince(t0 + 4 * 60_000)).not.toBeNull();
    expect(updatingSince(t0 + 6 * 60_000)).toBeNull();
    clearUpdating();
    expect(updatingSince(t0)).toBeNull();
    // At start the app clears only a flag past its end: one in its time is the deploy checking that very start.
    const { clearStaleUpdating } = await import('./updating');
    const { existsSync } = await import('fs');
    const live = new Date(Date.now() + 60_000).toISOString();
    writeFileSync(join(dir, 'updating'), `${new Date().toISOString()} ${live}`);
    clearStaleUpdating();
    expect(existsSync(join(dir, 'updating'))).toBe(true);
    writeFileSync(join(dir, 'updating'), '2026-01-01T00:00:00Z 2026-01-01T00:05:00Z');
    clearStaleUpdating();
    expect(existsSync(join(dir, 'updating'))).toBe(false);
  });

  it('a refused job steps aside after a minute, and the last good one shows again; the card refresh counts as running', async () => {
    const jobs = await import('./jobs');
    const good = jobs.startJob({ kind: 'trim', label: 'Trim', subject: 'Azula', profileId: 'dk', listId: 'l1' }, async () => 'cuts');
    await vi.waitFor(() => expect(jobs.getJob(good.id)?.status).toBe('done'));
    writeFileSync(join(dir, 'updating'), new Date().toISOString());
    const refused = jobs.startJob({ kind: 'trim', label: 'Trim', subject: 'Azula', profileId: 'dk', listId: 'l1' }, async () => 'never');
    expect(jobs.latestJob('trim', 'l1')!.id).toBe(refused.id);
    expect(jobs.latestJob('trim', 'l1', Date.now() + 61_000)!.id).toBe(good.id);
    rmSync(join(dir, 'updating'));
    let end!: () => void;
    jobs.startJob({ kind: 'refresh', label: 'Refreshing card data', subject: 'Scryfall', profileId: null, listId: null }, () => new Promise<void>((r) => { end = r; }));
    expect(jobs.runningCount()).toBe(1);
    end();
  });
});
