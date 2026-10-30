import { describe, expect, it } from 'vitest';

import { claudeParams, claudeSchema, parseClaude } from './ai-claude';
import { costOf } from './models';
import { capFrom, dollars, overBudget, summarize } from './spend';

const row = (day: string, profileId: string, cost: number, model = 'claude-opus-5-5') =>
  ({ day, profileId, model, feature: 'rules', requests: 1, inputTokens: 0, outputTokens: 0, cost });

// Noon Pacific on 2026-10-30.
const NOW = new Date('2026-10-30T19:00:00Z');

describe('summarize', () => {
  it('splits today from the month and by profile, and leaves the smaller of the two caps', () => {
    const rows = [row('2026-10-01', 'dk', 3), row('2026-10-30', 'dk', 1.5), row('2026-10-30', 'kevin', 0.25), row('2026-10-30', 'dk', 0.1, 'claude-haiku-5-5')];
    const s = summarize(rows, 'dk', { daily: 5, perProfile: 2 }, NOW);
    expect(s.day).toBe('2026-10-30');
    expect(s.today).toBeCloseTo(1.85);
    expect(s.profileToday).toBeCloseTo(1.6);
    expect(s.left).toBeCloseTo(0.4);
    expect(s.month).toBeCloseTo(4.85);
    expect(s.byProfile.map((p) => p.profile)).toEqual(['dk', 'kevin']);
    expect(s.byModel[0]).toEqual({ model: 'claude-opus-5-5', cost: 1.75, requests: 2 });
    // Kevin's own cap has room, but the app's day is what binds once it is nearly spent.
    expect(summarize(rows, 'kevin', { daily: 2, perProfile: 2 }, NOW).left).toBeCloseTo(0.15);
  });

  it('says why a request may not be sent', () => {
    const s = (today: number, mine: number) => summarize([row('2026-10-30', 'dk', mine), row('2026-10-30', 'kevin', today - mine)], 'dk', { daily: 5, perProfile: 2 }, NOW);
    expect(overBudget(s(1, 1))).toBeNull();
    expect(overBudget(s(3, 2))).toMatch(/your share/);
    expect(overBudget(s(5, 1))).toMatch(/for the app/);
  });
});

describe('costOf', () => {
  it('prices Claude by its tokens, cache reads at a tenth, and free models at nothing', () => {
    expect(costOf('claude-opus-5-5', { input: 1_000_000, output: 100_000 })).toBeCloseTo(6);
    expect(costOf('claude-haiku-5-5', { input: 10_000, output: 1_000 })).toBeCloseTo(0.0015);
    expect(costOf('claude-sonnet-5-5', { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 1_000_000 })).toBeCloseTo(0.2 + 2.5);
    expect(costOf('openai/gpt-oss-120b', { input: 1_000_000, output: 1_000_000 })).toBe(0);
  });
});

describe('caps and dollars', () => {
  it('reads a cap as dollars from 0 to 200', () => {
    expect(capFrom('2.5')).toBe(2.5);
    expect(capFrom(3.333)).toBe(3.33);
    expect(capFrom('-1')).toBeNull();
    expect(capFrom('201')).toBeNull();
    expect(capFrom('x')).toBeNull();
  });

  it('shows small amounts to a tenth of a cent', () => {
    expect(dollars(0.0042)).toBe('$0.004');
    expect(dollars(1.2)).toBe('$1.20');
    expect(dollars(0)).toBe('$0.00');
  });
});

describe('claudeParams', () => {
  it('sends Gemini\'s schema as closed JSON Schema, nullable as "or null", with the system prompt cached', () => {
    const schema = {
      type: 'OBJECT',
      properties: {
        kind: { type: 'STRING', enum: ['cards', 'card'] },
        commander: { type: 'STRING', nullable: true },
        steps: { type: 'ARRAY', items: { type: 'OBJECT', properties: { n: { type: 'INTEGER' } }, required: ['n'] } },
      },
      required: ['kind'],
    };
    expect(claudeSchema(schema)).toEqual({
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['cards', 'card'] },
        commander: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        steps: { type: 'array', items: { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'], additionalProperties: false } },
      },
      required: ['kind'],
      additionalProperties: false,
    });
    const params = claudeParams('claude-opus-5-5', { system: 'S', user: 'U', schema, temperature: 0.2 }, 'high');
    expect(params.system).toEqual([{ type: 'text', text: 'S', cache_control: { type: 'ephemeral' } }]);
    expect(params.thinking).toEqual({ type: 'adaptive' });
    expect(params.output_config?.effort).toBe('high');
    // Current Claude models refuse a temperature.
    expect('temperature' in params).toBe(false);
  });

  it('can ask for the schema in the prompt instead, for one too large to enforce', () => {
    const params = claudeParams('claude-opus-5-5', { system: 'S', user: 'U', schema: { type: 'OBJECT', properties: {} } }, 'medium', false);
    expect(params.output_config).toEqual({ effort: 'medium' });
    expect(JSON.stringify(params.system)).toContain('matching this JSON Schema');
  });
});

describe('parseClaude', () => {
  const reply = (text: string) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 1 } }) as never;
  it('reads JSON bare, fenced, or with words around it', () => {
    expect(parseClaude(reply('{"a":1}'))).toEqual({ a: 1 });
    expect(parseClaude(reply('```json\n{"a":1}\n```'))).toEqual({ a: 1 });
    expect(parseClaude(reply('Here it is: {"a":1} - done'))).toEqual({ a: 1 });
    expect(() => parseClaude(reply('no json here'))).toThrow(/other than JSON/);
  });
});
