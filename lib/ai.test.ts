import { afterEach, describe, expect, it, vi } from 'vitest';

import { ModelError, parseJson, retryAfterMs, testing, type Usage } from './ai';

const ok = (json: object) => new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ text: 'thinking...', thought: true }, { text: JSON.stringify(json) }] } }],
}), { status: 200 });
const fail = (status: number, details: object[] = []) =>
  new Response(JSON.stringify({ error: { message: `busy ${status}`, details } }), { status });
const daily = (model: string) => fail(429, [{
  violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '20', quotaDimensions: { model } }],
}, { retryDelay: '2s' }]);
const perMinute = fail(429, [{ violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier', quotaValue: '5' }] }, { retryDelay: '3s' }]);

const request = { system: 's', user: 'u', schema: {} };
const noWait = async () => {};

/** A ladder of models, recording what was spent. */
function usage(models: string[]) {
  const calls: string[] = [];
  const spent: Array<[string, number | null]> = [];
  const u: Usage = {
    available: () => models.filter((m) => !spent.some(([s]) => s === m)),
    called: (m) => calls.push(m),
    spent: (m, limit) => spent.push([m, limit]),
  };
  return { u, calls, spent };
}

afterEach(() => vi.unstubAllGlobals());

describe('parseJson', () => {
  it('skips thought parts', () => {
    expect(parseJson({ candidates: [{ content: { parts: [{ text: 'hmm', thought: true }, { text: '{"a":1}' }] } }] })).toEqual({ a: 1 });
  });
  it('refuses nothing and non-JSON', () => {
    expect(() => parseJson({})).toThrow(ModelError);
    expect(() => parseJson({ candidates: [{ content: { parts: [{ text: 'nope' }] } }] })).toThrow(ModelError);
  });
});

describe('retryAfterMs', () => {
  it('reads Gemini\'s RetryInfo', () => {
    expect(retryAfterMs({ error: { details: [{ '@type': 'x' }, { retryDelay: '23s' }] } })).toBe(23_000);
    expect(retryAfterMs({ error: {} })).toBeNull();
  });
});

describe('generate', () => {
  it('tries the next model once when one is busy, and counts each request', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(fail(503)).mockResolvedValueOnce(ok({ a: 1 }));
    vi.stubGlobal('fetch', fetch);
    const { u, calls } = usage(['m1', 'm2']);
    expect(await testing.generate('k', u, request, noWait)).toEqual({ data: { a: 1 }, model: 'm2' });
    expect(calls).toEqual(['m1', 'm2']); // Gemini counts a busy 503 against the day too
  });

  it('gives up after three busy refusals rather than spending the day on them', async () => {
    const fetch = vi.fn().mockResolvedValue(fail(503));
    vi.stubGlobal('fetch', fetch);
    const { u, calls } = usage(['m1', 'm2', 'm3', 'm4']);
    await expect(testing.generate('k', u, request, noWait)).rejects.toThrow(/overloaded right now.*3 requests/);
    expect(calls).toEqual(['m1', 'm2', 'm3']);
  });

  it('stops when the step runs out of time', async () => {
    let clock = 0;
    const fetch = vi.fn().mockImplementation(async () => { clock += 100_000; return fail(503); });
    vi.stubGlobal('fetch', fetch);
    const { u } = usage(['m1', 'm2', 'm3']);
    await expect(testing.generate('k', u, { ...request, timeoutMs: 150_000 }, noWait, () => clock)).rejects.toThrow(/overloaded/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('moves down the ladder at once when a model has used its day', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(daily('m1')).mockResolvedValueOnce(ok({ b: 2 }));
    vi.stubGlobal('fetch', fetch);
    const { u, calls, spent } = usage(['m1', 'm2']);
    expect(await testing.generate('k', u, request, noWait)).toEqual({ data: { b: 2 }, model: 'm2' });
    expect(spent).toEqual([['m1', 20]]);
    expect(calls).toEqual(['m2']); // a refusal is not a request spent
  });

  it('waits out a per-minute limit on the same model', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(perMinute).mockResolvedValueOnce(ok({ c: 3 }));
    vi.stubGlobal('fetch', fetch);
    const { u, spent } = usage(['m1', 'm2']);
    expect((await testing.generate('k', u, request, noWait)).model).toBe('m1');
    expect(spent).toEqual([]);
  });

  it('passes over a model that stays busy, or is gone', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(fail(404));
    fetch.mockResolvedValueOnce(fail(503)).mockResolvedValueOnce(ok({ d: 4 }));
    vi.stubGlobal('fetch', fetch);
    const { u } = usage(['gone', 'busy', 'm3']);
    expect((await testing.generate('k', u, request, noWait)).model).toBe('m3');
  });

  it('says so when every model has used its day, without calling', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(testing.generate('k', usage([]).u, request, noWait)).rejects.toThrow(/midnight Pacific/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('stops at once on a bad request', async () => {
    const bad = vi.fn().mockResolvedValue(fail(400));
    vi.stubGlobal('fetch', bad);
    await expect(testing.generate('k', usage(['m1', 'm2']).u, request, noWait)).rejects.toThrow(/400/);
    expect(bad).toHaveBeenCalledTimes(1);
  });
});
