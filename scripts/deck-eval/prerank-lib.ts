/**
 * The code-only cut pre-ranker (A3), from the evaluation (feat/flow-eval scripts/plan-eval/prerank-lib.ts),
 * unchanged except that the frozen weights live here. A3n = A3 with the popularity weights at 0: what the
 * findings call "code pre-ranker without popularity". It reads the app's fit.ts, so changes there move it.
 * Reads the card copy (MTG_CARDS_DB_PATH) when first imported: import it after the env is set.
 */

import { allLocalCards } from '../../lib/card-store';
import { fitOf, fitProfile } from '../../lib/fit';
import type { ScryfallCard } from '../../lib/scryfall';

const front = (n: string) => n.split(' // ')[0];
export const lc = (n: string) => front(n).toLowerCase();

export type FCard = { name: string; quantity: number; cost: string; mv: number; type: string; text: string; jobs: string[]; gameChanger: boolean };
export type PFacts = { commanders: Array<{ name: string }>; jobs: Array<{ job: string; label: string; count: number | null; range: [number, number] | null }>; combos: { included: Array<{ cards: string[] }> | null }; cards: FCard[] };

export const isLandCard = (c: FCard) => /\bLand\b/.test(c.type.split('//')[0]);
const ORACLE = new Map<string, ScryfallCard>();
const ORACLE_FRONT = new Map<string, ScryfallCard>();
for (const c of allLocalCards()) {
  if (!ORACLE.has(c.name.toLowerCase())) ORACLE.set(c.name.toLowerCase(), c);
  if (!ORACLE_FRONT.has(lc(c.name)) && c.legalities?.commander) ORACLE_FRONT.set(lc(c.name), c);
}
export const oracle = (n: string) => ORACLE.get(n.toLowerCase()) ?? ORACLE_FRONT.get(lc(n));

// Weights. DEFAULT is the hand-set v2 without recent; the tuned set lives in cuts2/shortlist-recall.json.
export type W = { rareHi: number; rareMid: number; popular: number; combo: number; fitPer: number; short: number; over: number; idle: number; dear: number; mv6: number; mv5: number; gc: number };
/** Frozen from h2h/cuts2/shortlist-recall.json (tuned on the synthetic kits). */
export const A3: W = { rareHi: 0.5, rareMid: 0.25, popular: 0, combo: -3, fitPer: -1.5, short: -1.5, over: 0.5, idle: 2, dear: 0.5, mv6: 0.7, mv5: 0.3, gc: -1 };
export const A3N: W = { ...A3, rareHi: 0, rareMid: 0, popular: 0 };
export const DEFAULT: W = { rareHi: 1, rareMid: 0.5, popular: -0.5, combo: -3, fitPer: -0.75, short: -1.5, over: 1, idle: 1, dear: 0.5, mv6: 0.7, mv5: 0.3, gc: -1 };
const BIG = 20000;
export type Signal = { name: string; score: number; signals: string[]; rank: number | null; mv: number; jobs: string[] };

export function preRank(f: PFacts, stars: Set<string>, rank: Record<string, number | null>, w: W): Signal[] {
  const commander = oracle(f.commanders[0].name) ?? null;
  const fit = fitProfile(commander);
  const combo = new Set((f.combos.included ?? []).flatMap((c) => c.cards.map(lc)));
  const jobs = new Map(f.jobs.filter((j) => j.range && j.count !== null).map((j) => [j.label, j]));
  const over = (label: string) => { const j = jobs.get(label); return j ? (j.count ?? 0) - j.range![1] : 0; };
  const under = (label: string) => { const j = jobs.get(label); return !!j && (j.count ?? 0) < j.range![0]; };
  const spells = f.cards.filter((c) => !isLandCard(c) && !stars.has(lc(c.name)));
  // Redundancy within a job: in a job over its range, the dearer half of its cards.
  const dearHalf = new Set<string>();
  for (const [label] of jobs) {
    if (over(label) <= 0) continue;
    const xs = spells.filter((c) => c.jobs.includes(label)).sort((x, y) => y.mv - x.mv);
    for (const c of xs.slice(0, Math.ceil(xs.length / 2))) dearHalf.add(c.name);
  }
  const out: Signal[] = [];
  for (const c of spells) {
    const s: string[] = []; let score = 0;
    const add = (d: number, why: string) => { if (!d) return; d = Math.round(d * 100) / 100; score += d; s.push(`${d > 0 ? '+' : ''}${d} ${why}`); };
    const r = rank[c.name] ?? null;
    const rr = r ?? BIG;
    if (rr > 8000) add(w.rareHi, `rarely played (rank ${r ?? 'none'})`); else if (rr > 3000) add(w.rareMid, `not often played (rank ${r})`); else if (rr < 300) add(w.popular, `very popular (rank ${r})`);
    if (combo.has(lc(c.name))) add(w.combo, 'in a Spellbook combo');
    const card = oracle(c.name);
    const m = card ? fitOf(card, fit).matches : [];
    if (m.length) add(Math.max(-2, w.fitPer * m.length), `fits the commander (${m.join(', ')})`);
    const own = c.jobs.filter((j) => jobs.has(j));
    if (own.some((j) => under(j))) add(w.short, `a job the deck is short of (${own.filter(under).join(', ')})`);
    else if (own.some((j) => over(j) > 0)) add(w.over, `its job is over range (${own.filter((j) => over(j) > 0).join(', ')})`);
    if (!c.jobs.length && !m.length) add(w.idle, 'no job, no fit');
    if (dearHalf.has(c.name)) add(w.dear, 'the dearer half of an over-full job');
    if (c.mv >= 6) add(w.mv6, `costs ${c.mv}`); else if (c.mv === 5) add(w.mv5, 'costs 5');
    if (c.gameChanger) add(w.gc, 'Game Changer');
    out.push({ name: c.name, score: Math.round(score * 100) / 100, signals: s, rank: r, mv: c.mv, jobs: c.jobs });
  }
  return out.sort((x, y) => y.score - x.score || y.mv - x.mv || x.name.localeCompare(y.name));
}
