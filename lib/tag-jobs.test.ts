import { describe, expect, it } from 'vitest';

import { ModelError, type CallOptions } from './ai';
import { evenBatches, MAX_REFUSALS, newJob, PATIENCE_MS, runJob, type JobDeps, type JobParams, type TagJob } from './tag-jobs';

const busy = (o: CallOptions): never => {
  o.onEvent?.({ model: 'gemini-3.8-flash', what: 'busy' });
  throw new ModelError('Gemini is overloaded right now', 'busy');
};

/** Deps whose steps answer from a script; records the waits and saves. */
function deps(overrides: Partial<JobDeps> = {}) {
  const waits: number[] = [];
  const saved: string[] = [];
  const d: JobDeps = {
    propose: async () => ({ proposed: 5, model: 'gemini-3.8-flash' }),
    assign: async (keys) => ({ added: keys.length * 2, skipped: 0, model: 'gemini-3.8-flash' }),
    audit: async () => ({ added: 1, removed: 2, model: 'gemini-3.8-flash' }),
    plan: () => ({ cards: Array.from({ length: 92 }, (_, i) => `k${i}`), tags: ['t1', 't2', 't3'] }),
    save: (job) => saved.push(job.status),
    sleep: async (ms) => { waits.push(ms); },
    now: () => 0,
    ...overrides,
  };
  return { d, waits, saved };
}

const tagJob: JobParams = { kind: 'tag', boards: ['main'], mode: 'free', scope: 'all', audit: true };
const run = (params: JobParams, d: JobDeps, signal = new AbortController().signal): Promise<TagJob> =>
  runJob(newJob('list', params, 0), d, signal);

describe('runJob', () => {
  it('suggests tags and counts the request', async () => {
    const job = await run({ kind: 'propose', boards: ['main'] }, deps().d);
    expect(job).toMatchObject({ status: 'done', proposed: 5, requests: 1, refusals: 0, models: ['gemini-3.8-flash'] });
  });

  it('tags in even batches, then checks the tags', async () => {
    const seen: number[] = [];
    const { d } = deps({ assign: async (keys) => { seen.push(keys.length); return { added: 10, skipped: 0, model: 'm' }; } });
    const job = await run(tagJob, d);
    expect(seen).toEqual([46, 46]);
    expect(job).toMatchObject({ status: 'done', phase: 'audit', added: 21, removed: 2, requests: 3 });
  });

  it('waits longer each time the model is busy, one request a try, and says when it will try next', async () => {
    let calls = 0;
    const { d, waits } = deps({ propose: async (_, o) => (++calls < 3 ? busy(o) : { proposed: 4, model: 'gemini-3.6-flash' }) });
    const job = await run({ kind: 'propose', boards: ['main'] }, d);
    expect(waits).toEqual([PATIENCE_MS[0], PATIENCE_MS[1]]);
    expect(job).toMatchObject({ status: 'done', refusals: 2, requests: 3, nextTryAt: null });
    expect(job.events.map((e) => e.text).join('\n')).toMatch(/busy \(refused with 503\)[\s\S]*next try at/);
  });

  it('asks each try for one refusal only, moving round the models', async () => {
    const rotations: Array<number | undefined> = [];
    let calls = 0;
    const { d } = deps({ propose: async (_, o) => { rotations.push(o.rotate); expect(o.maxBusy).toBe(1); return ++calls < 3 ? busy(o) : { proposed: 1, model: 'm' }; } });
    await run({ kind: 'propose', boards: ['main'] }, d);
    expect(rotations).toEqual([0, 1, 2]);
  });

  it('gives up after enough refusals, and does not go on to other batches', async () => {
    let calls = 0;
    const { d } = deps({ assign: async (_, o) => { calls++; return busy(o); } });
    const job = await run(tagJob, d);
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/Gave up after 12 refusals/);
    expect(calls).toBe(MAX_REFUSALS);
    expect(job.requests).toBe(MAX_REFUSALS);
  });

  it('stops while waiting, keeping what was applied', async () => {
    const controller = new AbortController();
    let calls = 0;
    const { d } = deps({
      assign: async (keys, o) => (++calls === 1 ? { added: 7, skipped: 0, model: 'm' } : busy(o)),
      sleep: async () => { controller.abort(); },
    });
    const job = await run(tagJob, d, controller.signal);
    expect(job).toMatchObject({ status: 'stopped', added: 7, error: null });
    expect(job.finishedAt).not.toBeNull();
  });

  it('fails at once when every model has used the day', async () => {
    const { d, waits } = deps({ propose: async () => { throw new ModelError('every model has used today\'s free requests - they reset at midnight Pacific', 'quota'); } });
    const job = await run({ kind: 'propose', boards: ['main'] }, d);
    expect(job).toMatchObject({ status: 'failed' });
    expect(job.error).toMatch(/midnight Pacific/);
    expect(waits).toEqual([]);
  });

  it('notes a batch that fails for another reason and carries on', async () => {
    let calls = 0;
    const { d } = deps({ assign: async () => { if (++calls === 1) throw new ModelError('the model returned something other than JSON'); return { added: 3, skipped: 0, model: 'm' }; } });
    const job = await run(tagJob, d);
    expect(job.status).toBe('done');
    expect(job.failed).toEqual(['46 cards: the model returned something other than JSON']);
    expect(job.added).toBe(3 + 1);
  });

  it('skips the check when no batch was tagged', async () => {
    let audits = 0;
    const { d } = deps({
      assign: async () => { throw new ModelError('bad answer'); },
      audit: async () => { audits++; return { added: 0, removed: 0, model: 'm' }; },
    });
    const job = await run(tagJob, d);
    expect(audits).toBe(0);
    expect(job.failed).toHaveLength(2);
  });
});

describe('evenBatches', () => {
  it('splits evenly', () => {
    expect(evenBatches([1, 2, 3, 4, 5], 2).map((b) => b.length)).toEqual([2, 2, 1]);
    expect(evenBatches([], 5)).toEqual([]);
  });
});
