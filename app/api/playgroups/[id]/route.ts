/**
 * GET [?players=N]: the playgroup - its people, games, any game still being
 * played, and the stats (only games with N players when asked).
 * PATCH { name }: rename it.
 * DELETE: delete it and every game in it.
 */

import { NextResponse } from 'next/server';

import { groupStats } from '@/lib/game-stats';
import { cleanName, deleteGroup, gamesIn, groupFor, groupsOf, renameGroup, type Game } from '@/lib/games';
import { requireProfile } from '@/lib/profile-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const withoutEvents = (g: Game) => {
  const rest: Partial<Game> = { ...g };
  delete rest.events;
  return rest;
};

type Params = { params: Promise<{ id: string }> };

function find(request: Request, id: string) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  const group = groupFor(who.profile, id);
  return group ? { profile: who.profile, group } : NextResponse.json({ error: 'No such playgroup' }, { status: 404 });
}

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const found = find(request, id);
  if (found instanceof NextResponse) return found;
  const summary = groupsOf(found.profile).find((g) => g.id === id)!;
  const games = gamesIn(id);
  const players = Number(new URL(request.url).searchParams.get('players')) || undefined;
  return NextResponse.json({
    group: summary,
    // The list leaves out each game's events - the game page reads those.
    games: games.map(withoutEvents),
    live: gamesIn(id, 'live').map(withoutEvents),
    stats: groupStats(games, summary.members, players),
  });
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const found = find(request, id);
  if (found instanceof NextResponse) return found;
  const body = await request.json().catch(() => ({})) as { name?: unknown };
  const name = cleanName(body.name, 60);
  if (!name) return NextResponse.json({ error: 'A playgroup needs a name' }, { status: 400 });
  renameGroup(id, name);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const found = find(request, id);
  if (found instanceof NextResponse) return found;
  deleteGroup(id);
  return NextResponse.json({ ok: true });
}
