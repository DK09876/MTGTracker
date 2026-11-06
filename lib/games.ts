/**
 * Playgroups and the games they play. Server only.
 *
 * A playgroup is the people you play with: profiles on the app, or guests
 * who are only a name. Any member can see the group, add people, start a
 * game and fix one afterwards - it is a friend group, as the profiles are.
 *
 * A game keeps its events (lib/game-play.ts) while it is played; finishing
 * it writes one row per seat with how it went, which is what the stats
 * read. Each seat keeps the deck's name and commander as they were, so a
 * deck renamed or deleted later still shows what was played.
 *
 * One person may sit in more than one seat (two players piloting two decks
 * each), and with borrowing on a seat may play another member's deck: the
 * deck's record is its owner's, the win or loss is the pilot's.
 */

import { randomUUID } from 'node:crypto';

import { database, type Profile } from './db';
import { foldersFor } from './deck-folders';
import { commanderDealt, placings, playState, type GameEvent } from './game-play';
import { getStyle } from './profile-style';
import type { ScryfallCard } from './scryfall';

let ready = false;
function db() {
  const d = database();
  if (!ready) {
    d.run(`CREATE TABLE IF NOT EXISTS playgroups (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, createdBy TEXT NOT NULL, createdAt TEXT NOT NULL)`);
    // A member taken out of a group is kept, marked gone, so the games they played still have them.
    d.run(`CREATE TABLE IF NOT EXISTS playgroup_members (
      id TEXT PRIMARY KEY, groupId TEXT NOT NULL, profileId TEXT, name TEXT NOT NULL,
      addedAt TEXT NOT NULL, gone INTEGER NOT NULL DEFAULT 0)`);
    d.run('CREATE INDEX IF NOT EXISTS idx_members_group ON playgroup_members (groupId)');
    d.run('CREATE INDEX IF NOT EXISTS idx_members_profile ON playgroup_members (profileId)');
    d.run(`CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY, groupId TEXT NOT NULL, createdBy TEXT NOT NULL,
      status TEXT NOT NULL, startingLife INTEGER NOT NULL, firstSeat INTEGER NOT NULL,
      winnerSeat INTEGER, events TEXT NOT NULL DEFAULT '[]', rounds INTEGER,
      note TEXT NOT NULL DEFAULT '', startedAt TEXT NOT NULL, endedAt TEXT, updatedAt TEXT NOT NULL)`);
    d.run('CREATE INDEX IF NOT EXISTS idx_games_group ON games (groupId, startedAt)');
    d.run(`CREATE TABLE IF NOT EXISTS game_seats (
      gameId TEXT NOT NULL, seat INTEGER NOT NULL, memberId TEXT NOT NULL,
      deckId TEXT, deckName TEXT NOT NULL DEFAULT '', commander TEXT,
      life INTEGER, place INTEGER, won INTEGER NOT NULL DEFAULT 0, cmdDealt INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (gameId, seat))`);
    d.run('CREATE INDEX IF NOT EXISTS idx_seats_deck ON game_seats (deckId)');
    // Borrowed decks: the member whose deck a seat played, when it is not the pilot's own.
    const seatCols = (d.all('PRAGMA table_info(game_seats)') as Array<{ name: string }>).map((c) => c.name);
    if (!seatCols.includes('deckOwner')) d.run('ALTER TABLE game_seats ADD COLUMN deckOwner TEXT');
    const gameCols = (d.all('PRAGMA table_info(games)') as Array<{ name: string }>).map((c) => c.name);
    if (!gameCols.includes('borrowing')) d.run('ALTER TABLE games ADD COLUMN borrowing INTEGER NOT NULL DEFAULT 0');
    // How the counter's panels sit round the table (lib/game-layouts.ts); null is the usual one.
    if (!gameCols.includes('layout')) d.run('ALTER TABLE games ADD COLUMN layout TEXT');
    ready = true;
  }
  return d;
}

const now = () => new Date().toISOString();
export const cleanName = (name: unknown, max = 40) => (typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, max) : '');

// --- playgroups --------------------------------------------------------------

export interface Member { id: string; profileId: string | null; name: string; art: string | null; gone: boolean }
export interface Playgroup { id: string; name: string; createdBy: string; createdAt: string }
export interface GroupSummary extends Playgroup { members: Member[]; games: number; lastPlayed: string | null; live: string | null }

type MemberRow = { id: string; profileId: string | null; name: string; gone: number; profileName: string | null };

function membersOf(groupId: string, withGone = false): Member[] {
  const rows = db().all(`
    SELECT m.id, m.profileId, m.name, m.gone, p.name AS profileName FROM playgroup_members m
    LEFT JOIN profiles p ON p.id = m.profileId
    WHERE m.groupId = ? ${withGone ? '' : 'AND m.gone = 0'} ORDER BY m.addedAt, m.rowid`, [groupId]) as unknown as MemberRow[];
  // A profile's own name, as it is now; a guest's, or a removed profile's, as it was added.
  return rows.map((r) => ({
    id: r.id, profileId: r.profileId, name: r.profileName ?? r.name, gone: !!r.gone,
    art: r.profileId ? getStyle(r.profileId).commander?.art ?? null : null,
  }));
}

/** The group, if this profile is in it - a group you are not in is the same as one that does not exist. */
export function groupFor(profileId: string, groupId: string): Playgroup | null {
  return db().get(`
    SELECT g.id, g.name, g.createdBy, g.createdAt FROM playgroups g
    JOIN playgroup_members m ON m.groupId = g.id AND m.profileId = ? AND m.gone = 0
    WHERE g.id = ?`, [profileId, groupId]) as Playgroup | null;
}

export function groupsOf(profileId: string): GroupSummary[] {
  const groups = db().all(`
    SELECT g.id, g.name, g.createdBy, g.createdAt FROM playgroups g
    JOIN playgroup_members m ON m.groupId = g.id AND m.profileId = ? AND m.gone = 0
    ORDER BY g.createdAt`, [profileId]) as unknown as Playgroup[];
  return groups.map((g) => {
    const counts = db().get(`SELECT COUNT(*) AS n, MAX(startedAt) AS last FROM games WHERE groupId = ? AND status = 'done'`, [g.id]) as { n: number; last: string | null };
    const live = db().get(`SELECT id FROM games WHERE groupId = ? AND status = 'live' ORDER BY updatedAt DESC LIMIT 1`, [g.id]) as { id: string } | null;
    return { ...g, members: membersOf(g.id), games: counts.n, lastPlayed: counts.last, live: live?.id ?? null };
  }).sort((a, b) => (b.lastPlayed ?? b.createdAt).localeCompare(a.lastPlayed ?? a.createdAt));
}

/** A new group with its maker in it. */
export function createGroup(profile: Profile, name: string): Playgroup {
  const group = { id: randomUUID(), name, createdBy: profile.id, createdAt: now() };
  db().run('INSERT INTO playgroups (id, name, createdBy, createdAt) VALUES (?, ?, ?, ?)', [group.id, name, group.createdBy, group.createdAt]);
  addMember(group.id, { profileId: profile.id, name: profile.name });
  return group;
}

export function renameGroup(groupId: string, name: string): void {
  db().run('UPDATE playgroups SET name = ? WHERE id = ?', [name, groupId]);
}

/** Delete a group and every game in it. */
export function deleteGroup(groupId: string): void {
  const d = db();
  d.run('DELETE FROM game_seats WHERE gameId IN (SELECT id FROM games WHERE groupId = ?)', [groupId]);
  d.run('DELETE FROM games WHERE groupId = ?', [groupId]);
  d.run('DELETE FROM playgroup_members WHERE groupId = ?', [groupId]);
  d.run('DELETE FROM playgroups WHERE id = ?', [groupId]);
}

/**
 * Add a profile or a guest. A profile already in the group, or one taken
 * out before, is the same member again - so its old games stay its own.
 * Null when a guest by that name is already in.
 */
export function addMember(groupId: string, who: { profileId: string | null; name: string }): Member | null {
  const d = db();
  const existing = (who.profileId
    ? d.get('SELECT id, gone FROM playgroup_members WHERE groupId = ? AND profileId = ?', [groupId, who.profileId])
    : d.get('SELECT id, gone FROM playgroup_members WHERE groupId = ? AND profileId IS NULL AND lower(name) = lower(?)', [groupId, who.name])) as { id: string; gone: number } | null;
  if (existing) {
    if (!who.profileId && !existing.gone) return null;
    d.run('UPDATE playgroup_members SET gone = 0 WHERE id = ?', [existing.id]);
    return membersOf(groupId).find((m) => m.id === existing.id) ?? null;
  }
  const id = randomUUID();
  d.run('INSERT INTO playgroup_members (id, groupId, profileId, name, addedAt) VALUES (?, ?, ?, ?, ?)', [id, groupId, who.profileId, who.name, now()]);
  return membersOf(groupId).find((m) => m.id === id) ?? null;
}

export function removeMember(groupId: string, memberId: string): void {
  db().run('UPDATE playgroup_members SET gone = 1 WHERE groupId = ? AND id = ?', [groupId, memberId]);
}

// --- decks to pick from --------------------------------------------------------

export interface SeatCommander { name: string; art: string | null; identity: string[] }
export interface PickDeck {
  id: string;
  name: string;
  commander: SeatCommander | null;
  /** The owner's folder it sits in, if any. */
  folder: string | null;
  /** Its record across every group. */
  games: number;
  wins: number;
}

export function commanderOf(card: ScryfallCard | null): SeatCommander | null {
  if (!card) return null;
  const art = card.image_uris?.art_crop ?? card.card_faces?.[0]?.image_uris?.art_crop ?? null;
  return { name: card.name, art, identity: card.color_identity ?? [] };
}

/**
 * Each member's decks, for the seat picker: names and commanders only,
 * never the cards - a private deck stays private, but the table needs to
 * say what it is playing. The deck each one played last in this group first.
 */
export function decksForGroup(groupId: string): Record<string, PickDeck[]> {
  const d = db();
  const out: Record<string, PickDeck[]> = {};
  for (const m of membersOf(groupId)) {
    if (!m.profileId) { out[m.id] = []; continue; }
    const rows = d.all(`
      SELECT l.id, l.name, c.data AS commander,
        (SELECT MAX(g.startedAt) FROM game_seats s JOIN games g ON g.id = s.gameId WHERE s.deckId = l.id AND g.groupId = ?) AS lastPlayed
      FROM lists l LEFT JOIN cards c ON c.id = l.commanderId
      WHERE l.profileId = ? AND l.kind = 'deck'
      ORDER BY lastPlayed IS NULL, lastPlayed DESC, l.updatedAt DESC`, [groupId, m.profileId]) as Array<{ id: string; name: string; commander: string | null }>;
    const { folders, placed } = foldersFor(m.profileId);
    const folderName = new Map(folders.map((f) => [f.id, f.name]));
    const records = deckRecords(m.profileId);
    out[m.id] = rows.map((r) => ({
      id: r.id, name: r.name, commander: commanderOf(r.commander ? JSON.parse(r.commander) as ScryfallCard : null),
      folder: placed[r.id] ? folderName.get(placed[r.id]) ?? null : null,
      games: records[r.id]?.games ?? 0, wins: records[r.id]?.wins ?? 0,
    }));
  }
  return out;
}

// --- games -----------------------------------------------------------------------

export type GameStatus = 'live' | 'done';

export interface Seat {
  seat: number;
  memberId: string;
  name: string;
  profileId: string | null;
  deckId: string | null;
  deckName: string;
  commander: SeatCommander | null;
  /** The member whose deck this is, when it was borrowed from someone else. */
  deckOwner: { memberId: string; name: string } | null;
  /** Set once the game is finished. */
  life: number | null;
  place: number | null;
  won: boolean;
  cmdDealt: number;
}

export interface Game {
  id: string;
  groupId: string;
  status: GameStatus;
  startingLife: number;
  /** Whether seats could play other members' decks. */
  borrowing: boolean;
  layout: string | null;
  firstSeat: number;
  winnerSeat: number | null;
  events: GameEvent[];
  rounds: number | null;
  note: string;
  startedAt: string;
  endedAt: string | null;
  seats: Seat[];
}

type GameRow = Omit<Game, 'events' | 'seats' | 'borrowing'> & { events: string; borrowing: number };
type SeatRow = Omit<Seat, 'won' | 'commander' | 'name' | 'profileId' | 'deckOwner'> & { won: number; commander: string | null; deckOwner: string | null };

export interface NewSeat { memberId: string; deckId: string | null; deckName: string; commander: SeatCommander | null; deckOwner?: string | null }

/** Start a game; seats are in order round the table. */
export function startGame(groupId: string, createdBy: string, seats: NewSeat[], startingLife: number, firstSeat: number, borrowing = false, layout: string | null = null): string {
  const d = db();
  const id = randomUUID();
  const at = now();
  d.run(`INSERT INTO games (id, groupId, createdBy, status, startingLife, firstSeat, borrowing, layout, startedAt, updatedAt)
    VALUES (?, ?, ?, 'live', ?, ?, ?, ?, ?, ?)`, [id, groupId, createdBy, startingLife, firstSeat, borrowing ? 1 : 0, layout, at, at]);
  seats.forEach((s, i) => d.run(
    'INSERT INTO game_seats (gameId, seat, memberId, deckId, deckName, commander, deckOwner) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, i, s.memberId, s.deckId, s.deckName, s.commander ? JSON.stringify(s.commander) : null, s.deckOwner && s.deckOwner !== s.memberId ? s.deckOwner : null],
  ));
  return id;
}

function seatsOf(gameId: string, members: Map<string, Member>): Seat[] {
  return (db().all('SELECT * FROM game_seats WHERE gameId = ? ORDER BY seat', [gameId]) as unknown as SeatRow[]).map((r) => {
    const m = members.get(r.memberId);
    return {
      seat: r.seat, memberId: r.memberId, name: m?.name ?? 'Someone', profileId: m?.profileId ?? null,
      deckId: r.deckId, deckName: r.deckName, commander: r.commander ? JSON.parse(r.commander) as SeatCommander : null,
      deckOwner: r.deckOwner ? { memberId: r.deckOwner, name: members.get(r.deckOwner)?.name ?? 'Someone' } : null,
      life: r.life, place: r.place, won: !!r.won, cmdDealt: r.cmdDealt,
    };
  });
}

const memberMap = (groupId: string) => new Map(membersOf(groupId, true).map((m) => [m.id, m]));

function toGame(row: GameRow, members: Map<string, Member>): Game {
  return { ...row, borrowing: !!row.borrowing, events: JSON.parse(row.events) as GameEvent[], seats: seatsOf(row.id, members) };
}

/** The game, if this profile is in its group. */
export function gameFor(profileId: string, gameId: string): Game | null {
  const row = db().get('SELECT * FROM games WHERE id = ?', [gameId]) as GameRow | null;
  if (!row || !groupFor(profileId, row.groupId)) return null;
  return toGame(row, memberMap(row.groupId));
}

export function gamesIn(groupId: string, status: GameStatus = 'done'): Game[] {
  const members = memberMap(groupId);
  return (db().all('SELECT * FROM games WHERE groupId = ? AND status = ? ORDER BY startedAt DESC, rowid DESC', [groupId, status]) as unknown as GameRow[])
    .map((r) => toGame(r, members));
}

/**
 * Keep a live game's events. Only ever more of them, or an undo of the
 * last few: a stale tab sending an older copy is told, not obeyed.
 */
export function saveEvents(gameId: string, events: GameEvent[], base: number): { ok: true } | { ok: false; events: GameEvent[] } {
  const row = db().get('SELECT events, status FROM games WHERE id = ?', [gameId]) as { events: string; status: GameStatus } | null;
  if (!row) return { ok: true };
  const current = JSON.parse(row.events) as GameEvent[];
  // `base` is how many events the sender last saw saved; anything else means another device moved on.
  if (base !== current.length) return { ok: false, events: current };
  db().run('UPDATE games SET events = ?, updatedAt = ? WHERE id = ?', [JSON.stringify(events), now(), gameId]);
  return { ok: true };
}

/** Finish a game: who won (null for a draw), and each seat's result from its events. */
export function finishGame(game: Game, winner: number | null, events: GameEvent[]): void {
  const d = db();
  const state = playState(game.seats.length, game.startingLife, game.firstSeat, events);
  const places = placings(state, winner);
  const dealt = commanderDealt(state);
  const ended = events.length ? new Date(Math.max(...events.map((e) => e.t))).toISOString() : now();
  d.run(`UPDATE games SET status = 'done', winnerSeat = ?, events = ?, rounds = ?, endedAt = ?, updatedAt = ? WHERE id = ?`,
    [winner, JSON.stringify(events), events.some((e) => e.k === 'turn') ? state.round : null, ended > game.startedAt ? ended : now(), now(), game.id]);
  state.seats.forEach((s, i) => d.run('UPDATE game_seats SET life = ?, place = ?, won = ?, cmdDealt = ? WHERE gameId = ? AND seat = ?',
    [s.life, places[i], winner === i ? 1 : 0, dealt[i], game.id, i]));
}

/** Change a finished game's winner or note, or a seat's deck, afterwards. */
export function editGame(game: Game, change: { winner?: number | null; note?: string; layout?: string; seat?: { seat: number } & Omit<NewSeat, 'memberId'> }): void {
  const d = db();
  if (change.layout !== undefined) d.run('UPDATE games SET layout = ? WHERE id = ?', [change.layout, game.id]);
  if (change.note !== undefined) d.run('UPDATE games SET note = ? WHERE id = ?', [change.note, game.id]);
  if (change.seat) {
    const pilot = game.seats.find((s) => s.seat === change.seat!.seat)?.memberId;
    d.run('UPDATE game_seats SET deckId = ?, deckName = ?, commander = ?, deckOwner = ? WHERE gameId = ? AND seat = ?',
      [change.seat.deckId, change.seat.deckName, change.seat.commander ? JSON.stringify(change.seat.commander) : null,
        change.seat.deckOwner && change.seat.deckOwner !== pilot ? change.seat.deckOwner : null, game.id, change.seat.seat]);
  }
  if (change.winner !== undefined && game.status === 'done') finishGame(game, change.winner, game.events);
}

export function deleteGame(gameId: string): void {
  db().run('DELETE FROM game_seats WHERE gameId = ?', [gameId]);
  db().run('DELETE FROM games WHERE id = ?', [gameId]);
}

/**
 * The deck a seat plays: one of the pilot's own, or with borrowing any
 * member's - read here, never taken from the browser. A deck not on the app
 * is just its name.
 */
export function seatDeck(members: Member[], pilot: Member, deckId: unknown, deckName: unknown, borrowing: boolean, getDeck: (id: string, profileId: string) => { id: string; name: string; kind: string; commander: ScryfallCard | null } | null): Omit<NewSeat, 'memberId'> {
  if (typeof deckId === 'string') {
    for (const owner of borrowing ? [pilot, ...members.filter((m) => m.id !== pilot.id)] : [pilot]) {
      const deck = owner.profileId ? getDeck(deckId, owner.profileId) : null;
      if (deck && deck.kind === 'deck') return { deckId: deck.id, deckName: deck.name, commander: commanderOf(deck.commander), deckOwner: owner.id === pilot.id ? null : owner.id };
    }
  }
  return { deckId: null, deckName: cleanName(deckName, 60), commander: null, deckOwner: null };
}

// --- records -----------------------------------------------------------------------

export interface Record_ { games: number; wins: number }

/** Every deck of this profile that has been played, with its record across all groups. */
export function deckRecords(profileId: string): Record<string, Record_> {
  const rows = db().all(`
    SELECT s.deckId, COUNT(*) AS games, SUM(s.won) AS wins FROM game_seats s
    JOIN games g ON g.id = s.gameId AND g.status = 'done'
    JOIN lists l ON l.id = s.deckId AND l.profileId = ?
    GROUP BY s.deckId`, [profileId]) as Array<{ deckId: string; games: number; wins: number }>;
  return Object.fromEntries(rows.map((r) => [r.deckId, { games: r.games, wins: r.wins }]));
}
