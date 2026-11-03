/**
 * The models each profile uses: a Regular or Smart mode per page, on the
 * app's model for that mode - only ones whose provider has a key, back to
 * the default when that key goes - and Claude held to the app's daily caps, with what it cost
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
  it('starts each page on its default mode, and keeps each profile\'s own choice per page', async () => {
    const ai = await import('./ai');
    // Rules start Smart (Opus); a deck's tags and search start Regular.
    expect(ai.modelFor('dk', 'rules')).toBe('claude-opus-5-5');
    expect(ai.modelFor('dk', 'tagging')).toBe('claude-sonnet-5-5');
    expect(ai.modelFor('dk', 'search')).toBe('claude-haiku-5-5');
    ai.chooseMode('dk', 'rules', 'regular');
    ai.chooseMode('dk', 'deck', 'smart');
    expect(ai.modelFor('dk', 'rules')).toBe('claude-sonnet-5-5');
    expect(ai.modelFor('dk', 'tagging')).toBe('claude-opus-5-5');
    expect(ai.modelFor('dk', 'tagcards')).toBe('claude-opus-5-5');
    expect(ai.modelFor('dk', 'search')).toBe('claude-haiku-5-5');
    // Another profile is not changed by dk's choice.
    expect(ai.modelFor('kevin', 'rules')).toBe('claude-opus-5-5');
    expect(ai.aiState('dk').modes).toEqual({ search: 'regular', rules: 'regular', deck: 'smart', chat: 'regular' });
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
    ai.chooseAppModel('openai/gpt-oss-120b', 'tagging', 'regular');
    expect(ai.currentBudget('dk', 'tagging').models.map((m) => m.id)).toEqual(['openai/gpt-oss-120b']);
    ai.chooseAppModel('gemini-3.8-flash', 'tagging', 'regular');
    expect(ai.currentBudget('dk', 'tagging').models.map((m) => m.id)).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
    expect(ai.currentBudget('dk', 'tagging').spend).toBeUndefined();
    expect(ai.currentBudget('dk', 'rules').spend?.caps).toEqual({ daily: 5, perProfile: 2 });
  });

  it('refuses an app model without a key or unknown, and forgets one whose key is gone', async () => {
    const ai = await import('./ai');
    expect(() => ai.chooseAppModel('mistral-medium-latest', 'rules', 'smart')).toThrow(/MISTRAL_API_KEY/);
    expect(() => ai.chooseAppModel('made-up', 'rules', 'smart')).toThrow(/Unknown/);
    expect(() => ai.chooseAppModel('openai/gpt-oss-20b', 'rules', 'smart')).toThrow(/Unknown/); // a helper, not offered
    expect(() => ai.chooseMode('dk', 'rules', 'turbo' as never)).toThrow(/Unknown mode/);
    ai.chooseAppModel('openai/gpt-oss-120b', 'rules', 'smart');
    expect(ai.modelFor('dk', 'rules')).toBe('openai/gpt-oss-120b');
    vi.stubEnv('GROQ_API_KEY', '');
    expect(ai.modelFor('dk', 'rules')).toBe('claude-opus-5-5');
    expect(ai.aiState('dk').models.find((m) => m.id === 'openai/gpt-oss-120b')?.hasKey).toBe(false);
  });

  it('thinks harder in Smart mode, and keeps caps', async () => {
    const ai = await import('./ai');
    expect(ai.effortFor('dk', 'rules')).toBe('high');
    expect(ai.effortFor('dk', 'tagging')).toBe('medium');
    expect(ai.effortFor('dk', 'search')).toBe('low');
    ai.chooseMode('dk', 'search', 'smart');
    expect(ai.effortFor('dk', 'search')).toBe('medium');
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
    beta: { messages: {
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
    } },
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
    // Rules start Smart, so it thinks hard; search stays quick.
    expect((sent[0] as { output_config: { effort: string } }).output_config.effort).toBe('high');
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

  it('prices an answer from Anthropic\'s fallback model as that model when it is dearer', async () => {
    const ai = await import('./ai');
    const { client } = fakeClaude();
    const answered: ClaudeClient = { beta: { messages: { stream: (p) => ({ finalMessage: async () => ({ ...(await client.beta.messages.stream(p).finalMessage()), model: 'claude-opus-4-8' }) }) } } };
    await ai.claudeModel('claude-opus-5-5', { profile: 'dk', feature: 'rules' }, () => answered)(ask);
    // 10K in at $5/M and 2K out at $25/M.
    expect(ai.currentSpend('dk').today).toBeCloseTo(0.1);
  });

  it('logs every request for the AI usage trail: answered, declined, and blocked by the cap', async () => {
    const ai = await import('./ai');
    const db = await import('./db');
    const { client } = fakeClaude();
    const charge = { profile: 'dk', feature: 'rules' as const, label: 'Blade of Selves + Kratos' };
    await ai.claudeModel('claude-opus-5-5', charge, () => client)({ ...ask, step: 'answer' });
    const declined = fakeClaude({ input_tokens: 0, output_tokens: 0 }, 'refusal');
    await expect(ai.claudeModel('claude-opus-5-5', charge, () => declined.client)(ask)).rejects.toThrow(/declined/);
    ai.setCaps({ perProfile: 0.05 });
    await expect(ai.claudeModel('claude-opus-5-5', charge, () => client)(ask)).rejects.toThrow(/your share/);
    const trail = db.aiCalls('2000-01-01');
    expect(trail.map((c) => c.outcome)).toEqual(['blocked', 'declined', 'ok']);
    expect(trail[2]).toMatchObject({
      profileId: 'dk', feature: 'rules', label: 'Blade of Selves + Kratos', step: 'answer', model: 'claude-opus-5-5',
      inputTokens: 10_000, outputTokens: 2_000,
    });
    expect(trail[2].cost).toBeCloseTo(0.08);
    expect(trail[0].cost).toBe(0);
  });

  it('refuses to reach the real Claude from a test', async () => {
    const { claudeClient } = await import('./ai-claude');
    expect(() => claudeClient()).toThrow(/never called from tests/);
  });
});
