/**
 * A playgroup's numbers, worked out from its finished games: who wins,
 * which decks win, whether going first matters, and a few highlights.
 * Pure, so the tests can hand it games without a database.
 */

import type { Game, Member, SeatCommander } from './games';

export interface Standing {
  memberId: string;
  name: string;
  profileId: string | null;
  art: string | null;
  games: number;
  wins: number;
  /** Games won when they went first, and how many times they did. */
  firstWins: number;
  firstGames: number;
  /** Their most played deck here. */
  topDeck: string | null;
}

export interface DeckStanding {
  key: string;
  deckId: string | null;
  name: string;
  commander: SeatCommander | null;
  memberId: string;
  player: string;
  games: number;
  wins: number;
  lastPlayed: string;
}

export interface Highlight { label: string; value: string; detail: string }

export interface GroupStats {
  games: number;
  /** How many games had each number of players. */
  podSizes: Record<number, number>;
  averageMs: number | null;
  averageRounds: number | null;
  standings: Standing[];
  decks: DeckStanding[];
  /** Win rate by turn order, over the games with the usual number of players. */
  turnOrder: { players: number; games: number; wins: number[] } | null;
  highlights: Highlight[];
}

const ms = (g: Game) => (g.endedAt ? Date.parse(g.endedAt) - Date.parse(g.startedAt) : null);
const deckKey = (memberId: string, deckId: string | null, deckName: string) => deckId ?? `${memberId}:${deckName.toLowerCase()}`;
const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);

/** The stats for these games (newest first, as gamesIn gives them), or only those with `players` seats. */
export function groupStats(all: Game[], members: Member[], players?: number): GroupStats {
  const podSizes: Record<number, number> = {};
  for (const g of all) podSizes[g.seats.length] = (podSizes[g.seats.length] ?? 0) + 1;
  const games = players ? all.filter((g) => g.seats.length === players) : all;

  const byMember = new Map<string, Standing>();
  const deckCounts = new Map<string, Map<string, number>>();
  const decks = new Map<string, DeckStanding>();
  for (const m of members) {
    byMember.set(m.id, { memberId: m.id, name: m.name, profileId: m.profileId, art: m.art, games: 0, wins: 0, firstWins: 0, firstGames: 0, topDeck: null });
  }
  for (const g of games) {
    for (const s of g.seats) {
      let st = byMember.get(s.memberId);
      if (!st) {
        // Someone since taken out of the group still counts in the games they played.
        st = { memberId: s.memberId, name: s.name, profileId: s.profileId, art: null, games: 0, wins: 0, firstWins: 0, firstGames: 0, topDeck: null };
        byMember.set(s.memberId, st);
      }
      st.games++;
      if (s.won) st.wins++;
      if (s.seat === g.firstSeat) { st.firstGames++; if (s.won) st.firstWins++; }
      if (s.deckName) {
        const counts = deckCounts.get(s.memberId) ?? new Map<string, number>();
        counts.set(s.deckName, (counts.get(s.deckName) ?? 0) + 1);
        deckCounts.set(s.memberId, counts);
        const key = deckKey(s.memberId, s.deckId, s.deckName);
        const deck = decks.get(key) ?? { key, deckId: s.deckId, name: s.deckName, commander: s.commander, memberId: s.memberId, player: s.name, games: 0, wins: 0, lastPlayed: g.startedAt };
        deck.games++;
        if (s.won) deck.wins++;
        decks.set(key, deck);
      }
    }
  }
  for (const [memberId, counts] of deckCounts) {
    const st = byMember.get(memberId);
    if (st) st.topDeck = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  }
  const standings = [...byMember.values()]
    .filter((s) => s.games || members.some((m) => m.id === s.memberId))
    .sort((a, b) => pct(b.wins, b.games) - pct(a.wins, a.games) || b.wins - a.wins || b.games - a.games || a.name.localeCompare(b.name));

  const lengths = games.map(ms).filter((x): x is number => x !== null && x > 0);
  const rounds = games.map((g) => g.rounds).filter((r): r is number => r !== null);

  return {
    games: games.length,
    podSizes,
    averageMs: lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : null,
    averageRounds: rounds.length ? Math.round((rounds.reduce((a, b) => a + b, 0) / rounds.length) * 10) / 10 : null,
    standings,
    decks: [...decks.values()].sort((a, b) => b.games - a.games || pct(b.wins, b.games) - pct(a.wins, a.games) || b.lastPlayed.localeCompare(a.lastPlayed)),
    turnOrder: turnOrder(games),
    highlights: highlights(games, byMember),
  };
}

function turnOrder(games: Game[]): GroupStats['turnOrder'] {
  // The usual table size; mixing sizes would make "4th" mean nothing in a 3-player game.
  const sizes = new Map<number, number>();
  for (const g of games) if (g.winnerSeat !== null) sizes.set(g.seats.length, (sizes.get(g.seats.length) ?? 0) + 1);
  const usual = [...sizes].sort((a, b) => b[1] - a[1])[0];
  if (!usual || usual[1] < 3) return null;
  const [players] = usual;
  const wins = Array<number>(players).fill(0);
  let count = 0;
  for (const g of games) {
    if (g.seats.length !== players || g.winnerSeat === null) continue;
    count++;
    wins[(g.winnerSeat - g.firstSeat + players) % players]++;
  }
  return { players, games: count, wins };
}

function highlights(games: Game[], byMember: Map<string, Standing>): Highlight[] {
  const out: Highlight[] = [];
  const name = (id: string) => byMember.get(id)?.name ?? 'Someone';
  const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  if (!games.length) return out;

  const timed = games.filter((g) => (ms(g) ?? 0) > 0).sort((a, b) => ms(b)! - ms(a)!);
  if (timed.length >= 2) {
    const fmt = (g: Game) => { const m = Math.round(ms(g)! / 60000); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`; };
    out.push({ label: 'Longest game', value: fmt(timed[0]), detail: `${date(timed[0].startedAt)}, won by ${winnerName(timed[0])}` });
    const last = timed[timed.length - 1];
    out.push({ label: 'Quickest game', value: fmt(last), detail: `${date(last.startedAt)}, won by ${winnerName(last)}` });
  }

  // Longest run of wins in a row, oldest game first.
  let best = { id: '', n: 0, from: '', to: '' };
  let run = { id: '', n: 0, from: '' };
  for (const g of [...games].reverse()) {
    const w = g.seats.find((s) => s.won);
    if (!w) { run = { id: '', n: 0, from: '' }; continue; }
    run = w.memberId === run.id ? { ...run, n: run.n + 1 } : { id: w.memberId, n: 1, from: g.startedAt };
    if (run.n > best.n) best = { ...run, to: g.startedAt };
  }
  if (best.n >= 2) out.push({ label: 'Longest win streak', value: `${best.n} in a row`, detail: `${name(best.id)}, ${date(best.from)} to ${date(best.to)}` });

  // Out first most often, over games where someone was knocked out.
  const firstOut = new Map<string, number>();
  let withOuts = 0;
  for (const g of games) {
    const out1 = firstOutOf(g);
    if (out1 === null) continue;
    withOuts++;
    const id = g.seats[out1].memberId;
    firstOut.set(id, (firstOut.get(id) ?? 0) + 1);
  }
  const fo = [...firstOut].sort((a, b) => b[1] - a[1])[0];
  if (fo && withOuts >= 3) out.push({ label: 'Out first most often', value: name(fo[0]), detail: `${pct(fo[1], withOuts)}% of games (${fo[1]} of ${withOuts})` });

  const dealt = new Map<string, number>();
  for (const g of games) for (const s of g.seats) dealt.set(s.memberId, (dealt.get(s.memberId) ?? 0) + s.cmdDealt);
  const cd = [...dealt].sort((a, b) => b[1] - a[1])[0];
  if (cd && cd[1] > 0) out.push({ label: 'Most commander damage', value: `${cd[1]}`, detail: `${name(cd[0])}, across every game` });

  // Who beats whom: of two players' games together, who finished ahead more often.
  const ahead = new Map<string, number>();
  for (const g of games) {
    for (const a of g.seats) for (const b of g.seats) {
      if (a.memberId === b.memberId || a.place === null || b.place === null || a.place >= b.place) continue;
      const k = `${a.memberId}>${b.memberId}`;
      ahead.set(k, (ahead.get(k) ?? 0) + 1);
    }
  }
  const nemesis = [...ahead].sort((x, y) => y[1] - x[1])[0];
  if (nemesis && nemesis[1] >= 3) {
    const [a, b] = nemesis[0].split('>');
    const back = ahead.get(`${b}>${a}`) ?? 0;
    out.push({ label: 'Rivalry', value: `${name(a)} over ${name(b)}`, detail: `finished ahead ${nemesis[1]} times to ${back}` });
  }
  return out;
}

function winnerName(g: Game) {
  return g.seats.find((s) => s.won)?.name ?? 'nobody (a draw)';
}

function firstOutOf(g: Game): number | null {
  const e = g.events.find((x) => x.k === 'out');
  return e && e.k === 'out' ? e.s : null;
}

export const winRate = (wins: number, games: number) => pct(wins, games);
