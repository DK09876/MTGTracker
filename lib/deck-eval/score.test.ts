/**
 * The evaluation scorers on tiny made-up kits: the same numbers the Python
 * originals give (values below were produced by Python), no files, no network.
 */

import { describe, expect, it } from 'vitest';

import { PyRandom } from './pyrandom';
import {
  bootChoice, bootRange, gradedKit, gradedSummary, judgeArms, orphanPercentile, orphanSummary, pyRound, recallCompare, recallKit, recallSummary,
  swapVerdicts, triageSummary, type RecallKit,
} from './score';

describe('the Python-compatible generator', () => {
  it('draws what Python draws for the same seed', () => {
    const r = new PyRandom(7);
    expect([r.uint32(), r.uint32(), r.uint32()]).toEqual([1390851128, 4071050724, 647892279]);
    expect([0, 1, 2, 3, 4].map(() => r.randrange(29))).toEqual([12, 20, 1, 2, 26]);
    const g = new PyRandom(1);
    const xs = Array.from({ length: 30 }, (_, i) => i);
    expect([0, 1, 2, 3, 4].map(() => g.choice(xs))).toEqual([4, 18, 27, 25, 24]);
    expect(new PyRandom(0).uint32()).toBe(3626764237);
  });

  it('gives the same bootstrap intervals as the Python scorers', () => {
    const xs = [0.1, 0.5, 0.25, 0, 1, 0.75];
    expect(bootRange(xs)).toEqual({ mean: 0.43333333333333335, lo: 0.15833333333333333, hi: 0.725 });
    expect(bootChoice(xs)).toMatchObject({ lo: 0.15833333333333333, hi: 0.7083333333333334 });
  });

  it('rounds halves to even, as Python did', () => {
    expect([pyRound(2.5), pyRound(22.5), pyRound(3.5), pyRound(74.6)]).toEqual([2, 22, 4, 75]);
  });
});

describe('recall of the owner’s cuts', () => {
  const kit: RecallKit = { id: 'a', group: 'cut', k: 2, key: new Set(['opt', 'shock']), nonland: 10, keyLands: 0 };

  it('counts hits in the first K and recall further down a ranked list, by front name', () => {
    const r = recallKit(kit, { cuts: [{ name: 'Opt' }, { name: 'Ponder' }], ranked: ['Opt', 'Ponder', 'Brainstorm', 'Shock // Shock'] });
    expect(r).toMatchObject({ hit: 1, share: 0.5, ranked: true, r15: 0.5, r2: 1 });
  });

  it('scores random as the expected share of the non-land key cards', () => {
    const r = recallKit({ ...kit, keyLands: 1 }, 'rand');
    expect(r.share).toBeCloseTo(2 * 1 / 10 / 2);
    expect(r.r2).toBeCloseTo(4 * 1 / 10 / 2);
  });

  it('summarises by group and ALL, and pairs two runs per kit', () => {
    const k2 = { ...kit, id: 'b', group: 'maybe' };
    const a = [recallKit(kit, { cuts: ['Opt', 'Shock'] }), recallKit(k2, { cuts: ['Opt', 'X'] })];
    const b = [recallKit(kit, { cuts: ['X', 'Y'] }), recallKit(k2, { cuts: ['Opt', 'X'] })];
    const s = recallSummary(a);
    expect(s.map((x) => x.group)).toEqual(['cut', 'maybe', 'ALL']);
    expect(s[2]).toMatchObject({ n: 2, pooled: 0.75 });
    expect(s[2].topK.mean).toBe(0.75);
    expect(recallCompare(a, b)).toMatchObject({ n: 2, wins: 1, losses: 0 });
  });
});

describe('the blind judge on cuts', () => {
  it('scores each arm per kit (cut 1, ok 0.5, keep 0), leaving unrated picks out and counting them', () => {
    const out = judgeArms([
      { id: 'a', ratings: new Map([['opt', 'cut'], ['sol ring', 'keep']]), arms: { code: ['opt', 'sol ring'], ai: ['opt'] } },
      { id: 'b', ratings: new Map([['shock', 'ok']]), arms: { code: ['shock', 'never rated'], ai: ['shock'] } },
    ]);
    const code = out.find((a) => a.arm === 'code')!;
    expect(code.score.mean).toBeCloseTo((0.5 + 0.5) / 2);
    expect(code.badRate.mean).toBeCloseTo((0.5 + 0) / 2);
    expect([code.rated, code.total]).toEqual([3, 4]);
    expect(out.find((a) => a.arm === 'ai')!.score.mean).toBeCloseTo(0.75);
  });
});

describe('first look: warnings per group', () => {
  it('counts decks warned, land warnings old and new, and whether broken basics were caught', () => {
    const s = triageSummary([
      { id: 't1', group: 'tuned', flags: ['lands low: 35 vs 37-38', 'Ramp high: 14 vs 10-12'] },
      { id: 't2', group: 'tuned', flags: [] },
      { id: 's1', group: 'starved', flags: ['27 lands, far under 37–38'], starved: 'lands' },
      { id: 's2', group: 'starved', flags: ['Ramp low'], starved: 'draw' },
    ]);
    expect(s.groups.find((g) => g.group === 'tuned')).toMatchObject({ n: 2, flagged: 1, meanFlags: 1, landFlag: 1 });
    expect(s.all).toMatchObject({ n: 4, flagged: 3, landFlag: 2 });
    expect(s.starvedCaught).toEqual([{ id: 's1', kind: 'lands', caught: true }, { id: 's2', kind: 'draw', caught: false }]);
    expect(s.kinds.map((k) => k.flag)).toContain('lands far under');
  });
});

describe('swaps, packages and graded cards', () => {
  it('tallies the judge’s verdicts for one arm', () => {
    expect(swapVerdicts([{ arm: 'code', verdict: 'worse', outOk: 'no' }, { arm: 'code', verdict: 'better', outOk: 'yes' }, { arm: 'ai', verdict: 'better' }, { arm: 'code' }], 'code'))
      .toEqual({ n: 3, better: 1, even: 0, worse: 1, unrated: 1, outOk: 1 });
  });

  it('places the orphan among the kit’s valid names, ignoring unknown and repeated ones', () => {
    const valid = ['A', 'B', 'Orphan', 'C', 'D'];
    expect(orphanPercentile(['Orphan', 'A', 'Zzz', 'A', 'B', 'C', 'D'], valid, 'Orphan')).toBe(0);
    expect(orphanPercentile(['A', 'B', 'C', 'D', 'Orphan'], valid, 'Orphan')).toBe(100);
    expect(orphanPercentile(['A', 'B'], valid, 'Orphan')).toBeNull();
    expect(orphanSummary([-50, -20, 15])).toMatchObject({ n: 3, towardCut: 2, towardKeep: 1 });
  });

  it('shares each grade has in the top K, and bad minus good', () => {
    const grade = new Map([['bad1', 'bad'], ['bad2', 'bad'], ['good1', 'good'], ['good2', 'good'], ['meh', 'mediocre']]);
    const row = gradedKit({ id: 'x', k: 2, grade }, { ranked: ['Bad1', 'Orig', 'Good1', 'Bad2', 'Meh'] });
    expect(row.byGrade.bad).toMatchObject({ n: 2, topK: 0.5, top2K: 1, rank: 2.5 });
    expect(row.byGrade.good).toMatchObject({ topK: 0, top2K: 0.5, rank: (3 + 6) / 2 });
    expect(row.origCut).toBe(1);
    expect(gradedSummary([row]).badMinusGood.topK.mean).toBe(0.5);
  });
});
