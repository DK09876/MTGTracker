import { describe, expect, it } from 'vitest';

import { budgetFrom, DEFAULT_LADDER, ladder, msUntilReset, quotaDay, quotaViolation, requestsFor } from './quota';

describe('the quota day', () => {
  it('is the date in Pacific time', () => {
    // 06:00 UTC on the 25th is 23:00 on the 24th in Pacific daylight time.
    expect(quotaDay(new Date('2026-09-25T06:00:00Z'))).toBe('2026-09-24');
    expect(quotaDay(new Date('2026-09-25T08:00:00Z'))).toBe('2026-09-25');
  });

  it('resets at the next Pacific midnight', () => {
    expect(msUntilReset(new Date('2026-09-25T06:00:00Z'))).toBe(3_600_000);
  });
});

describe('ladder', () => {
  it('defaults to Flash-Lite alone, and can be set', () => {
    expect(ladder(undefined)).toBe(DEFAULT_LADDER);
    expect(DEFAULT_LADDER.map((m) => m.id)).toEqual(['gemini-3.5-flash-lite']);
    expect(ladder(' gemini-3.6-flash , other ').map((m) => m.label)).toEqual(['Gemini 3.6 Flash', 'other']);
  });
});

describe('budgetFrom', () => {
  it('counts down from the limit, and believes a refusal over the count', () => {
    const flash = ['3.8', '3.7', '3.6', '3.5'].map((v) => ({ id: `gemini-${v}-flash`, label: v }));
    const budget = budgetFrom(flash, [
      { model: 'gemini-3.8-flash', used: 5, quotaLimit: null, exhausted: false },
      { model: 'gemini-3.7-flash', used: 2, quotaLimit: 20, exhausted: true },
      { model: 'gemini-3.6-flash', used: 25, quotaLimit: null, exhausted: false },
    ]);
    expect(budget.models.map((m) => m.remaining)).toEqual([15, 0, 0, 20]);
    expect(budget.remaining).toBe(35);
  });
});

describe('quotaViolation', () => {
  it('tells a daily limit from a per-minute one', () => {
    const body = (quotaId: string) => ({ error: { details: [{ violations: [{ quotaId, quotaValue: '20' }] }] } });
    expect(quotaViolation(body('GenerateRequestsPerDayPerProjectPerModel-FreeTier'))).toEqual({ daily: true, limit: 20 });
    expect(quotaViolation(body('GenerateRequestsPerMinutePerProjectPerModel-FreeTier'))).toEqual({ daily: false, limit: 20 });
    expect(quotaViolation({ error: { message: 'x' } })).toBeNull();
  });
});

describe('requestsFor', () => {
  it('free mode is a handful of requests, smart mode about three times as many', () => {
    expect(requestsFor('free', 92, 16, true)).toBe(3);
    expect(requestsFor('smart', 92, 16, true)).toBe(12);
    expect(requestsFor('free', 92, 16, false)).toBe(2);
  });
});
