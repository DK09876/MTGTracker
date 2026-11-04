'use client';

/**
 * The Playtest tab: goldfish the deck - play it alone, with nobody to stop
 * it - three ways. Goldfish plays two thousand games on autopilot and says
 * when the commander comes down, how often land drops are missed and which
 * cards get stuck; Best hand searches for the strongest opening seven; and
 * Play it yourself is a small table to draw, mulligan and play by hand.
 * All in the browser, no AI.
 */

import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';

import { lastGoodStartKey } from './DeckGlance';
import GoldfishSettings from './GoldfishSettings';

import type { ListedCard } from '@/lib/db';
import { DEFAULT_SETTINGS, describeCheck, simCard, type BestHand, type GoldfishReport, type GoldfishSettings as GoldfishSettingsType } from '@/lib/goldfish';
import { describeKeep } from '@/lib/keep';
import * as api from '@/lib/api';
import type { GoldfishJob } from '@/lib/goldfish.worker';
import { imageOf, type ScryfallCard } from '@/lib/scryfall';

const SERIES = '#b38f1f';

interface Props {
  listId: string;
  commander: ScryfallCard | null;
  /** The main board. */
  cards: ListedCard[];
}

type Mode = 'goldfish' | 'best' | 'play';

const pct = (x: number) => `${Math.round(x * 100)}%`;
const one = (x: number) => x.toFixed(1);

export default function DeckPlaytest({ listId, commander, cards }: Props) {
  const [mode, setMode] = useState<Mode>('goldfish');
  // The deck's settings, presets, and each card's tags - read once, saved as they change.
  const [state, setState] = useState<api.PlaytestState | null>(() => api.peek<api.PlaytestState>(api.paths.playtest(listId)) ?? null);
  useEffect(() => {
    let cancelled = false;
    api.deckPlaytest(listId).then((p) => { if (!cancelled) setState(p); }).catch(() => { if (!cancelled) setState({ settings: DEFAULT_SETTINGS, presets: [], saved: false, cardTags: {}, tagNames: [] }); });
    return () => { cancelled = true; };
  }, [listId]);
  const byName = useMemo(() => new Map(cards.map((c) => [c.card.name, c.card])), [cards]);
  const tagsOf = state?.cardTags;
  const deck = useMemo(() => cards.flatMap((c) => Array.from({ length: c.quantity }, () => simCard(c.card, tagsOf?.[c.card.name] ?? []))), [cards, tagsOf]);
  const size = deck.length + (commander ? 1 : 0);
  const setSettings = (settings: GoldfishSettingsType) => {
    setState((s) => (s ? { ...s, settings } : s));
    void api.savePlaytest(listId, { settings }).catch(() => {});
  };
  const setPresets = (presets: api.PlaytestState['presets']) => {
    setState((s) => (s ? { ...s, presets } : s));
    void api.savePlaytest(listId, { presets }).catch(() => {});
  };
  if (!state) return <p className="mt-8 text-center text-[var(--muted)]">Reading the deck…</p>;
  const sim: SimProps = { listId, deck, commander, byName, settings: state.settings };
  const panel = (
    <details data-tour="how-it-plays" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium">
        How it plays <span className="font-normal text-[var(--muted)]">· {state.settings.games.toLocaleString()} games of {state.settings.turns} turns · keeps {describeKeep(state.settings.keep)} · {state.settings.checks.length} goal{state.settings.checks.length === 1 ? '' : 's'}</span>
      </summary>
      <div className="mt-4">
        <GoldfishSettings settings={state.settings} presets={state.presets} cards={cards} cardTags={state.cardTags} tagNames={state.tagNames}
          hasCommander={!!commander} onChange={setSettings} onPresets={setPresets} />
      </div>
    </details>
  );

  return (
    <section className="mt-5 flex flex-col gap-4">
      <div data-tour="playtest-modes" className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border border-[var(--border)] bg-[var(--surface)] p-1 text-sm" role="tablist" aria-label="Playtest mode">
        {([['goldfish', 'Goldfish'], ['best', 'Best hand'], ['play', 'Play it yourself']] as const).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={mode === value}
            data-tour-mode={value}
            onClick={() => setMode(value)}
            className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 ${mode === value ? 'bg-[var(--surface-hover)] font-semibold' : 'text-[var(--muted)] hover:text-[var(--foreground)]'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {size < 60 && (
        <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm text-[var(--muted)]">
          The deck has {size} cards; the numbers mean more once it is close to 100.
        </p>
      )}
      {mode !== 'play' && panel}
      {mode === 'goldfish' ? <Goldfish {...sim} />
        : mode === 'best' ? <Best {...sim} />
          : <Table cards={cards} commander={commander} />}
    </section>
  );
}

// --- the worker -------------------------------------------------------------

type Run<T> = { state: 'idle' } | { state: 'running' } | { state: 'done'; result: T } | { state: 'failed'; error: string };

function useSimulation<T>(): [Run<T>, (job: GoldfishJob) => void] {
  const [run, setRun] = useState<Run<T>>({ state: 'idle' });
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);
  const start = (job: GoldfishJob) => {
    worker.current?.terminate();
    const w = new Worker(new URL('../lib/goldfish.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    setRun({ state: 'running' });
    w.onmessage = (e: MessageEvent<{ ok: boolean; result?: T; error?: string }>) => {
      setRun(e.data.ok ? { state: 'done', result: e.data.result as T } : { state: 'failed', error: e.data.error ?? 'The simulation failed' });
      w.terminate();
      worker.current = null;
    };
    w.onerror = () => { setRun({ state: 'failed', error: 'The simulation failed' }); w.terminate(); };
    w.postMessage(job);
  };
  return [run, start];
}

// The last run with the same settings is kept in this browser only, to compare the next one against.
const settingsKey = (s: GoldfishSettingsType) => { let h = 0; for (const ch of JSON.stringify(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };
const lastKey = (listId: string, s: GoldfishSettingsType) => `mtg-goldfish:${listId}:${settingsKey(s)}`;
function readLast(listId: string, s: GoldfishSettingsType): GoldfishReport | null {
  try { return JSON.parse(localStorage.getItem(lastKey(listId, s)) ?? 'null'); } catch { return null; }
}
function saveLast(listId: string, s: GoldfishSettingsType, r: GoldfishReport) {
  try { localStorage.setItem(lastKey(listId, s), JSON.stringify(r)); } catch { /* no comparison next time, still works */ }
}

interface SimProps {
  listId: string;
  deck: ReturnType<typeof simCard>[];
  commander: ScryfallCard | null;
  byName: Map<string, ScryfallCard>;
  settings: GoldfishSettingsType;
}

// --- goldfish ---------------------------------------------------------------

function Goldfish({ listId, deck, commander, byName, settings }: SimProps) {
  const [run, start] = useSimulation<GoldfishReport>();
  // The run before this one, for the arrows; set when a new run starts.
  const [before, setBefore] = useState<GoldfishReport | null>(null);
  const shown = useRef<GoldfishReport | null>(null);
  // The settings the shown run used: compared only with runs that used the same.
  const ran = useRef<GoldfishSettingsType | null>(null);

  useEffect(() => {
    if (run.state === 'done' && shown.current !== run.result) {
      shown.current = run.result;
      saveLast(listId, ran.current ?? settings, run.result);
      // The deck page's at-a-glance strip shows the last good-start rate.
      if (run.result.goodStart !== null) { try { localStorage.setItem(lastGoodStartKey(listId), JSON.stringify({ share: run.result.goodStart })); } catch { /* fine */ } }
    }
  }, [run, listId, settings]);

  const play = () => {
    ran.current = settings;
    setBefore(readLast(listId, settings));
    // The same shuffles every run, so a change in the numbers is a change in the deck, not luck.
    start({ kind: 'goldfish', deck, commander: commander ? simCard(commander) : null, seed: 1, settings });
  };

  const r = run.state === 'done' ? run.result : null;
  return (
    <div className="flex flex-col gap-4">
      <div data-tour="goldfish-run" className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm">
        <p>
          Plays the deck alone {settings.games.toLocaleString()} times, {settings.turns} turns each, on autopilot: a land a turn, then what it can pay for in your order. Sevens that fail your keep rule ({describeKeep(settings.keep)}) are mulliganed, up to {settings.maxMulligans} times. Change any of it under How it plays.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button data-tour="goldfish-play" onClick={play} disabled={run.state === 'running' || !deck.length} className="btn-go rounded-full px-4 py-1.5 text-sm font-semibold disabled:opacity-50">
            {run.state === 'running' ? 'Playing…' : r ? 'Play again' : `Play ${settings.games.toLocaleString()} games`}
          </button>
          {r && before && <span className="text-xs text-[var(--muted)]">Arrows compare with your last run with the same settings.</span>}
          {run.state === 'failed' && <span role="alert" className="text-red-400">{run.error}</span>}
        </div>
      </div>

      {r && r.checks.length > 0 && (
        <div data-tour="goldfish-goals" className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <h3 data-section="Goals" className="text-sm font-semibold">Your goals</h3>
          {r.goodStart !== null && <p className="text-sm">A <span className="font-semibold">good start</span> - every goal you marked - in <span className="font-semibold tabular-nums">{pct(r.goodStart)}</span> of games{before?.goodStart != null && Math.abs(r.goodStart - before.goodStart) >= 0.015 && <span className={r.goodStart > before.goodStart ? 'text-[#0ca30c]' : 'text-[#fab219]'}> ({r.goodStart > before.goodStart ? '▲' : '▼'} {Math.round(Math.abs(r.goodStart - before.goodStart) * 100)} pts)</span>}.</p>}
          <ul className="flex flex-col gap-1.5">
            {r.checks.map(({ check, share }, i) => (
              <li key={i} className="flex flex-wrap items-center gap-3 text-sm">
                <span className="w-12 text-right font-semibold tabular-nums">{pct(share)}</span>
                <span className="relative h-1.5 min-w-[6rem] flex-[0_1_10rem] overflow-hidden rounded-full bg-[var(--border)]"><span className="absolute inset-y-0 left-0 rounded-full" style={{ width: pct(share), background: SERIES }} /></span>
                <span className="min-w-0 flex-1">{describeCheck(check)}{check.good && <span className="ml-2 text-xs text-[var(--accent)]">good start</span>}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {r && (
        <>
          <div data-tour="goldfish-stats" className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] sm:gap-3">
            {commander && (
              <Stat
                label="Commander out"
                value={r.commanderAverage === null ? 'never' : `turn ${one(r.commanderAverage)}`}
                note={`on average; by turn ${Math.min(8, Math.ceil(commander.cmc ?? 4))} in ${pct(r.commanderBy[Math.min(7, Math.ceil(commander.cmc ?? 4) - 1)] ?? 0)} of games`}
                change={before?.commanderAverage != null && r.commanderAverage !== null ? r.commanderAverage - before.commanderAverage : null}
                lowerIsBetter
                format={one}
              />
            )}
            <Stat label="Missed a land drop" value={pct(r.missedLandBy[4])} note={`by turn 4 · ${pct(r.missedLandBy[3])} by turn 3`} change={before ? r.missedLandBy[4] - before.missedLandBy[4] : null} lowerIsBetter format={(x) => `${Math.round(x * 100)} pts`} least={0.015} />
            <Stat label="Mana on turn 4" value={one(r.manaByTurn[3])} note={`${one(r.manaByTurn[2])} on turn 3 · ${one(r.manaByTurn[4])} on turn 5`} change={before ? r.manaByTurn[3] - before.manaByTurn[3] : null} format={one} />
            <Stat label="Mana spent by turn 4" value={one(r.spentBy[4])} note={`${one(r.spentBy[6])} by turn 6`} change={before ? r.spentBy[4] - before.spentBy[4] : null} format={one} />
            <Stat label="Mulligans" value={pct(r.mulliganRate)} note={`sevens that fail ${describeKeep(settings.keep)}`} change={before ? r.mulliganRate - before.mulliganRate : null} lowerIsBetter format={(x) => `${Math.round(x * 100)} pts`} least={0.015} />
          </div>

          <div className="flex flex-wrap gap-4">
            {commander && (
              <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                <h3 data-section="Commander by turn" className="text-sm font-semibold">Commander cast by turn</h3>
                <Bars values={r.commanderBy} label={(i) => `Turn ${i + 1}`} />
              </div>
            )}
            <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
              <h3 data-section="Mana each turn" className="text-sm font-semibold">Mana each turn</h3>
              <Bars values={r.manaByTurn} max={Math.max(...r.manaByTurn, 1)} label={(i) => `Turn ${i + 1}`} format={one} />
            </div>
          </div>

          <div data-tour="goldfish-stuck" className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
            <h3 data-section="Stuck in hand" className="text-sm font-semibold">Stuck in hand</h3>
            {r.stuck.length ? (
              <>
                <p className="text-xs text-[var(--muted)]">Still in hand after turn 8, in this share of the games it was drawn. Usually too expensive, or a colour the lands do not make enough of.</p>
                <ul className="flex flex-col gap-1.5">
                  {r.stuck.map((s) => {
                    const card = byName.get(s.name);
                    const img = card ? imageOf(card, 'small') : null;
                    return (
                      <li key={s.name} className="flex items-center gap-3 text-sm">
                        {img ? <Image src={img} alt="" width={32} height={45} className="rounded" unoptimized /> : <span className="h-[45px] w-8 rounded bg-[var(--surface-hover)]" />}
                        <span className="min-w-0 flex-1 truncate">{s.name}</span>
                        <span className="tabular-nums text-[var(--muted)]">{pct(s.share)}</span>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : <p className="text-sm text-[var(--muted)]">Nothing is regularly stuck in hand - the curve and colours keep up.</p>}
          </div>
          <p className="text-xs text-[var(--muted)]">
            The autopilot does not draw extra cards or use abilities beyond mana, so a deck that draws a lot does better than this says. It measures the mana and the curve.
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, note, change, lowerIsBetter, format, least = 0.05 }: { label: string; value: string; note: string; change: number | null; lowerIsBetter?: boolean; format: (x: number) => string; least?: number }) {
  // Two thousand games still wobble a little; smaller changes are noise.
  const show = change !== null && Math.abs(change) >= least;
  const better = show && (lowerIsBetter ? change! < 0 : change! > 0);
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <span className="text-xs text-[var(--muted)]">{label}</span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-[var(--muted)]">{note}</span>
      {show && (
        <span className={`text-xs ${better ? 'text-[#0ca30c]' : 'text-[#fab219]'}`}>
          {change! > 0 ? '▲' : '▼'} {format(Math.abs(change!))} {better ? 'better' : 'worse'} than last run
        </span>
      )}
    </div>
  );
}

function Bars({ values, max = 1, label, format = pct }: { values: number[]; max?: number; label: (i: number) => string; format?: (x: number) => string }) {
  return (
    <div className="flex h-36 items-end gap-1.5 border-b border-[var(--border)] pt-4" role="list">
      {values.map((v, i) => (
        <div key={i} role="listitem" aria-label={`${label(i)}: ${format(v)}`} title={`${label(i)}: ${format(v)}`} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
          <span className="text-[10px] tabular-nums text-[var(--muted)]">{format(v)}</span>
          <div className="w-full max-w-7" style={{ height: `${(v / max) * 100}%`, minHeight: v > 0 ? 2 : 0, background: SERIES, borderRadius: '4px 4px 0 0' }} />
          <span className="text-[10px] text-[var(--muted)]">{i + 1}</span>
        </div>
      ))}
    </div>
  );
}

// --- best hand --------------------------------------------------------------

function Best({ deck, commander, byName, settings }: SimProps) {
  const [run, start] = useSimulation<BestHand>();
  const find = () => start({ kind: 'best', deck, commander: commander ? simCard(commander) : null, seed: 7, settings });
  const r = run.state === 'done' ? run.result : null;
  return (
    <div className="flex flex-col gap-4">
      <div data-tour="best-hand" className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm">
        <p>
          The strongest seven this deck can open with. It builds the hand a card at a time, keeping the five best partial hands at each step, and judges each by playing it out against shuffled libraries - {settings.checks.length ? 'by your goals (the good-start ones count double)' : 'the commander early, mana spent by turn four, no land drops missed'}.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button data-tour="best-find" onClick={find} disabled={run.state === 'running' || deck.length < 7} className="btn-go rounded-full px-4 py-1.5 text-sm font-semibold disabled:opacity-50">
            {run.state === 'running' ? 'Searching… a few seconds' : r ? 'Search again' : 'Find the best hand'}
          </button>
          {run.state === 'failed' && <span role="alert" className="text-red-400">{run.error}</span>}
        </div>
      </div>
      {r && (
        <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <ul data-tour="best-hand-cards" className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2">
            {r.cards.map((name, i) => {
              const card = byName.get(name);
              const img = card ? imageOf(card, 'normal') : null;
              return (
                <li key={`${name}-${i}`} className="flex flex-col gap-1">
                  {img ? <Image src={img} alt={name} width={146} height={204} className="h-auto w-full rounded-lg" unoptimized /> : <span className="flex aspect-[5/7] items-center justify-center rounded-lg bg-[var(--surface-hover)] p-2 text-center text-xs">{name}</span>}
                </li>
              );
            })}
          </ul>
          <p className="text-sm">
            {commander && r.commanderAverage !== null && <>From this hand the commander comes down on turn <b>{one(r.commanderAverage)}</b> on average, and </>}
            {commander && r.commanderAverage !== null ? 'it' : 'It'} spends <b>{one(r.spentBy4)}</b> mana by the end of turn four.
          </p>
          {r.checks.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {r.checks.map(({ check, share }, i) => <li key={i}><span className="font-semibold tabular-nums">{pct(share)}</span> <span className="text-[var(--muted)]">of games from this hand:</span> {describeCheck(check)}</li>)}
            </ul>
          )}
          <p className="text-xs text-[var(--muted)]">
            You will almost never draw exactly this seven; it shows what an ideal start looks like for this deck, and which cards make it. If the best hand still starts slowly, the deck wants more cheap mana.
          </p>
        </div>
      )}
    </div>
  );
}

// --- play it yourself ---------------------------------------------------------

interface TCard { uid: number; card: ScryfallCard; tapped: boolean }
interface Game {
  library: TCard[];
  hand: TCard[];
  battlefield: TCard[];
  graveyard: TCard[];
  /** Commander in the command zone, and how many times it has been cast (for the tax). */
  inCommandZone: boolean;
  casts: number;
  turn: number;
  life: number;
  landPlayed: boolean;
  mulligans: number;
  /** After a mulligan: how many cards still go to the bottom. */
  toBottom: number;
}

const isLand = (c: ScryfallCard) => /\bLand\b/.test((c.type_line ?? '').split('//')[0]);

function newGame(cards: ListedCard[]): Game {
  let uid = 0;
  const all = cards.flatMap((c) => Array.from({ length: c.quantity }, () => ({ uid: uid++, card: c.card, tapped: false })));
  const library = shuffle(all);
  return { library: library.slice(7), hand: library.slice(0, 7), battlefield: [], graveyard: [], inCommandZone: true, casts: 0, turn: 1, life: 40, landPlayed: false, mulligans: 0, toBottom: 0 };
}

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function Table({ cards, commander }: { cards: ListedCard[]; commander: ScryfallCard | null }) {
  const [game, setGame] = useState<Game | null>(null);
  const [showGraveyard, setShowGraveyard] = useState(false);

  if (!game) {
    return (
      <div data-tour="play-table" className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm">
        <p>Draw a seven and play the deck by hand: mulligan, play lands and spells, tap and untap, and move to the next turn. Nothing here changes the deck.</p>
        <div><button data-tour="play-draw" onClick={() => setGame(newGame(cards))} disabled={cards.length === 0} className="btn-go rounded-full px-4 py-1.5 text-sm font-semibold disabled:opacity-50">Draw a hand</button></div>
      </div>
    );
  }

  const g = game;
  const lands = g.battlefield.filter((c) => isLand(c.card));
  const others = g.battlefield.filter((c) => !isLand(c.card));
  const untapped = lands.filter((c) => !c.tapped).length;
  const update = (f: (g: Game) => Game) => setGame((prev) => (prev ? f(prev) : prev));

  const mulligan = () => update((p) => {
    const library = shuffle([...p.library, ...p.hand]);
    // London mulligan: draw seven, then put one on the bottom per mulligan; the first is free.
    return { ...p, library: library.slice(7), hand: library.slice(0, 7), mulligans: p.mulligans + 1, toBottom: p.mulligans };
  });
  const fromHand = (c: TCard) => update((p) => {
    const hand = p.hand.filter((x) => x.uid !== c.uid);
    if (p.toBottom > 0) return { ...p, hand, library: [...p.library, c], toBottom: p.toBottom - 1 };
    if (isLand(c.card) && p.landPlayed) return p;
    return { ...p, hand, battlefield: [...p.battlefield, { ...c, tapped: false }], landPlayed: p.landPlayed || isLand(c.card) };
  });
  const toggle = (c: TCard) => update((p) => ({ ...p, battlefield: p.battlefield.map((x) => (x.uid === c.uid ? { ...x, tapped: !x.tapped } : x)) }));
  const toGraveyard = (c: TCard) => update((p) => ({ ...p, battlefield: p.battlefield.filter((x) => x.uid !== c.uid), graveyard: [...p.graveyard, c] }));
  const draw = () => update((p) => (p.library.length ? { ...p, hand: [...p.hand, p.library[0]], library: p.library.slice(1) } : p));
  const nextTurn = () => update((p) => ({
    ...p, turn: p.turn + 1, landPlayed: false,
    battlefield: p.battlefield.map((x) => ({ ...x, tapped: false })),
    hand: p.library.length ? [...p.hand, p.library[0]] : p.hand, library: p.library.slice(1),
  }));
  const castCommander = () => update((p) => ({ ...p, inCommandZone: false, casts: p.casts + 1 }));
  const commanderHome = () => update((p) => ({ ...p, inCommandZone: true }));

  const btn = 'rounded-full border border-[var(--border)] px-3 py-1 text-sm hover:bg-[var(--surface-hover)] disabled:opacity-50';
  return (
    <div data-tour="play-table" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
        <span className="font-semibold">Turn {g.turn}</span>
        <span className="text-[var(--muted)]">· {g.library.length} in library · {untapped}/{lands.length} lands untapped{g.landPlayed ? ' · land played' : ''}</span>
        <span className="flex items-center gap-1" aria-label="Life">
          <button className={btn} aria-label="Lose a life" onClick={() => update((p) => ({ ...p, life: p.life - 1 }))}>−</button>
          <span className="w-10 text-center font-semibold tabular-nums">{g.life}</span>
          <button className={btn} aria-label="Gain a life" onClick={() => update((p) => ({ ...p, life: p.life + 1 }))}>+</button>
        </span>
        <span className="ml-auto flex flex-wrap gap-2">
          {g.turn === 1 && !g.battlefield.length && g.toBottom === 0 && <button className={btn} onClick={mulligan}>Mulligan</button>}
          <button className={btn} onClick={draw} disabled={!g.library.length}>Draw</button>
          <button className="btn-go rounded-full px-3 py-1 text-sm font-semibold disabled:opacity-50" onClick={nextTurn} disabled={g.toBottom > 0}>Next turn</button>
          <button className={btn} onClick={() => { setGame(newGame(cards)); setShowGraveyard(false); }}>New game</button>
        </span>
      </div>

      {g.toBottom > 0 && (
        <p role="status" className="rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-4 py-2 text-sm">
          Mulligan {g.mulligans}: pick {g.toBottom} card{g.toBottom === 1 ? '' : 's'} from your hand to put on the bottom.
        </p>
      )}

      <Zone title="Battlefield" empty="Click a card in your hand to play it.">
        {others.map((c) => <TableCard key={c.uid} c={c} onClick={() => toggle(c)} onRemove={() => toGraveyard(c)} hint="Tap or untap" />)}
        {!g.inCommandZone && commander && <TableCard c={{ uid: -1, card: commander, tapped: false }} onClick={commanderHome} hint="Back to the command zone" commander />}
      </Zone>
      <Zone title={`Lands (${lands.length})`} empty="No lands yet.">
        {lands.map((c) => <TableCard key={c.uid} c={c} onClick={() => toggle(c)} onRemove={() => toGraveyard(c)} hint="Tap or untap" small />)}
      </Zone>
      <div className="flex flex-wrap gap-3">
        <div className="min-w-0 flex-[999_1_24rem]">
          <Zone title={`Hand (${g.hand.length})`} empty="Your hand is empty.">
            {g.hand.map((c) => (
              <TableCard key={c.uid} c={c} onClick={() => fromHand(c)} hint={g.toBottom > 0 ? 'Put on the bottom' : isLand(c.card) && g.landPlayed ? 'Already played a land this turn' : 'Play'} dim={g.toBottom === 0 && isLand(c.card) && g.landPlayed} />
            ))}
          </Zone>
        </div>
        <div className="flex min-w-0 flex-[1_1_12rem] flex-col gap-3">
          {commander && (
            <Zone title={`Command zone${g.casts ? ` · tax ${g.casts * 2}` : ''}`} empty="Commander is on the battlefield.">
              {g.inCommandZone && <TableCard c={{ uid: -1, card: commander, tapped: false }} onClick={castCommander} hint="Cast" commander />}
            </Zone>
          )}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
            <button className="text-[var(--muted)] hover:text-[var(--foreground)]" onClick={() => setShowGraveyard((v) => !v)} aria-expanded={showGraveyard}>
              Graveyard ({g.graveyard.length}) {showGraveyard ? '▴' : '▾'}
            </button>
            {showGraveyard && <ul className="mt-1 text-xs text-[var(--muted)]">{g.graveyard.map((c) => <li key={c.uid}>{c.card.name}</li>)}</ul>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Zone({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children.flat().filter(Boolean) : children ? [children] : [];
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{title}</h3>
      {items.length ? <div className="flex flex-wrap gap-2">{children}</div> : <p className="py-2 text-sm text-[var(--muted)]">{empty}</p>}
    </div>
  );
}

function TableCard({ c, onClick, onRemove, hint, small, dim, commander }: { c: TCard; onClick: () => void; onRemove?: () => void; hint: string; small?: boolean; dim?: boolean; commander?: boolean }) {
  const img = imageOf(c.card, 'normal');
  const w = small ? 64 : 92;
  return (
    <div className="relative" style={{ width: c.tapped ? w * 1.4 : w, height: w * 1.4 }}>
      <button
        onClick={onClick}
        title={`${c.card.name} - ${hint}`}
        aria-label={`${c.card.name}${c.tapped ? ' (tapped)' : ''}: ${hint}`}
        className={`absolute left-0 top-0 origin-center transition-transform motion-reduce:transition-none ${dim ? 'opacity-50' : ''} ${commander ? 'rounded-lg ring-2 ring-[var(--accent)]' : ''}`}
        style={{ width: w, height: w * 1.4, transform: c.tapped ? `translate(${w * 0.2}px, 0) rotate(90deg)` : undefined }}
      >
        {img ? <Image src={img} alt="" width={w} height={Math.round(w * 1.4)} className="h-full w-full rounded-lg" unoptimized /> : <span className="flex h-full w-full items-center justify-center rounded-lg bg-[var(--surface-hover)] p-1 text-center text-[10px]">{c.card.name}</span>}
      </button>
      {onRemove && (
        <button onClick={onRemove} aria-label={`${c.card.name} to the graveyard`} title="To the graveyard" className="absolute right-0.5 top-0.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-xs text-white hover:bg-black">
          ×
        </button>
      )}
    </div>
  );
}
