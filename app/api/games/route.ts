/**
 * GET: this profile's decks that have been played, each with its record.
 * POST { groupId, seats: [{ memberId, deckId?, deckName? }], startingLife, firstSeat, borrowing }:
 * start a game, seats in order round the table. One person may take more
 * than one seat; with borrowing, a seat may play any member's deck.
 */

import { NextResponse } from 'next/server';

import { getList } from '@/lib/db';
import { deckRecords, groupFor, groupsOf, seatDeck, startGame, type NewSeat } from '@/lib/games';
import { requireProfile } from '@/lib/profile-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PLAYERS = 6;

export async function GET(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  return NextResponse.json({ records: deckRecords(who.profile) });
}

export async function POST(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  const body = await request.json().catch(() => ({})) as { groupId?: unknown; seats?: unknown; startingLife?: unknown; firstSeat?: unknown; borrowing?: unknown };
  const groupId = typeof body.groupId === 'string' ? body.groupId : '';
  if (!groupFor(who.profile, groupId)) return NextResponse.json({ error: 'No such playgroup' }, { status: 404 });
  const all = groupsOf(who.profile).find((g) => g.id === groupId)!.members;
  const members = new Map(all.map((m) => [m.id, m]));
  const borrowing = body.borrowing === true;

  const raw = Array.isArray(body.seats) ? body.seats as Array<{ memberId?: unknown; deckId?: unknown; deckName?: unknown }> : [];
  if (raw.length < 2 || raw.length > MAX_PLAYERS) return NextResponse.json({ error: `A game needs 2 to ${MAX_PLAYERS} players` }, { status: 400 });
  const seats: NewSeat[] = [];
  for (const s of raw) {
    const member = typeof s.memberId === 'string' ? members.get(s.memberId) : undefined;
    if (!member) return NextResponse.json({ error: 'Everyone at the table has to be in the playgroup' }, { status: 400 });
    seats.push({ memberId: member.id, ...seatDeck(all, member, s.deckId, s.deckName, borrowing, getList) });
  }
  const life = Number(body.startingLife);
  const startingLife = Number.isInteger(life) && life > 0 && life <= 999 ? life : 40;
  const first = Number(body.firstSeat);
  const firstSeat = Number.isInteger(first) && first >= 0 && first < seats.length ? first : 0;
  return NextResponse.json({ id: startGame(groupId, who.profile, seats, startingLife, firstSeat, borrowing) }, { status: 201 });
}
