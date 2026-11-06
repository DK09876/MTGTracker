/**
 * A game at the table, as a list of what happened.
 *
 * The life counter never stores totals: it keeps the events - life lost,
 * commander damage, poison, a player out, a turn passed - and everything
 * on screen is folded from them. So undo is dropping the last event, the
 * game page can draw life over time, and the stats read the same record
 * the table saw. Shared by the browser and the server; no I/O here.
 */

export const LETHAL_COMMANDER = 21;
export const LETHAL_POISON = 10;
/** Taps on the same counter this close together are one change: "-7", not seven "-1"s. */
export const MERGE_MS = 3000;

/** The players' colours, in seat order - validated together for colour-blind readers on the app's dark surface. */
export const SEAT_COLOURS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9'];

export type GameEvent =
  | { k: 'life'; s: number; d: number; t: number }
  /** Commander damage to seat `s` from seat `from`'s commander; it is life lost too. */
  | { k: 'cmd'; s: number; from: number; d: number; t: number }
  | { k: 'poison'; s: number; d: number; t: number }
  | { k: 'out'; s: number; t: number }
  /** The active player passes the turn to the next one still in. */
  | { k: 'turn'; t: number }
  /** Who is the monarch, or who has the initiative - seat `s`, or nobody (-1). */
  | { k: 'monarch' | 'initiative'; s: number; t: number };

export interface SeatState {
  life: number;
  poison: number;
  /** Commander damage taken, by the seat that dealt it. */
  cmd: Record<number, number>;
  out: boolean;
  /** When this seat went out: 1 for the first one out. */
  outOrder: number | null;
}

export interface PlayState {
  seats: SeatState[];
  /** Whose turn it is. */
  active: number;
  /** The round: goes up each time the turn comes back round to the first player. */
  round: number;
  /** Seats still in. */
  alive: number[];
  monarch: number | null;
  initiative: number | null;
}

/** Fold the events into where the game stands. */
export function playState(players: number, startingLife: number, first: number, events: GameEvent[]): PlayState {
  const seats: SeatState[] = Array.from({ length: players }, () => ({ life: startingLife, poison: 0, cmd: {}, out: false, outOrder: null }));
  let active = first;
  let round = 1;
  let outs = 0;
  let monarch: number | null = null;
  let initiative: number | null = null;
  // Turn order position: 0 for the first player, then round the table.
  const pos = (s: number) => (s - first + players) % players;
  const pass = () => {
    const next = nextIn(seats, active);
    if (next === null) return;
    if (pos(next) <= pos(active)) round++;
    active = next;
  };
  for (const e of events) {
    if (e.k === 'life') seats[e.s].life += e.d;
    else if (e.k === 'cmd') {
      const was = seats[e.s].cmd[e.from] ?? 0;
      const now = Math.max(0, was + e.d);
      seats[e.s].cmd[e.from] = now;
      seats[e.s].life -= now - was;
    } else if (e.k === 'poison') seats[e.s].poison = Math.max(0, seats[e.s].poison + e.d);
    else if (e.k === 'out') {
      if (seats[e.s].out) continue;
      seats[e.s].out = true;
      seats[e.s].outOrder = ++outs;
      // Losing on your own turn ends it: the next player still in is up.
      if (e.s === active) pass();
      // Leaving the game, a monarch or the one with the initiative gives it to the player whose turn it is.
      if (monarch === e.s) monarch = seats[active].out ? null : active;
      if (initiative === e.s) initiative = seats[active].out ? null : active;
    } else if (e.k === 'turn') pass();
    else if (e.k === 'monarch') monarch = e.s >= 0 ? e.s : null;
    else if (e.k === 'initiative') initiative = e.s >= 0 ? e.s : null;
  }
  const alive = seats.flatMap((s, i) => (s.out ? [] : [i]));
  return { seats, active, round, alive, monarch, initiative };
}

function nextIn(seats: SeatState[], from: number): number | null {
  for (let step = 1; step <= seats.length; step++) {
    const s = (from + step) % seats.length;
    if (!seats[s].out) return s;
  }
  return null;
}

/** Why a seat looks dead, if it does - the table still confirms it. */
export function deathReason(seat: SeatState): string | null {
  if (seat.out) return null;
  if (seat.life <= 0) return 'No life left';
  if (seat.poison >= LETHAL_POISON) return `${LETHAL_POISON} poison`;
  if (Object.values(seat.cmd).some((d) => d >= LETHAL_COMMANDER)) return `${LETHAL_COMMANDER} commander damage`;
  return null;
}

/**
 * Add a change, folding it into the last event when it is the same counter
 * tapped again within MERGE_MS. An event that nets to zero is dropped.
 */
export function addChange(events: GameEvent[], change: GameEvent): GameEvent[] {
  const last = events[events.length - 1];
  if (last && 'd' in change && last.k === change.k && 's' in last && last.s === change.s
    && (change.k !== 'cmd' || (last.k === 'cmd' && last.from === change.from))
    && change.t - last.t < MERGE_MS) {
    const d = (last as { d: number }).d + change.d;
    const rest = events.slice(0, -1);
    return d === 0 ? rest : [...rest, { ...last, d, t: change.t } as GameEvent];
  }
  return [...events, change];
}

/** Life of every seat after each event, for the game page's chart: one row per change, plus the start. */
export function lifeOverTime(players: number, startingLife: number, first: number, events: GameEvent[]): Array<{ t: number | null; life: number[] }> {
  const rows: Array<{ t: number | null; life: number[] }> = [{ t: null, life: Array(players).fill(startingLife) }];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.k !== 'life' && e.k !== 'cmd') continue;
    rows.push({ t: e.t, life: playState(players, startingLife, first, events.slice(0, i + 1)).seats.map((s) => s.life) });
  }
  return rows;
}

/** Commander damage each seat dealt in all, across everyone it hit. */
export function commanderDealt(state: PlayState): number[] {
  const dealt = state.seats.map(() => 0);
  for (const seat of state.seats) for (const [from, d] of Object.entries(seat.cmd)) dealt[Number(from)] += d;
  return dealt;
}

/**
 * The finishing order: the winner first, then the rest from the last one
 * out to the first. Players still in at a draw share the top.
 */
export function placings(state: PlayState, winner: number | null): number[] {
  const n = state.seats.length;
  const places = Array<number>(n).fill(0);
  const outs = state.seats.map((s, i) => ({ i, o: s.outOrder })).filter((x) => x.o !== null).sort((a, b) => b.o! - a.o!);
  const standing = state.seats.flatMap((s, i) => (s.out ? [] : [i]));
  if (winner !== null) {
    places[winner] = 1;
    // Others still standing when someone won lost together, behind the winner.
    let next = 2;
    for (const s of standing) if (s !== winner) places[s] = next;
    if (standing.length > 1) next++;
    for (const { i } of outs) if (i !== winner) places[i] = next++;
  } else {
    for (const s of standing) places[s] = 1;
    let next = standing.length ? 2 : 1;
    for (const { i } of outs) places[i] = next++;
  }
  return places;
}

export const formatDuration = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return '<1m';
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};

/** Events sent by a browser, checked: each one well formed and about a seat that exists. Null if any is not. */
export function cleanEvents(raw: unknown, players: number): GameEvent[] | null {
  if (!Array.isArray(raw) || raw.length > 20000) return null;
  const seat = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < players;
  const amount = (v: unknown) => Number.isInteger(v) && Math.abs(v as number) <= 9999;
  const out: GameEvent[] = [];
  for (const e of raw as Array<Record<string, unknown>>) {
    if (!e || typeof e !== 'object' || typeof e.t !== 'number' || !Number.isFinite(e.t)) return null;
    const t = e.t;
    if (e.k === 'turn') out.push({ k: 'turn', t });
    else if (e.k === 'out' && seat(e.s)) out.push({ k: 'out', s: e.s as number, t });
    else if ((e.k === 'monarch' || e.k === 'initiative') && (e.s === -1 || seat(e.s))) out.push({ k: e.k, s: e.s as number, t });
    else if ((e.k === 'life' || e.k === 'poison') && seat(e.s) && amount(e.d)) out.push({ k: e.k, s: e.s as number, d: e.d as number, t });
    else if (e.k === 'cmd' && seat(e.s) && seat(e.from) && e.s !== e.from && amount(e.d)) out.push({ k: 'cmd', s: e.s as number, from: e.from as number, d: e.d as number, t });
    else return null;
  }
  return out;
}

/**
 * What to call each seat: the player's name, and when they sit in more
 * than one seat, the deck too - "DK · Azula" and "DK · Kratos" - or the
 * seat number if a deck has no name.
 */
export function seatLabels(seats: Array<{ memberId: string; name: string; deckName: string }>): string[] {
  const count = new Map<string, number>();
  for (const s of seats) count.set(s.memberId, (count.get(s.memberId) ?? 0) + 1);
  return seats.map((s, i) => ((count.get(s.memberId) ?? 0) > 1 ? `${s.name} · ${s.deckName || `seat ${i + 1}`}` : s.name));
}
