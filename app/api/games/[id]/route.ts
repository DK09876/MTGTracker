/**
 * GET: the game, events and all.
 * PUT { events, base }: keep a live game's events; `base` is how many the
 * sender last saw saved. 409 with the saved ones when another device moved on.
 * POST { winner, events }: finish it (winner null for a draw).
 * PATCH { winner?, note?, seat? }: fix a game afterwards.
 * DELETE: throw it away.
 */

import { NextResponse } from 'next/server';

import { getList } from '@/lib/db';
import { cleanEvents } from '@/lib/game-play';
import { deleteGame, editGame, finishGame, gameFor, groupsOf, saveEvents, seatDeck } from '@/lib/games';
import { requireProfile } from '@/lib/profile-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

function find(request: Request, id: string) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  const game = gameFor(who.profile, id);
  return game ? { profile: who.profile, game } : NextResponse.json({ error: 'No such game' }, { status: 404 });
}

const winnerOf = (v: unknown, players: number) => (v === null ? null : Number.isInteger(v) && (v as number) >= 0 && (v as number) < players ? v as number : undefined);

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const found = find(request, id);
  if (found instanceof NextResponse) return found;
  return NextResponse.json({ game: found.game });
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const found = find(request, id);
  if (found instanceof NextResponse) return found;
  if (found.game.status !== 'live') return NextResponse.json({ error: 'This game is over', game: found.game }, { status: 409 });
  const body = await request.json().catch(() => ({})) as { events?: unknown; base?: unknown };
  const events = cleanEvents(body.events, found.game.seats.length);
  if (!events || !Number.isInteger(body.base)) return NextResponse.json({ error: 'That game record is not readable' }, { status: 400 });
  const saved = saveEvents(id, events, body.base as number);
  return saved.ok ? NextResponse.json({ saved: events.length }) : NextResponse.json({ error: 'Another device changed this game', events: saved.events }, { status: 409 });
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const found = find(request, id);
  if (found instanceof NextResponse) return found;
  if (found.game.status !== 'live') return NextResponse.json({ error: 'This game is already finished' }, { status: 409 });
  const body = await request.json().catch(() => ({})) as { winner?: unknown; events?: unknown };
  const winner = winnerOf(body.winner, found.game.seats.length);
  const events = body.events === undefined ? found.game.events : cleanEvents(body.events, found.game.seats.length);
  if (winner === undefined || !events) return NextResponse.json({ error: 'Pick who won, or call it a draw' }, { status: 400 });
  finishGame(found.game, winner, events);
  return NextResponse.json({ game: gameFor(found.profile, id) });
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const found = find(request, id);
  if (found instanceof NextResponse) return found;
  const { game } = found;
  const body = await request.json().catch(() => ({})) as { winner?: unknown; note?: unknown; seat?: { seat?: unknown; deckId?: unknown; deckName?: unknown } };
  const change: Parameters<typeof editGame>[1] = {};
  if ('winner' in body) {
    const w = winnerOf(body.winner, game.seats.length);
    if (w === undefined) return NextResponse.json({ error: 'No such player' }, { status: 400 });
    change.winner = w;
  }
  if (typeof body.note === 'string') change.note = body.note.slice(0, 2000);
  if (body.seat) {
    const seat = game.seats.find((s) => s.seat === body.seat!.seat);
    const members = groupsOf(found.profile).find((g) => g.id === game.groupId)?.members ?? [];
    const pilot = members.find((m) => m.id === seat?.memberId);
    if (!seat || !pilot) return NextResponse.json({ error: 'No such seat' }, { status: 400 });
    change.seat = { seat: seat.seat, ...seatDeck(members, pilot, body.seat.deckId, body.seat.deckName, game.borrowing, getList) };
  }
  editGame(game, change);
  return NextResponse.json({ game: gameFor(found.profile, id) });
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const found = find(request, id);
  if (found instanceof NextResponse) return found;
  deleteGame(id);
  return NextResponse.json({ ok: true });
}
