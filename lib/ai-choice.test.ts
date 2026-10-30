/**
 * The models each profile uses: kept on the server per profile and feature,
 * only ones whose provider has a key, back to the default when that key
 * goes - and Claude held to the app's daily caps, with what it cost
 * recorded. Claude itself is never called: a fake client answers.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClaudeClient } from './ai-claude';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-ai-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.stubEnv('GEMINI_API_KEY', 'g');
  vi.stubEnv('GROQ_API_KEY', 'q');
  vi.stubEnv('MISTRAL_API_KEY', '');
  vi.stubEnv('ANTHROPIC_API_KEY', 'a');
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe('modelFor', () => {
  it('starts on Claude - Opus to think, Haiku to search - and keeps each profile\'s own choice', async () => {
    const ai = await import('./ai');
    expect(ai.modelFor('dk', 'rules')).toBe('claude-opus-5-5');
    expect(ai.modelFor('dk', 'tagging')).toBe('claude-opus-5-5');
    expect(ai.modelFor('dk', 'search')).toBe('claude-haiku-5-5');
    ai.chooseModel('dk', 'claude-sonnet-5-5', ['rules', 'tagging']);
    expect(ai.modelFor('dk', 'rules')).toBe('claude-sonnet-5-5');
    expect(ai.modelFor('dk', 'search')).toBe('claude-haiku-5-5');
    // Another profile is not changed by dk's choice.
    expect(ai.modelFor('kevin', 'rules')).toBe('claude-opus-5-5');
    const state = ai.aiState('dk');
    expect(state.models.find((m) => m.id === 'claude-sonnet-5-5')?.chosenFor).toEqual(['rules', 'tagging']);
    expect(state.models.find((m) => m.id === 'claude-haiku-5-5')?.chosenFor).toEqual(['search']);
  });

  it('falls back to GPT-OSS, then Flash-Lite, without the keys', async () => {
    const ai = await import('./ai');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    expect(ai.modelFor('dk', 'rules')).toBe('openai/gpt-oss-120b');
    vi.stubEnv('GROQ_API_KEY', '');
    expect(ai.modelFor('dk', 'rules')).toBe('gemini-3.5-flash-lite');
  });

  it('puts Flash-Lite behind a Gemini model only', async () => {
    const ai = await import('./ai');
    ai.chooseModel('dk', 'openai/gpt-oss-120b', ['tagging']);
    expect(ai.currentBudget('dk', 'tagging').models.map((m) => m.id)).toEqual(['openai/gpt-oss-120b']);
    ai.chooseModel('dk', 'gemini-3.8-flash', ['tagging']);
    expect(ai.currentBudget('dk', 'tagging').models.map((m) => m.id)).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
    expect(ai.currentBudget('dk', 'tagging').spend).toBeUndefined();
    expect(ai.currentBudget('dk', 'rules').spend?.caps).toEqual({ daily: 5, perProfile: 2 });
  });

  it('refuses a model without a key or unknown, and forgets one whose key is gone', async () => {
    const ai = await import('./ai');
    expect(() => ai.chooseModel('dk', 'mistral-medium-latest', ['rules'])).toThrow(/MISTRAL_API_KEY/);
    expect(() => ai.chooseModel('dk', 'made-up', ['rules'])).toThrow(/Unknown/);
    expect(() => ai.chooseModel('dk', 'openai/gpt-oss-20b', ['rules'])).toThrow(/Unknown/); // a helper, not offered
    ai.chooseModel('dk', 'openai/gpt-oss-120b', ['rules']);
    vi.stubEnv('GROQ_API_KEY', '');
    expect(ai.modelFor('dk', 'rules')).toBe('claude-opus-5-5');
    expect(ai.aiState('dk').models.find((m) => m.id === 'openai/gpt-oss-120b')?.hasKey).toBe(false);
  });

  it('keeps an effort and caps, and refuses nonsense', async () => {
    const ai = await import('./ai');
    expect(ai.effortFor('dk')).toBe('medium');
    ai.chooseEffort('dk', 'high');
    expect(ai.effortFor('dk')).toBe('high');
    expect(ai.effortFor('kevin')).toBe('medium');
    expect(() => ai.chooseEffort('dk', 'max')).toThrow(/Unknown effort/);
    ai.setCaps({ daily: '8', perProfile: 3 });
    expect(ai.caps()).toEqual({ daily: 8, perProfile: 3 });
    expect(() => ai.setCaps({ daily: -1 })).toThrow(/dollars/);
    expect(() => ai.setCaps({ perProfile: 'lots' })).toThrow(/dollars/);
  });
});

/** A Claude that answers {"ok": true} and says it used these tokens. */
function fakeClaude(usage = { input_tokens: 10_000, output_tokens: 2_000 }, stop = 'end_turn') {
  const sent: unknown[] = [];
  const client: ClaudeClient = {
    messages: {
      stream: (params) => {
        sent.push(params);
        return {
          finalMessage: async () => ({
            id: 'm', type: 'message', role: 'assistant', model: params.model, stop_reason: stop, stop_sequence: null,
            content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: '{"ok": true}', citations: null }],
            usage: { ...usage, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          }) as never,
        };
      },
    },
  };
  return { client, sent };
}

const ask = { system: 'Answer with JSON.', user: 'ok?', schema: { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } }, required: ['ok'] } };

describe('claudeModel', () => {
  it('records what each request cost, by profile and feature', async () => {
    const ai = await import('./ai');
    const { client, sent } = fakeClaude();
    const model = ai.claudeModel('claude-opus-5-5', { profile: 'dk', feature: 'rules' }, () => client);
    expect(await model(ask)).toEqual({ data: { ok: true }, model: 'claude-opus-5-5' });
    // 10K in at $4/M and 2K out at $20/M: 4 cents each.
    const spend = ai.currentSpend('dk');
    expect(spend.today).toBeCloseTo(0.08);
    expect(spend.profileToday).toBeCloseTo(0.08);
    expect(spend.left).toBeCloseTo(1.92);
    expect(ai.currentSpend('kevin').left).toBeCloseTo(2);
    expect(spend.byModel).toEqual([{ model: 'claude-opus-5-5', cost: 0.08, requests: 1 }]);
    // The profile's effort for thinking work; low for search.
    expect((sent[0] as { output_config: { effort: string } }).output_config.effort).toBe('medium');
    await ai.claudeModel('claude-haiku-5-5', { profile: 'dk', feature: 'search' }, () => client)(ask);
    expect((sent[1] as { output_config: { effort: string } }).output_config.effort).toBe('low');
  });

  it('stops sending once a profile\'s share or the app\'s day is spent', async () => {
    const ai = await import('./ai');
    ai.setCaps({ daily: 0.2, perProfile: 0.1 });
    const { client, sent } = fakeClaude();
    const dk = ai.claudeModel('claude-opus-5-5', { profile: 'dk', feature: 'rules' }, () => client);
    await dk(ask); // 8 cents
    await dk(ask); // 16 cents: the request that crosses the cap is sent
    await expect(dk(ask)).rejects.toThrow(/your share of today's AI budget/);
    expect(sent).toHaveLength(2);
    const kevin = ai.claudeModel('claude-opus-5-5', { profile: 'kevin', feature: 'rules' }, () => client);
    await kevin(ask); // 24 cents in all
    await expect(kevin(ask)).rejects.toThrow(/today's AI budget for the app/);
    expect(sent).toHaveLength(3);
  });

  it('charges a cut-off answer, and says it was cut off', async () => {
    const ai = await import('./ai');
    const { client } = fakeClaude({ input_tokens: 1_000_000, output_tokens: 0 }, 'max_tokens');
    await expect(ai.claudeModel('claude-sonnet-5-5', { profile: 'dk', feature: 'tagging' }, () => client)(ask)).rejects.toThrow(/cut off/);
    expect(ai.currentSpend('dk').today).toBeCloseTo(2);
  });

  it('refuses to reach the real Claude from a test', async () => {
    const { claudeClient } = await import('./ai-claude');
    expect(() => claudeClient()).toThrow(/never called from tests/);
  });
});
