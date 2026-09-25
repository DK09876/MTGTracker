import { afterEach, describe, expect, it, vi } from 'vitest';

import { ModelError, parseJson, retryAfterMs, testing } from './ai';

const ok = (json: object) => new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ text: 'thinking...', thought: true }, { text: JSON.stringify(json) }] } }],
}), { status: 200 });
const fail = (status: number, details: object[] = []) =>
  new Response(JSON.stringify({ error: { message: `busy ${status}`, details } }), { status });

const request = { system: 's', user: 'u', schema: {} };
const noWait = async () => {};

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
  it('retries a busy model, then answers', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(fail(503)).mockResolvedValueOnce(fail(429)).mockResolvedValueOnce(ok({ a: 1 }));
    vi.stubGlobal('fetch', fetch);
    expect(await testing.generate('k', ['m1'], request, noWait)).toEqual({ a: 1 });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('moves to the next model when one is gone', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(fail(404)).mockResolvedValueOnce(ok({ b: 2 }));
    vi.stubGlobal('fetch', fetch);
    expect(await testing.generate('k', ['gone', 'm2'], request, noWait)).toEqual({ b: 2 });
    expect(String(fetch.mock.calls[1][0])).toContain('/m2:generateContent');
  });

  it('gives up on a daily quota rather than waiting it out', async () => {
    const fetch = vi.fn().mockResolvedValue(fail(429, [{ retryDelay: '3600s' }]));
    vi.stubGlobal('fetch', fetch);
    await expect(testing.generate('k', ['m1'], request, noWait)).rejects.toThrow(/429/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('tries the next model when one stays busy', async () => {
    const fetch = vi.fn();
    for (let i = 0; i < 5; i++) fetch.mockResolvedValueOnce(fail(503));
    fetch.mockResolvedValueOnce(ok({ c: 3 }));
    vi.stubGlobal('fetch', fetch);
    expect(await testing.generate('k', ['busy', 'm2'], request, noWait)).toEqual({ c: 3 });
    expect(String(fetch.mock.calls[5][0])).toContain('/m2:generateContent');
  });

  it('gives up after a few tries, and at once on a bad request', async () => {
    const busy = vi.fn().mockResolvedValue(fail(503));
    vi.stubGlobal('fetch', busy);
    await expect(testing.generate('k', ['m1'], request, noWait)).rejects.toThrow(/503/);
    expect(busy).toHaveBeenCalledTimes(5);
    const bad = vi.fn().mockResolvedValue(fail(400));
    vi.stubGlobal('fetch', bad);
    await expect(testing.generate('k', ['m1'], request, noWait)).rejects.toThrow(/400/);
    expect(bad).toHaveBeenCalledTimes(1);
  });
});
