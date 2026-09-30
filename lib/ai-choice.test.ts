/**
 * The model chosen in Settings: kept on the server, only one whose provider
 * has a key, and back to the default when that key goes.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-ai-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.stubEnv('GEMINI_API_KEY', 'g');
  vi.stubEnv('GROQ_API_KEY', 'q');
  vi.stubEnv('MISTRAL_API_KEY', '');
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe('chosenModel', () => {
  it('starts on GPT-OSS, or Flash-Lite without a Groq key, and keeps a choice', async () => {
    const ai = await import('./ai');
    expect(ai.chosenModel()).toBe('openai/gpt-oss-120b');
    vi.stubEnv('GROQ_API_KEY', '');
    expect(ai.chosenModel()).toBe('gemini-3.5-flash-lite');
    vi.stubEnv('GROQ_API_KEY', 'q');
    ai.chooseModel('gemini-3.8-flash');
    expect(ai.chosenModel()).toBe('gemini-3.8-flash');
    ai.chooseModel('openai/gpt-oss-120b');
    expect(ai.chosenModel()).toBe('openai/gpt-oss-120b');
    expect(ai.modelStatuses().find((m) => m.chosen)?.id).toBe('openai/gpt-oss-120b');
    expect(ai.currentBudget().models.map((m) => m.id)).toEqual(['openai/gpt-oss-120b', 'gemini-3.5-flash-lite']);
  });

  it('refuses a model without a key or unknown, and forgets one whose key is gone', async () => {
    const ai = await import('./ai');
    expect(() => ai.chooseModel('mistral-medium-latest')).toThrow(/MISTRAL_API_KEY/);
    expect(() => ai.chooseModel('made-up')).toThrow(/Unknown/);
    ai.chooseModel('openai/gpt-oss-120b');
    vi.stubEnv('GROQ_API_KEY', '');
    expect(ai.chosenModel()).toBe('gemini-3.5-flash-lite');
    expect(ai.modelStatuses().find((m) => m.id === 'openai/gpt-oss-120b')?.hasKey).toBe(false);
  });
});
