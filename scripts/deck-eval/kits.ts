/**
 * Reads the frozen evaluation kits (outside the repo, under DECK_EVAL_DATA)
 * into the shapes lib/deck-eval/score.ts scores. Each loader mirrors how the
 * original Python scorer read its folder. Nothing here writes.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import { front, isLandType, type GradedKit, type JudgeKit, type RecallKit, type RunAnswer, type SwapJudged, type TriageKit } from '../../lib/deck-eval/score';

export const DATA = process.env.DECK_EVAL_DATA || join(homedir(), 'Desktop/Development/mtg-eval-data');

const json = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;
const jsonFiles = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : []);

type Facts = { size: number; commanders: Array<{ name: string }>; cards: Array<{ name: string; type: string; quantity: number }> };
export const facts = (p: string) => json<Facts>(p);

/** A run's answer for one kit: `run` is a folder name under <kit>/out, or a path. Null when it did not answer. */
export function runAnswer(kitDir: string, run: string, id: string): RunAnswer | null {
  const base = existsSync(run) ? run : join(kitDir, 'out', run);
  const p = join(base, `${id}.json`);
  if (!existsSync(p)) return null;
  try { return json<RunAnswer>(p); } catch { return { cuts: [] }; }
}

// --- real/ and primer/: recall of the owner's cuts ---

type Answer = { id: string; source: string; k: number; answer: string[] | null; answerLands?: string[]; grades?: Record<string, string>; peerTier?: string };

export function recallKits(kitDir: string): RecallKit[] {
  return jsonFiles(join(kitDir, 'answers')).map((f) => json<Answer>(join(kitDir, 'answers', f))).filter((a) => a.answer?.length).map((a) => {
    const fc = facts(join(kitDir, 'kits', a.id, 'facts.json'));
    return {
      id: a.id, group: a.source, k: a.k, key: new Set(a.answer!.map(front)),
      nonland: fc.cards.filter((c) => !isLandType(c.type)).length, keyLands: new Set((a.answerLands ?? []).map(front)).size,
    };
  });
}

// --- real/: the blind per-card judge on cuts ---
// The ratings FINDINGS.md reports: candidates mapped in judge4/map, ratings merged from every round in judge-merged3/fable.
export const JUDGE = { map: 'judge4/map', ratings: 'judge-merged3/fable' };

type JudgeMap = { k: number; source: string; cands: Record<string, { name: string; arms: string[]; key?: boolean; decoy?: boolean }> };

/** Frozen arms: each arm's picks as the judge map lists them. */
export function judgeKitsFrozen(realDir: string, arms: string[]): JudgeKit[] {
  return jsonFiles(join(realDir, JUDGE.ratings)).filter((f) => existsSync(join(realDir, JUDGE.map, f))).map((f) => {
    const m = json<JudgeMap>(join(realDir, JUDGE.map, f));
    const id = f.slice(0, -5);
    return { id, ratings: judgeRatings(realDir, id), arms: Object.fromEntries(arms.map((a) => [a, Object.entries(m.cands).filter(([, c]) => c.arms.includes(a)).map(([n]) => n)])) };
  });
}

export function judgeRatings(realDir: string, id: string): Map<string, string> {
  const p = join(realDir, JUDGE.ratings, `${id}.json`);
  if (!existsSync(p)) return new Map();
  return new Map(json<{ ratings: Array<{ name: string; rating: string }> }>(p).ratings.map((r) => [front(r.name), r.rating.trim().toLowerCase()]));
}

/** Any run's top K per kit, rated with the frozen ratings: picks the judge never saw count as unrated. */
export function judgeKitsFor(realDir: string, runs: Record<string, string>): JudgeKit[] {
  return jsonFiles(join(realDir, JUDGE.ratings)).filter((f) => existsSync(join(realDir, JUDGE.map, f))).map((f) => {
    const id = f.slice(0, -5);
    const k = json<JudgeMap>(join(realDir, JUDGE.map, f)).k;
    const arms: Record<string, string[]> = {};
    for (const [arm, run] of Object.entries(runs)) {
      const ans = runAnswer(realDir, run, id);
      if (!ans) continue;
      const lst = (ans.ranked?.length ? ans.ranked : ans.cuts) ?? [];
      arms[arm] = [...new Set(lst.slice(0, k).map((x) => front(typeof x === 'string' ? x : x.name)))];
    }
    return { id, ratings: judgeRatings(realDir, id), arms };
  });
}

// --- triage/: what the code flags ---

type Label = { id: string; group: string; reader: string; starved?: { kind: 'lands' | 'draw' } };
export const triageLabels = (dir: string) => json<Record<string, Label>>(join(dir, 'labels.json'));

/** Frozen: the flags code/<reader>.json recorded when the kits were built. */
export function triageFrozen(dir: string): TriageKit[] {
  return Object.values(triageLabels(dir)).map((l) => ({ id: l.id, group: l.group, starved: l.starved?.kind, flags: json<{ flags: string[] }>(join(dir, 'code', `${l.reader}.json`)).flags }));
}

/** Regenerated: flags written by regen.ts as <out>/<id>.json. */
export function triageFrom(dir: string, out: string): TriageKit[] {
  return Object.values(triageLabels(dir)).filter((l) => existsSync(join(out, `${l.id}.json`)))
    .map((l) => ({ id: l.id, group: l.group, starved: l.starved?.kind, flags: json<{ flags: string[] }>(join(out, `${l.id}.json`)).flags }));
}

// --- swaps/: the judge's verdict on each swap ---

export function swapJudged(dir: string): SwapJudged[] {
  const out: SwapJudged[] = [];
  for (const f of jsonFiles(join(dir, 'judge/map'))) {
    const m = json<Array<{ arm: string }>>(join(dir, 'judge/map', f));
    const p = join(dir, 'judge/out/fable', f);
    const r = existsSync(p) ? new Map(json<{ ratings: Array<{ i: number; verdict: string; out_ok: string }> }>(p).ratings.map((x) => [x.i, x])) : new Map();
    m.forEach((s, i) => out.push({ arm: s.arm, verdict: r.get(i + 1)?.verdict, outOk: r.get(i + 1)?.out_ok }));
  }
  return out;
}

// --- orphan/: a package piece with and without its partners ---

type OrphanLabel = { orphan: string; kits: { with: string; without: string } };
export const orphanLabels = (dir: string) => Object.entries(json<Record<string, OrphanLabel>>(join(dir, 'labels.json'))).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/** Non-land, non-commander names of a kit's facts: the names a ranking is placed among. */
export function validNames(factsPath: string): string[] {
  const f = facts(factsPath);
  const cmd = new Set(f.commanders.map((c) => c.name.split(' // ')[0].toLowerCase()));
  return f.cards.filter((c) => !isLandType(c.type) && !cmd.has(c.name.split(' // ')[0].toLowerCase())).map((c) => c.name);
}

export const orphanFacts = (dir: string, deck: string) => ({
  with: join(dir, '..', 'real', 'kits', deck, 'facts.json'),
  without: join(dir, 'kits', `${deck}-without`, 'facts.json'),
});

// --- graded/: inserted cards of known grade ---

export function gradedKits(dir: string): GradedKit[] {
  return jsonFiles(join(dir, 'answers')).map((f) => json<Answer>(join(dir, 'answers', f)))
    .map((a) => ({ id: a.id, k: a.k, grade: new Map(Object.entries(a.grades ?? {}).map(([n, g]) => [front(n), g])) }));
}
