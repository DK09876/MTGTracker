/**
 * Scores the app's code route on the frozen deck-flow evaluation kits.
 *
 *   npm run deck-eval                      regenerate with the current code, score, and print beside the frozen runs
 *   npm run deck-eval -- --frozen          score only the frozen code runs (checks the port against FINDINGS.md)
 *   npm run deck-eval -- --kits real,triage   only these kit sets (real, primer, triage, swaps, orphan, graded)
 *   npm run deck-eval -- --out <dir>       where regenerated runs go (default: a new temp folder; never the kits)
 *   npm run deck-eval -- --run <name>      also score <kit>/out/<name> (e.g. an AI run) on the recall and judge tables
 *
 * Kit data: DECK_EVAL_DATA (default ~/Desktop/Development/mtg-eval-data). See README.md here.
 */

import { spawnSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  gradedKit, gradedSummary, judgeArms, pyRound, orphanPercentile, orphanSummary, recallCompare, recallKit, recallSummary, swapVerdicts, triageSummary,
  type Interval, type RecallRow, type RunAnswer,
} from '../../lib/deck-eval/score';
import {
  DATA, gradedKits, judgeKitsFor, judgeKitsFrozen, orphanFacts, orphanLabels, recallKits, runAnswer, swapJudged, triageFrom, triageFrozen, validNames,
} from './kits';

const SETS = ['real', 'primer', 'triage', 'swaps', 'orphan', 'graded'] as const;
type KitSet = (typeof SETS)[number];

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const FROZEN = args.includes('--frozen');
const ONLY = (flag('--kits')?.split(',') ?? [...SETS]).filter((s): s is KitSet => (SETS as readonly string[]).includes(s));
const EXTRA = flag('--run');
const OUT = flag('--out') ?? (FROZEN ? '' : mkdtempSync(join(tmpdir(), 'deck-eval-')));

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const iv = (t: Interval, p = true) => (p ? `${pct(t.mean)} [${(100 * t.lo).toFixed(1)}, ${(100 * t.hi).toFixed(1)}]` : `${t.mean.toFixed(2)} [${t.lo.toFixed(2)}, ${t.hi.toFixed(2)}]`);
const table = (head: string[], rows: Array<Array<string | number>>) => {
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (r: Array<string | number>) => `| ${r.map((c, i) => String(c).padEnd(w[i])).join(' | ')} |`;
  console.log([line(head), `| ${w.map((n) => '-'.repeat(n)).join(' | ')} |`, ...rows.map(line)].join('\n'));
};
const mark = (got: string, want: string) => (got === want ? `${got} ✓` : `${got} ✗ (FINDINGS ${want})`);

// --- regenerate ---------------------------------------------------------------------------

function regenerate(set: KitSet): { ok: boolean; seconds: number } {
  const dir = join(DATA, set);
  const tmp = mkdtempSync(join(tmpdir(), `deck-eval-${set}-db-`));
  // Throwaway copies only: the kits' databases are never opened directly.
  const main = set === 'swaps' ? 'work.db' : 'eval.db';
  copyFileSync(join(dir, 'db', main), join(tmp, 'mtg.db'));
  copyFileSync(join(dir, 'db', 'cards.db'), join(tmp, 'cards.db'));
  const out = join(OUT, set);
  mkdirSync(out, { recursive: true });
  const t0 = Date.now();
  const r = spawnSync('npx', ['jiti', join(__dirname, 'regen.ts'), set, dir, out], {
    stdio: 'inherit',
    // No model key: nothing here calls a model.
    env: { ...process.env, MTG_DB_PATH: join(tmp, 'mtg.db'), MTG_CARDS_DB_PATH: join(tmp, 'cards.db'), ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '' },
  });
  return { ok: r.status === 0, seconds: Math.round((Date.now() - t0) / 1000) };
}

// --- score and print -------------------------------------------------------------------------

function recallSet(set: 'real' | 'primer', want: Record<string, Record<string, string>>) {
  const dir = join(DATA, set);
  const kits = recallKits(dir);
  const runs: Array<[string, (id: string) => RunAnswer | 'rand' | null]> = [
    ['rand', () => 'rand'],
    ['A-sb', (id) => runAnswer(dir, 'A-sb', id)],
    ['A3n', (id) => runAnswer(dir, 'A3n', id)],
    ...(OUT ? [['A-sb now', (id: string) => runAnswer(dir, join(OUT, set, 'A-sb'), id)], ['A3n now', (id: string) => runAnswer(dir, join(OUT, set, 'A3n'), id)]] as Array<[string, (id: string) => RunAnswer | null]> : []),
    ...(EXTRA ? [[EXTRA, (id: string) => runAnswer(dir, EXTRA, id)]] as Array<[string, (id: string) => RunAnswer | null]> : []),
  ];
  const clean = set === 'real' ? 'archidekt-cut' : 'primer-pair';
  console.log(`\n## ${set}: recall of the owner's real cuts (${kits.length} kits; per-kit share of K, kit-bootstrap 95% interval)`);
  const rows: Array<Array<string | number>> = [];
  const byRun = new Map<string, RecallRow[]>();
  for (const [name, get] of runs) {
    const rs = kits.map((k) => { const a = get(k.id); return a ? recallKit(k, a) : null; }).filter((r): r is RecallRow => !!r);
    if (!rs.length) continue;
    byRun.set(name, rs);
    const s = recallSummary(rs);
    const all = s.find((x) => x.group === 'ALL')!;
    const c = s.find((x) => x.group === clean);
    const w = want[name];
    const topK = pct(all.topK.mean);
    rows.push([name, rs.length, w?.topK ? mark(topK, w.topK) : topK, iv(all.topK).replace(/^\S+ /, ''),
      set === 'real' ? (w?.clean ? mark(pct(c!.topK.mean), w.clean) : pct(c!.topK.mean)) : '-',
      all.top2K ? (w?.top2K ? mark(pct(all.top2K.mean), w.top2K) : pct(all.top2K.mean)) : '-']);
  }
  table(['run', 'kits', 'top K (all)', 'interval', set === 'real' ? 'top K (archidekt-cut, 14)' : '', 'top 2K (all)'], rows);
  if (byRun.has('A-sb now')) {
    for (const [a, b] of [['A-sb now', 'A-sb'], ['A3n now', 'A3n'], ['A3n now', 'rand']]) {
      const d = recallCompare(byRun.get(a)!, byRun.get(b)!);
      console.log(`  paired ${a} - ${b}: ${(100 * d.diff.mean).toFixed(1)} pts [${(100 * d.diff.lo).toFixed(1)}, ${(100 * d.diff.hi).toFixed(1)}], better on ${d.wins}, worse on ${d.losses} of ${d.n}`);
    }
  }
}

function judgeSet() {
  const dir = join(DATA, 'real');
  console.log('\n## real: blind per-card judge on each run\'s top K (cut 1, ok 0.5, keep 0; bad = rated keep)');
  const frozen = judgeArms(judgeKitsFrozen(dir, ['A-sb', 'A3n']));
  const want: Record<string, [string, string]> = { 'A-sb': ['0.43', '26%'], A3n: ['0.48', '20%'] };
  const rows = frozen.map((a) => [a.arm, a.kits, mark(a.score.mean.toFixed(2), want[a.arm][0]), iv(a.score, false).replace(/^\S+ /, ''), mark(`${Math.round(100 * a.badRate.mean)}%`, want[a.arm][1]), `${a.rated}/${a.total}`]);
  const now: Record<string, string> = {};
  if (OUT) { now['A-sb now'] = join(OUT, 'real', 'A-sb'); now['A3n now'] = join(OUT, 'real', 'A3n'); }
  if (EXTRA) now[EXTRA] = EXTRA;
  if (Object.keys(now).length) {
    for (const a of judgeArms(judgeKitsFor(dir, now))) rows.push([a.arm, a.kits, a.score.mean.toFixed(2), iv(a.score, false).replace(/^\S+ /, ''), `${Math.round(100 * a.badRate.mean)}%`, `${a.rated}/${a.total}`]);
  }
  table(['run', 'kits', 'score', 'interval', 'bad-cut rate', 'rated / picks'], rows);
  if (OUT) console.log('  A new pick the judge never rated is left out: the "rated / picks" column says how much of each run was scored.');
}

function triageSet() {
  const dir = join(DATA, 'triage');
  console.log('\n## triage: what the code warns about on 32 decks (6 tuned, 6 precon, 6 casual, 6 half-and-half, 4 basics broken, 4 random piles)');
  const show = (label: string, s: ReturnType<typeof triageSummary>) => {
    table(['group', 'decks', 'decks warned', 'mean warnings', 'land warning'], [...s.groups, s.all].map((g) => [g.group, g.n, g.flagged, g.meanFlags.toFixed(1), g.landFlag]));
    console.log(`  ${label}: broken basics caught ${s.starvedCaught.filter((x) => x.caught).length}/${s.starvedCaught.length} (${s.starvedCaught.map((x) => `${x.id} ${x.kind} ${x.caught ? 'yes' : 'no'}`).join(', ')})`);
    console.log(`  kinds: ${s.kinds.map((k) => `${k.flag} ${Object.values(k.byGroup).reduce((a, b) => a + b, 0)}`).join('; ')}`);
  };
  const f = triageSummary(triageFrozen(dir));
  console.log('\nFrozen (the code when the kits were built: every job outside its range, health warnings, flagged cards, no way to win):');
  show('frozen', f);
  const tuned = f.groups.find((g) => g.group === 'tuned')!;
  console.log(`  check: every deck warned ${mark(`${f.all.flagged}/${f.all.n}`, '32/32')}; tuned mean ${mark(tuned.meanFlags.toFixed(0), '7')}; lands low ${mark(`${f.all.landFlag}/${f.all.n}`, '30/32')}`);
  if (OUT && existsSync(join(OUT, 'triage'))) {
    console.log('\nNow (the warnings the Check tab shows: not legal, no card draw, lands far under):');
    show('now', triageSummary(triageFrom(dir, join(OUT, 'triage'))));
  }
}

function swapsSet() {
  const dir = join(DATA, 'swaps');
  const v = swapVerdicts(swapJudged(dir), 'code');
  console.log('\n## swaps: the code route\'s 5 swaps per deck at 100, judged (8 decks)');
  const p = (x: number) => `${pyRound((100 * x) / v.n)}%`;
  table(['run', 'swaps', 'better', 'even', 'worse', 'card out reasonable to lose'], [['code (frozen)', v.n, mark(p(v.better), '2%'), mark(p(v.even), '22%'), mark(p(v.worse), '75%'), `${v.outOk}/${v.n} (${p(v.outOk)})`]]);
  if (OUT && existsSync(join(OUT, 'swaps', 'code'))) {
    const offered = (SWAP_IDS.map((id) => runAnswer(dir, join(OUT, 'swaps', 'code'), id) as { swaps?: unknown[] } | null)).map((a) => a?.swaps?.length ?? 0);
    console.log(`  Now: Tune → Swaps offers ${offered.reduce((a, b) => a + b, 0)} code pairs across the 8 decks (${offered.join(', ')}). It is a same-job lookup over Maybeboard cards, and these decks' Maybeboards were emptied for the kits; nothing to judge.`);
  }
}
const SWAP_IDS = ['azula', 'denzilore', 'hearthhull', 'kratos', 'obyra', 'ulalek', 'zimone', 'zuko'];

function orphanSet() {
  const dir = join(DATA, 'orphan');
  console.log('\n## orphan: a combo piece with and without its partner (13 decks; position 0 = cut first, 100 = last)');
  const score = (base: string) => {
    const ds: number[] = [];
    for (const [deck, l] of orphanLabels(dir)) {
      const fx = orphanFacts(dir, deck);
      const w = runAnswer(dir, base, l.kits.with); const wo = runAnswer(dir, base, l.kits.without);
      if (!w || !wo) continue;
      const pw = orphanPercentile(w.ranked ?? [], validNames(fx.with), l.orphan);
      const po = orphanPercentile(wo.ranked ?? [], validNames(fx.without), l.orphan);
      if (pw !== null && po !== null) ds.push(po - pw);
    }
    return orphanSummary(ds);
  };
  const rows: Array<Array<string | number>> = [];
  const f = score('A3n');
  rows.push(['A3n (frozen)', f.n, mark(f.mean.mean.toFixed(1), '-44.1'), `[${f.mean.lo.toFixed(1)}, ${f.mean.hi.toFixed(1)}]`, `${f.towardCut}/${f.n}`]);
  if (OUT && existsSync(join(OUT, 'orphan', 'A3n'))) { const n = score(join(OUT, 'orphan', 'A3n')); rows.push(['A3n now', n.n, n.mean.mean.toFixed(1), `[${n.mean.lo.toFixed(1)}, ${n.mean.hi.toFixed(1)}]`, `${n.towardCut}/${n.n}`]); }
  table(['run', 'decks', 'mean shift (without - with)', 'interval', 'toward cut > 10'], rows);
}

function gradedSet() {
  const dir = join(DATA, 'graded');
  console.log('\n## graded: inserted cards of known grade (6 decks, K = 11-12); share of each grade in the top K');
  const kits = gradedKits(dir);
  const want: Record<string, Record<string, string>> = { A3n: { good: '20.8%', mediocre: '20.8%', bad: '47.2%', diff: '+26.4 [-8.3, +54.2]' } };
  const rows: Array<Array<string | number>> = [];
  const runs: Array<[string, string]> = [['A-sb', 'A-sb'], ['A3n', 'A3n'], ...(OUT ? [['A-sb now', join(OUT, 'graded', 'A-sb')], ['A3n now', join(OUT, 'graded', 'A3n')]] as Array<[string, string]> : [])];
  for (const [label, run] of runs) {
    const rs = kits.map((k) => { const a = runAnswer(dir, run, k.id); return a ? gradedKit(k, a) : null; }).filter((x): x is NonNullable<typeof x> => !!x);
    if (!rs.length) continue;
    const s = gradedSummary(rs);
    const w = want[label];
    const cell = (g: string) => (w ? mark(pct(s.by[g].topK.mean), w[g]) : pct(s.by[g].topK.mean));
    const d = s.badMinusGood.topK;
    const sg = (x: number) => `${x >= 0 ? '+' : ''}${(100 * x).toFixed(1)}`;
    const diff = `${sg(d.mean)} [${sg(d.lo)}, ${sg(d.hi)}]`;
    rows.push([label, rs.length, cell('good'), cell('mediocre'), cell('bad'), w ? mark(diff, w.diff) : diff]);
  }
  table(['run', 'kits', 'good', 'mediocre', 'bad', 'bad - good (pts)'], rows);
}

// --- main ---------------------------------------------------------------------------------

if (!existsSync(DATA)) throw new Error(`No kit data at ${DATA}: set DECK_EVAL_DATA`);
console.log(`# Deck-flow evaluation, code route${FROZEN ? ' (frozen runs only)' : ''}\nKits: ${DATA}${OUT ? `\nRegenerated runs: ${OUT}` : ''}`);
if (!FROZEN) {
  for (const set of ONLY) {
    console.log(`\nRegenerating ${set} with the current code...`);
    const r = regenerate(set);
    console.log(`  ${r.ok ? 'done' : 'FAILED'} in ${r.seconds}s`);
  }
}
const WANT_REAL = { rand: { topK: '13.8%', clean: '14.5%' }, 'A-sb': { topK: '11.1%', clean: '15.1%' }, A3n: { topK: '16.9%', clean: '15.2%' } };
const WANT_PRIMER = { rand: { topK: '15.7%', top2K: '31.4%' }, A3n: { topK: '20.3%', top2K: '37.5%' } };
for (const set of ONLY) {
  if (set === 'real') { recallSet('real', WANT_REAL); judgeSet(); }
  if (set === 'primer') recallSet('primer', WANT_PRIMER);
  if (set === 'triage') triageSet();
  if (set === 'swaps') swapsSet();
  if (set === 'orphan') orphanSet();
  if (set === 'graded') gradedSet();
}
console.log('\n✓ = equals the number in FINDINGS.md; ✗ = differs (FINDINGS value in brackets). "now" = regenerated with the current code.');
