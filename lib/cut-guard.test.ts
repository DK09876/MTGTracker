/**
 * The guards every cut list goes through, from the rules or from a model:
 * the exact count, the land floor, and never-cut cards.
 */

import { describe, expect, it } from 'vitest';

import { guardCuts, type GuardRules } from './cut-guard';

const rules = (over: Partial<GuardRules> = {}): GuardRules => ({ count: 3, lands: { have: 37, floor: 36 }, never: new Map(), ...over });
const c = (name: string, land = false) => ({ name, land });
const names = (r: { kept: Array<{ name: string }> }) => r.kept.map((x) => x.name);

describe('cut guards', () => {
  it('clamps to the exact count, keeping the list order', () => {
    const out = guardCuts([c('A'), c('B'), c('C'), c('D'), c('E')], rules({ count: 3 }));
    expect(names(out)).toEqual(['A', 'B', 'C']);
    expect(out.dropped.map((d) => d.why)).toEqual(['past the 3 to cut', 'past the 3 to cut']);
  });

  it('counts quantities toward the count', () => {
    const out = guardCuts([{ name: 'Basic', land: false, quantity: 2 }, c('B'), c('C')], rules({ count: 3 }));
    expect(names(out)).toEqual(['Basic', 'B']);
  });

  it('a count of zero cuts nothing; no count is a browse list', () => {
    expect(guardCuts([c('A')], rules({ count: 0 })).kept).toEqual([]);
    expect(names(guardCuts([c('A'), c('B'), c('C'), c('D')], rules({ count: null })))).toEqual(['A', 'B', 'C', 'D']);
  });

  it('never takes lands below the land floor, and lets the next spell take the slot', () => {
    // 37 lands, floor 36: one land may go, the second may not.
    const out = guardCuts([c('Island', true), c('Forest', true), c('Spell')], rules({ count: 3 }));
    expect(names(out)).toEqual(['Island', 'Spell']);
    expect(out.dropped[0]).toMatchObject({ item: { name: 'Forest' }, why: expect.stringMatching(/under its 36/) });
  });

  it('never cuts a land at or under the floor', () => {
    const out = guardCuts([c('Island', true)], rules({ lands: { have: 36, floor: 36 } }));
    expect(out.kept).toEqual([]);
  });

  it('never includes never-cut cards, and says why', () => {
    const never = new Map([['Sol Ring', '★ you kept it'], ['Azula', 'commander']]);
    const out = guardCuts([c('Sol Ring'), c('Azula'), c('Mind Stone')], rules({ never }));
    expect(names(out)).toEqual(['Mind Stone']);
    expect(out.dropped.map((d) => d.why)).toEqual(['never cut: ★ you kept it', 'never cut: commander']);
  });

  it('drops a card listed twice', () => {
    expect(names(guardCuts([c('A'), c('A'), c('B')], rules()))).toEqual(['A', 'B']);
  });
});
