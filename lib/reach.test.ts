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

  it('a failed change says it wasn’t sent; a failed read says it will reconnect; nothing is retried', async () => {
    const { reached, reachState, NOT_SENT, NOT_READ } = await import('./reach');
    const f = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(reached('/api/lists/x/chats', { method: 'POST' }, f as never)).rejects.toThrow(NOT_SENT);
    await expect(reached('/api/lists/x', undefined, f as never)).rejects.toThrow(NOT_READ);
    expect(f).toHaveBeenCalledTimes(2);
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
    expect(reachState()).toEqual({ down: false, updating: true, newer: false });
    noteStatus({ build: 'def', updating: null });
    expect(reachState()).toEqual({ down: false, updating: false, newer: true });
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
    writeFileSync(join(dir, 'updating'), '2026-11-13T10:00:00Z');
    const { updatingSince, UPDATING_MESSAGE } = await import('./updating');
    expect(updatingSince()).toBe('2026-11-13T10:00:00Z');
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
