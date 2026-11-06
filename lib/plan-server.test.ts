/**
 * What accepting one of Claude's suggestions changes in the plan.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-plan-server-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

const names = new Set(['Revel in Riches', 'Mayhem Devil', 'Prosper, Tome-Bound']);

describe('Claude\'s suggestions, accepted', () => {
  it('maps each kind to a change made as Claude\'s', async () => {
    const { toChange } = await import('./plan-server');
    const one = (part: string, value: string, kind: 'proposal' | 'override' = 'proposal') => toChange({ kind, part, value, why: 'because' }, names, [], []);
    expect(one('style', 'Casting from exile').change).toEqual({ style: 'exile', by: 'claude' });
    expect(one('role', 'engine').change).toEqual({ role: 'Engine', by: 'claude' });
    expect(one('key', 'revel in riches').change).toEqual({ key: { add: 'Revel in Riches' }, by: 'claude' });
    // A card that is not in the deck can't be a key card.
    expect(one('key', 'Black Lotus').change).toBeNull();
    expect(one('theme', 'Treasure: Revel in Riches, Mayhem Devil').theme).toEqual({ name: 'Treasure', cards: ['Revel in Riches', 'Mayhem Devil'] });
    expect(one('route', 'Drain: Mayhem Devil').change).toEqual({ routes: { custom: { label: 'Drain', how: 'because', cards: ['Mayhem Devil'] } }, by: 'claude' });
    expect(one('flip', '6 mana').change).toEqual({ flip: 6, by: 'claude' });
  });

  it('turns overrides into changes to the usual rules, each saying what it does', async () => {
    const { toChange } = await import('./plan-server');
    const o = (part: string, value: string) => toChange({ kind: 'override', part, value, why: 'Cheap rocks.', affects: 'Lands' }, names, [], []).change?.overrides?.add;
    expect(o('lands', '36')).toMatchObject({ kind: 'lands', value: [36, 36], what: 'Lands → 36', by: 'claude' });
    expect(o('range:ramp', '9-10')).toMatchObject({ kind: 'range', target: 'ramp', value: [9, 10], what: 'Ramp → 9–10' });
    expect(o('rule:curve', 'off')).toMatchObject({ kind: 'rule-off', target: 'curve' });
    expect(o('cut fewer creatures', 'Keep every creature that makes treasure')).toMatchObject({ kind: 'exception', what: 'Keep every creature that makes treasure' });
  });
});
