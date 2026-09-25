import { describe, expect, it } from 'vitest';

import { ModelError, type CallOptions } from './ai';
import { evenBatches, newJob, runJob, type JobDeps, type JobParams, type TagJob } from './tag-jobs';

const busy = (o: CallOptions): never => {
  o.onEvent?.({ model: 'gemini-3.5-flash-lite', what: 'busy' });
  throw new ModelError('Gemini is overloaded right now', 'busy');
};

/** Deps whose steps answer from a script; records the saves. */
function deps(overrides: Partial<JobDeps> = {}) {
  const saved: string[] = [];
  const d: JobDeps = {
    propose: async () => ({ proposed: 5, model: 'gemini-3.5-flash-lite' }),
    assign: async (keys) => ({ added: keys.length * 2, skipped: 0, model: 'gemini-3.5-flash-lite' }),
    audit: async () => ({ added: 1, removed: 2, model: 'gemini-3.5-flash-lite' }),
    plan: () => ({ cards: Array.from({ length: 92 }, (_, i) => `k${i}`), tags: ['t1', 't2', 't3'] }),
    save: (job) => saved.push(job.status),
    now: () => 0,
    ...overrides,
  };
  return { d, saved };
}

const tagJob: JobParams = { kind: 'tag', boards: ['main'], mode: 'free', scope: 'all', audit: true };
const run = (params: JobParams, d: JobDeps, signal = new AbortController().signal): Promise<TagJob> =>
  runJob(newJob('list', params, 0), d, signal);

describe('runJob', () => {
  it('suggests tags and counts the request', async () => {
    const job = await run({ kind: 'propose', boards: ['main'] }, deps().d);
    expect(job).toMatchObject({ status: 'done', proposed: 5, requests: 1, refusals: 0, models: ['gemini-3.5-flash-lite'] });
  });

  it('tags in even batches, then checks the tags', async () => {
    const seen: number[] = [];
    const { d } = deps({ assign: async (keys) => { seen.push(keys.length); return { added: 10, skipped: 0, model: 'm' }; } });
    const job = await run(tagJob, d);
    expect(seen).toEqual([46, 46]);
    expect(job).toMatchObject({ status: 'done', phase: 'audit', added: 21, removed: 2, requests: 3 });
  });

  it('does not wait on a busy model: the job fails at once, saying so', async () => {
    let calls = 0;
    const { d } = deps({ assign: async (_, o) => { calls++; return busy(o); } });
    const job = await run(tagJob, d);
    expect(calls).toBe(1);
    expect(job).toMatchObject({ status: 'failed', requests: 1, refusals: 1, added: 0 });
    expect(job.error).toMatch(/overloaded/);
    expect(job.events.map((e) => e.text).join('\n')).toMatch(/busy \(refused with 503\)/);
  });

  it('asks the model for one try only', async () => {
    const seen: Array<number | undefined> = [];
    const { d } = deps({ propose: async (_, o) => { seen.push(o.maxBusy); return { proposed: 1, model: 'm' }; } });
    await run({ kind: 'propose', boards: ['main'] }, d);
    expect(seen).toEqual([1]);
  });

  it('stops mid-run, keeping what was applied', async () => {
    const controller = new AbortController();
    const { d } = deps({ assign: async () => { controller.abort(); return { added: 7, skipped: 0, model: 'm' }; } });
    const job = await run(tagJob, d, controller.signal);
    expect(job).toMatchObject({ status: 'stopped', added: 7, error: null, done: 46 });
    expect(job.finishedAt).not.toBeNull();
  });

  it('fails at once when every model has used the day', async () => {
    const { d } = deps({ propose: async () => { throw new ModelError('every model has used today\'s free requests - they reset at midnight Pacific', 'quota'); } });
    const job = await run({ kind: 'propose', boards: ['main'] }, d);
    expect(job).toMatchObject({ status: 'failed' });
    expect(job.error).toMatch(/midnight Pacific/);
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
