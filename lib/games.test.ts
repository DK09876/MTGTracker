/**
 * Game nights: the life counter's events, playgroups and who sees them,
 * finishing a game, and the stats read from finished games.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { addChange, cleanEvents, deathReason, lifeOverTime, placings, playState, type GameEvent } from './game-play';

describe('the life counter', () => {
  it('folds life, commander damage, poison, turns and knockouts', () => {
    const t = 1000;
    const events: GameEvent[] = [
      { k: 'life', s: 0, d: -5, t },
      { k: 'cmd', s: 1, from: 2, d: 7, t },
      { k: 'poison', s: 3, d: 4, t },
      { k: 'turn', t }, { k: 'turn', t }, { k: 'turn', t }, { k: 'turn', t },
      { k: 'out', s: 0, t },
    ];
    const state = playState(4, 40, 0, events);
    expect(state.seats.map((s) => s.life)).toEqual([35, 33, 40, 40]);
    expect(state.seats[1].cmd).toEqual({ 2: 7 });
    expect(state.seats[3].poison).toBe(4);
    // Four passes from seat 0 come back round to it: round two. It is out, so seat 1 is up.
    expect(state.round).toBe(2);
    expect(state.active).toBe(1);
    expect(state.alive).toEqual([1, 2, 3]);
    expect(state.seats[0].outOrder).toBe(1);
  });

  it('counts rounds from whoever went first and skips players who are out', () => {
    const t = 0;
    const state = playState(3, 40, 2, [{ k: 'out', s: 0, t }, { k: 'turn', t }, { k: 'turn', t }]);
    // Seat 2 first, then seat 1 (seat 0 is out), then back to 2: round two.
    expect(state.active).toBe(2);
    expect(state.round).toBe(2);
  });

  it('moves the turn on when the player whose turn it is goes out', () => {
    const t = 0;
    // Seat 3 goes first and is knocked out on its own turn: seat 0 is up, still in round one.
    const state = playState(4, 40, 3, [{ k: 'out', s: 3, t }]);
    expect(state.active).toBe(0);
    expect(state.round).toBe(1);
    const next = playState(4, 40, 3, [{ k: 'out', s: 3, t }, { k: 'turn', t }]);
    expect(next.active).toBe(1);
  });

  it('merges quick taps on the same counter and drops a change that nets to nothing', () => {
    let e: GameEvent[] = [];
    for (let i = 0; i < 3; i++) e = addChange(e, { k: 'life', s: 1, d: -1, t: 1000 + i * 300 });
    expect(e).toEqual([{ k: 'life', s: 1, d: -3, t: 1600 }]);
    e = addChange(e, { k: 'life', s: 2, d: -1, t: 1700 });
    e = addChange(e, { k: 'life', s: 2, d: 1, t: 1800 });
    expect(e).toHaveLength(1);
    // Long after, a separate change; commander damage from someone else is its own too.
    e = addChange(e, { k: 'life', s: 1, d: -1, t: 9000 });
    e = addChange(e, { k: 'cmd', s: 1, from: 0, d: 2, t: 9100 });
    e = addChange(e, { k: 'cmd', s: 1, from: 3, d: 2, t: 9200 });
    expect(e).toHaveLength(4);
  });

  it('says why a player looks dead without knocking them out', () => {
    const t = 0;
    const s = playState(2, 40, 0, [{ k: 'cmd', s: 0, from: 1, d: 21, t }, { k: 'poison', s: 1, d: 10, t }]).seats;
    expect(deathReason(s[0])).toBe('21 commander damage');
    expect(deathReason(s[1])).toBe('10 poison');
    expect(s[0].out).toBe(false);
  });

  it('places the winner first, then the last out to the first out', () => {
    const t = 0;
    const state = playState(4, 40, 0, [{ k: 'out', s: 2, t }, { k: 'out', s: 0, t }, { k: 'out', s: 3, t }]);
    expect(placings(state, 1)).toEqual([3, 1, 4, 2]);
    // A draw between the two still standing.
    const draw = playState(4, 40, 0, [{ k: 'out', s: 2, t }, { k: 'out', s: 0, t }]);
    expect(placings(draw, null)).toEqual([2, 1, 3, 1]);
  });

  it('draws life over time, one row per change', () => {
    const rows = lifeOverTime(2, 20, 0, [{ k: 'life', s: 0, d: -3, t: 5 }, { k: 'turn', t: 6 }, { k: 'cmd', s: 1, from: 0, d: 4, t: 7 }]);
    expect(rows).toEqual([{ t: null, life: [20, 20] }, { t: 5, life: [17, 20] }, { t: 7, life: [17, 16] }]);
  });

  it('refuses events about seats that do not exist', () => {
    expect(cleanEvents([{ k: 'life', s: 0, d: -1, t: 1 }], 2)).toHaveLength(1);
    expect(cleanEvents([{ k: 'life', s: 4, d: -1, t: 1 }], 2)).toBeNull();
    expect(cleanEvents([{ k: 'cmd', s: 1, from: 1, d: 3, t: 1 }], 2)).toBeNull();
    expect(cleanEvents([{ k: 'nope', t: 1 }], 2)).toBeNull();
    expect(cleanEvents('[]', 2)).toBeNull();
  });
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-games-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

async function setUp() {
  const db = await import('./db');
  const games = await import('./games');
  const stats = await import('./game-stats');
  const dk = db.addProfile('dk', 'DK');
  db.addProfile('kevin', 'Kevin');
  db.addProfile('mia', 'Mia');
  const group = games.createGroup(dk, 'Friday');
  const kevin = games.addMember(group.id, { profileId: 'kevin', name: 'Kevin' })!;
  const haley = games.addMember(group.id, { profileId: null, name: 'Haley' })!;
  const me = games.groupsOf('dk')[0].members.find((m) => m.profileId === 'dk')!;
  return { db, games, stats, group, me, kevin, haley };
}

describe('playgroups', () => {
  it('are seen only by their members, guests included as names', async () => {
    const { games, group, kevin } = await setUp();
    expect(games.groupFor('dk', group.id)?.name).toBe('Friday');
    expect(games.groupFor('kevin', group.id)).not.toBeNull();
    expect(games.groupFor('mia', group.id)).toBeNull();
    expect(games.groupsOf('mia')).toEqual([]);
    expect(games.groupsOf('dk')[0].members.map((m) => m.name)).toEqual(['DK', 'Kevin', 'Haley']);
    // A second guest by the same name is refused; a profile added again is the same member.
    expect(games.addMember(group.id, { profileId: null, name: 'haley' })).toBeNull();
    expect(games.addMember(group.id, { profileId: 'kevin', name: 'Kevin' })?.id).toBe(kevin.id);
    games.removeMember(group.id, kevin.id);
    expect(games.groupFor('kevin', group.id)).toBeNull();
    expect(games.addMember(group.id, { profileId: 'kevin', name: 'Kevin' })?.id).toBe(kevin.id);
  });

  it('offer each member\'s decks by name and commander, last played first', async () => {
    const { db, games, group, me, kevin } = await setUp();
    const a = db.createList('dk', 'Azula', '', { kind: 'deck' });
    db.createList('dk', 'Kratos', '', { kind: 'deck' });
    db.createList('dk', 'Just a list', '');
    const id = games.startGame(group.id, 'dk', [
      { memberId: me.id, deckId: a.id, deckName: 'Azula', commander: null },
      { memberId: kevin.id, deckId: null, deckName: '', commander: null },
    ], 40, 0);
    games.finishGame(games.gameFor('dk', id)!, 0, []);
    const decks = games.decksForGroup(group.id);
    expect(decks[me.id].map((d) => d.name)).toEqual(['Azula', 'Kratos']);
    expect(decks[kevin.id]).toEqual([]);
  });
});

describe('games', () => {
  it('save events only on top of what was saved, and finish with each seat\'s result', async () => {
    const { db, games, group, me, kevin, haley } = await setUp();
    const azula = db.createList('dk', 'Azula', '', { kind: 'deck' });
    const id = games.startGame(group.id, 'dk', [
      { memberId: me.id, deckId: azula.id, deckName: 'Azula', commander: null },
      { memberId: kevin.id, deckId: null, deckName: 'Scry til they die', commander: null },
      { memberId: haley.id, deckId: null, deckName: '', commander: null },
    ], 40, 1);
    expect(games.gameFor('mia', id)).toBeNull();
    const start = Date.parse(games.gameFor('dk', id)!.startedAt);
    const events: GameEvent[] = [
      { k: 'cmd', s: 2, from: 0, d: 21, t: start + 60_000 },
      { k: 'out', s: 2, t: start + 61_000 },
      { k: 'life', s: 1, d: -40, t: start + 90_000 },
      { k: 'out', s: 1, t: start + 91_000 },
    ];
    expect(games.saveEvents(id, events.slice(0, 2), 0)).toEqual({ ok: true });
    // A stale copy from another phone is answered with what is saved.
    expect(games.saveEvents(id, events.slice(0, 1), 0)).toEqual({ ok: false, events: events.slice(0, 2) });
    expect(games.saveEvents(id, events, 2)).toEqual({ ok: true });

    games.finishGame(games.gameFor('dk', id)!, 0, events);
    const done = games.gameFor('dk', id)!;
    expect(done.status).toBe('done');
    expect(done.endedAt).toBe(new Date(start + 91_000).toISOString());
    expect(done.seats.map((s) => [s.name, s.life, s.place, s.won, s.cmdDealt])).toEqual([
      ['DK', 40, 1, true, 21], ['Kevin', 0, 2, false, 0], ['Haley', 19, 3, false, 0],
    ]);
    expect(games.deckRecords('dk')).toEqual({ [azula.id]: { games: 1, wins: 1 } });

    // The winner fixed afterwards.
    games.editGame(done, { winner: 1 });
    expect(games.gameFor('dk', id)!.seats.find((s) => s.won)?.name).toBe('Kevin');
    expect(games.deckRecords('dk')).toEqual({ [azula.id]: { games: 1, wins: 0 } });
  });
});

describe('stats', () => {
  it('rank players and decks, split by table size, and read turn order', async () => {
    const { games, stats, group, me, kevin, haley } = await setUp();
    const play = (seats: Array<[string, string]>, first: number, winner: number | null, minutes: number) => {
      const id = games.startGame(group.id, 'dk', seats.map(([memberId, deckName]) => ({ memberId, deckId: null, deckName, commander: null })), 40, first);
      const g = games.gameFor('dk', id)!;
      const start = Date.parse(g.startedAt);
      // The first seat after the winner goes out first.
      const outFirst = ((winner ?? 0) + 1) % seats.length;
      games.finishGame(g, winner, [{ k: 'out', s: outFirst, t: start + 1000 }, { k: 'life', s: 0, d: -1, t: start + minutes * 60_000 }]);
    };
    play([[me.id, 'Azula'], [kevin.id, 'Scry'], [haley.id, 'Daddy']], 0, 0, 60);
    play([[me.id, 'Azula'], [kevin.id, 'Scry'], [haley.id, 'Daddy']], 1, 0, 90);
    play([[me.id, 'Kratos'], [kevin.id, 'Scry'], [haley.id, 'Daddy']], 2, 2, 30);
    play([[me.id, 'Azula'], [kevin.id, 'Scry']], 0, 1, 20);

    const members = games.groupsOf('dk')[0].members;
    const all = stats.groupStats(games.gamesIn(group.id), members);
    expect(all.games).toBe(4);
    expect(all.podSizes).toEqual({ 2: 1, 3: 3 });
    expect(all.standings.map((s) => [s.name, s.wins, s.games])).toEqual([['DK', 2, 4], ['Haley', 1, 3], ['Kevin', 1, 4]]);
    expect(all.standings[0].topDeck).toBe('Azula');
    expect(all.decks.map((d) => [d.name, d.wins, d.games])).toEqual([['Scry', 1, 4], ['Azula', 2, 3], ['Daddy', 1, 3], ['Kratos', 0, 1]]);
    // Three-player games are the usual table: winners went 1st, 3rd and 1st.
    expect(all.turnOrder).toEqual({ players: 3, games: 3, wins: [2, 0, 1] });
    expect(all.averageMs).toBe(50 * 60_000);
    expect(all.highlights.map((h) => h.label)).toContain('Longest win streak');

    const twos = stats.groupStats(games.gamesIn(group.id), members, 2);
    expect(twos.games).toBe(1);
    expect(twos.standings.find((s) => s.name === 'Kevin')).toMatchObject({ wins: 1, games: 1 });
    expect(twos.turnOrder).toBeNull();
  });
});
