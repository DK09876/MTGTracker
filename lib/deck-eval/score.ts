/**
 * Scorers for the deck-flow evaluation kits, ported from the Python
 * scorers used in the 2026-11-10 evaluation (score-real.py, judge-score.py,
 * triage-score.py, the swap judge tally, orphan-score.py, graded-score.py)
 * with the same matching rules and the same seeded bootstrap, so a frozen
 * run scores exactly as it did then. Pure: scripts/deck-eval/ loads the
 * files and prints the tables.
 *
 * Every interval is a bootstrap over kits (10,000 resamples). Each scorer
 * keeps its original seed and percentile indices; they differ slightly, as
 * the Python did.
 */

import { PyRandom } from './pyrandom';

export const front = (n: string) => n.split(' // ')[0].trim().toLowerCase();
export const isLandType = (t: string | undefined) => /\bLand\b/.test((t ?? '').split('//')[0]);

const B = 10_000;

/** Python's round(): halves go to the even neighbour (2.5 -> 2, 22.5 -> 22), as the evaluation's percentages were rounded. */
export function pyRound(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (Math.abs(d - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}
export type Interval = { mean: number; lo: number; hi: number };

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** score-real.py, graded-score.py: Random(7), randrange, 2.5th and (97.5th - 1) of the sorted means. */
export function bootRange(xs: number[], seed = 7): Interval {
  if (!xs.length) return { mean: NaN, lo: NaN, hi: NaN };
  const r = new PyRandom(seed);
  const n = xs.length;
  const means: number[] = [];
  for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < n; i++) s += xs[r.randrange(n)]; means.push(s / n); }
  means.sort((a, b) => a - b);
  return { mean: sum(xs) / n, lo: means[Math.floor(0.025 * B)], hi: means[Math.floor(0.975 * B) - 1] };
}

/** judge-score.py: seed 1, choice, 2.5th and 97.5th of the sorted means. */
export function bootChoice(xs: number[], seed = 1): Interval {
  if (!xs.length) return { mean: NaN, lo: NaN, hi: NaN };
  const r = new PyRandom(seed);
  const n = xs.length;
  const means: number[] = [];
  for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < n; i++) s += r.choice(xs); means.push(s / n); }
  means.sort((a, b) => a - b);
  return { mean: sum(xs) / n, lo: means[Math.floor(0.025 * B)], hi: means[Math.floor(0.975 * B)] };
}

/** orphan-score.py: Random(7), choice, 2.5th and (97.5th - 1). */
export function bootChoiceSeven(xs: number[]): Interval {
  if (!xs.length) return { mean: NaN, lo: NaN, hi: NaN };
  const r = new PyRandom(7);
  const means: number[] = [];
  for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < xs.length; i++) s += r.choice(xs); means.push(s / xs.length); }
  means.sort((a, b) => a - b);
  return { mean: sum(xs) / xs.length, lo: means[Math.floor(0.025 * B)], hi: means[Math.floor(0.975 * B) - 1] };
}

// --- recall of real owners' cuts (real/, primer/) ---------------------------------------

/** A run's answer file: `cuts` (its first K) and, for ranked runs, `ranked` (the whole list). */
export interface RunAnswer { cuts?: Array<{ name: string } | string>; ranked?: Array<{ name: string } | string> }
export interface RecallKit { id: string; group: string; k: number; key: Set<string>; nonland: number; keyLands: number }
export interface RecallRow { id: string; group: string; k: number; hit: number; share: number; ranked: boolean; given: number; r15?: number; r2?: number }

const names = (xs: RunAnswer['cuts']) => (xs ?? []).map((x) => (typeof x === 'string' ? x : x?.name ?? ''));

/** One kit: hits in the first K, and recall in the top K / 1.5K / 2K for a ranked list. `rand` is the analytic random pick. */
export function recallKit(kit: RecallKit, ans: RunAnswer | 'rand'): RecallRow {
  const { k } = kit;
  const m15 = Math.ceil(1.5 * k);
  const m2 = 2 * k;
  if (ans === 'rand') {
    const a = kit.key.size - kit.keyLands;
    const n = kit.nonland;
    const r = (m: number) => (Math.min(m, n) * a) / n / k;
    return { id: kit.id, group: kit.group, k, hit: (k * a) / n, share: r(k), r15: r(m15), r2: r(m2), ranked: true, given: k };
  }
  const cuts = names(ans.cuts);
  const ranked = names(ans.ranked).length ? names(ans.ranked) : cuts;
  const lst = ranked.length > cuts.length ? ranked : cuts;
  const hits = (m: number) => [...new Set(lst.slice(0, m).map(front))].filter((x) => kit.key.has(x)).length;
  const row: RecallRow = { id: kit.id, group: kit.group, k, hit: hits(k), share: hits(k) / k, ranked: lst.length > k, given: cuts.length };
  if (row.ranked) { row.r15 = hits(m15) / k; row.r2 = hits(m2) / k; }
  return row;
}

export interface RecallSummary { group: string; n: number; topK: Interval; pooled: number; top15K?: Interval; top2K?: Interval }

/** Per group (sorted) and ALL, as score-real.py prints them. */
export function recallSummary(rows: RecallRow[]): RecallSummary[] {
  const groups = [...new Set(rows.map((r) => r.group))].sort();
  return [...groups, 'ALL'].map((g) => {
    const rs = rows.filter((r) => g === 'ALL' || r.group === g);
    const s: RecallSummary = { group: g, n: rs.length, topK: bootRange(rs.map((r) => r.share)), pooled: sum(rs.map((r) => r.hit)) / sum(rs.map((r) => r.k)) };
    if (rs.every((r) => r.ranked)) { s.top15K = bootRange(rs.map((r) => r.r15!)); s.top2K = bootRange(rs.map((r) => r.r2!)); }
    return s;
  });
}

/** Paired A - B on per-kit share of K, over the kits both runs answered. */
export function recallCompare(a: RecallRow[], b: RecallRow[]): { n: number; diff: Interval; wins: number; losses: number } {
  const byB = new Map(b.map((r) => [r.id, r]));
  const d = a.filter((r) => byB.has(r.id)).map((r) => r.share - byB.get(r.id)!.share);
  return { n: d.length, diff: bootRange(d), wins: d.filter((x) => x > 0).length, losses: d.filter((x) => x < 0).length };
}

// --- blind per-card judge on cuts (real/) ------------------------------------------------

export type Rating = 'cut' | 'ok' | 'keep';
const VALUE: Record<Rating, number> = { cut: 1, ok: 0.5, keep: 0 };
export interface JudgeKit { id: string; arms: Record<string, string[]>; ratings: Map<string, string> }
export interface JudgeArm { arm: string; kits: number; score: Interval; badRate: Interval; rated: number; total: number }

/**
 * Per arm: the mean per-kit score (cut 1, ok 0.5, keep 0) and the share
 * rated keep (bad cuts). `arms` holds each arm's picks (front names) per
 * kit; picks without a rating are left out and counted as unrated.
 */
export function judgeArms(kits: JudgeKit[]): JudgeArm[] {
  const per = new Map<string, Map<string, Rating[]>>();
  const cover = new Map<string, { rated: number; total: number }>();
  for (const kit of kits) {
    for (const [arm, picks] of Object.entries(kit.arms)) {
      const c = cover.get(arm) ?? { rated: 0, total: 0 };
      for (const p of picks) {
        c.total += 1;
        const r = kit.ratings.get(p) as Rating | undefined;
        if (!r || !(r in VALUE)) continue;
        c.rated += 1;
        const m = per.get(arm) ?? new Map<string, Rating[]>();
        m.set(kit.id, [...(m.get(kit.id) ?? []), r]);
        per.set(arm, m);
      }
      cover.set(arm, c);
    }
  }
  return [...per.keys()].sort().map((arm) => {
    const m = per.get(arm)!;
    const sc = [...m.values()].map((rs) => sum(rs.map((r) => VALUE[r])) / rs.length);
    const kp = [...m.values()].map((rs) => rs.filter((r) => r === 'keep').length / rs.length);
    return { arm, kits: m.size, score: bootChoice(sc), badRate: bootChoice(kp), ...cover.get(arm)! };
  });
}

// --- first look: what the code flags (triage/) -------------------------------------------

export const TRIAGE_GROUPS = ['tuned', 'precon', 'casual', 'mixed', 'starved', 'pile'] as const;
export interface TriageKit { id: string; group: string; flags: string[]; starved?: 'lands' | 'draw' }
export interface TriageSummary {
  group: string; n: number; flagged: number; meanFlags: number;
  /** Kits with a land warning: "lands low" in the old code, a land warning now. */
  landFlag: number;
}

const LAND_FLAG = /^lands low|lands, far under/i;
const DRAW_FLAG = /^Card draw low|^No card draw/i;

export function triageSummary(kits: TriageKit[]): { groups: TriageSummary[]; all: TriageSummary; starvedCaught: Array<{ id: string; kind: string; caught: boolean }>; kinds: Array<{ flag: string; byGroup: Record<string, number> }> } {
  const summ = (group: string, ks: TriageKit[]): TriageSummary => ({
    group, n: ks.length, flagged: ks.filter((k) => k.flags.length).length,
    meanFlags: ks.length ? sum(ks.map((k) => k.flags.length)) / ks.length : 0,
    landFlag: ks.filter((k) => k.flags.some((f) => LAND_FLAG.test(f))).length,
  });
  const groups = TRIAGE_GROUPS.map((g) => summ(g, kits.filter((k) => k.group === g)));
  const starvedCaught = kits.filter((k) => k.starved).map((k) => ({ id: k.id, kind: k.starved!, caught: k.flags.some((f) => (k.starved === 'lands' ? LAND_FLAG : DRAW_FLAG).test(f)) }));
  // Flag kinds, as triage-score.py groups them (text before a colon; colour shortfalls as one).
  const kinds = new Map<string, Record<string, Set<string>>>();
  for (const k of kits) {
    for (const f of k.flags) {
      const key = f.replace(/:.*/, '').replace(/Short on \w+ sources/, 'Short on a colour').replace(/^[\d.]+ lands, far under.*/, 'lands far under');
      const byG = kinds.get(key) ?? Object.fromEntries(TRIAGE_GROUPS.map((g) => [g, new Set<string>()]));
      byG[k.group]?.add(k.id);
      kinds.set(key, byG);
    }
  }
  return {
    groups, all: summ('ALL', kits), starvedCaught,
    kinds: [...kinds].map(([flag, g]) => ({ flag, byGroup: Object.fromEntries(Object.entries(g).map(([x, s]) => [x, s.size])) }))
      .sort((a, b) => sum(Object.values(b.byGroup)) - sum(Object.values(a.byGroup)) || a.flag.localeCompare(b.flag)),
  };
}

// --- swaps for decks at 100 (swaps/) --------------------------------------------------------

export interface SwapJudged { arm: string; verdict?: string; outOk?: string }
export function swapVerdicts(swaps: SwapJudged[], arm: string): { n: number; better: number; even: number; worse: number; unrated: number; outOk: number } {
  const xs = swaps.filter((s) => s.arm === arm);
  const c = (v: string) => xs.filter((s) => s.verdict === v).length;
  return { n: xs.length, better: c('better'), even: c('even'), worse: c('worse'), unrated: xs.filter((s) => !s.verdict).length, outOk: xs.filter((s) => s.outOk === 'yes').length };
}

// --- packages: is a card valued by its partners? (orphan/) -------------------------------

/** The orphan's position in a ranking among the kit's valid names: 0 = cut first, 100 = last. Null when it is not listed. */
export function orphanPercentile(ranked: Array<{ name: string } | string>, valid: string[], orphan: string): number | null {
  const by = new Map(valid.map((n) => [n.split(' // ')[0].toLowerCase(), n]));
  const seen: string[] = [];
  for (const x of ranked) {
    const n = typeof x === 'string' ? x : x.name;
    const v = by.get(n.split(' // ')[0].toLowerCase());
    if (v && !seen.includes(v)) seen.push(v);
  }
  const i = seen.indexOf(orphan);
  return i < 0 ? null : (100 * i) / (seen.length - 1);
}

export function orphanSummary(ds: number[]): { n: number; mean: Interval; towardCut: number; towardKeep: number } {
  return { n: ds.length, mean: bootChoiceSeven(ds), towardCut: ds.filter((d) => d < -10).length, towardKeep: ds.filter((d) => d > 10).length };
}

// --- graded additions (graded/) -----------------------------------------------------------

export const GRADES = ['good', 'mediocre', 'bad'] as const;
export interface GradedKit { id: string; k: number; grade: Map<string, string> }
export interface GradedRow { id: string; k: number; byGrade: Record<string, { n: number; topK: number; top2K: number; rank: number }>; origCut: number }

export function gradedKit(kit: GradedKit, ans: RunAnswer): GradedRow {
  const cuts = names(ans.cuts);
  const ranked = names(ans.ranked);
  const lst = (ranked.length > cuts.length ? ranked : cuts).map(front);
  const pos = new Map<string, number>();
  lst.forEach((n, i) => { if (!pos.has(n)) pos.set(n, i + 1); });
  const { k } = kit;
  const byGrade: GradedRow['byGrade'] = {};
  for (const g of GRADES) {
    const cs = [...kit.grade].filter(([, gg]) => gg === g).map(([n]) => n);
    byGrade[g] = {
      n: cs.length,
      topK: cs.filter((c) => lst.slice(0, k).includes(c)).length / cs.length,
      top2K: cs.filter((c) => lst.slice(0, 2 * k).includes(c)).length / cs.length,
      rank: sum(cs.map((c) => pos.get(c) ?? lst.length + 1)) / cs.length,
    };
  }
  return { id: kit.id, k, byGrade, origCut: lst.slice(0, k).filter((n) => !kit.grade.has(n)).length };
}

export function gradedSummary(rows: GradedRow[]) {
  const by = Object.fromEntries(GRADES.map((g) => [g, { topK: bootRange(rows.map((r) => r.byGrade[g].topK)), top2K: bootRange(rows.map((r) => r.byGrade[g].top2K)), rank: bootRange(rows.map((r) => r.byGrade[g].rank)) }]));
  return {
    n: rows.length, by,
    badMinusGood: { topK: bootRange(rows.map((r) => r.byGrade.bad.topK - r.byGrade.good.topK)), top2K: bootRange(rows.map((r) => r.byGrade.bad.top2K - r.byGrade.good.top2K)) },
    badAboveGood: rows.filter((r) => r.byGrade.bad.topK > r.byGrade.good.topK).length,
    origCut: bootRange(rows.map((r) => r.origCut)),
  };
}
