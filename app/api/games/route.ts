/**
 * GET: this profile's decks that have been played, each with its record.
 * POST { groupId, seats: [{ memberId, deckId?, deckName? }], startingLife, firstSeat }:
 * start a game, seats in order round the table.
 */

import { NextResponse } from 'next/server';

import { getList } from '@/lib/db';
import { cleanName, commanderOf, deckRecords, groupFor, groupsOf, startGame, type NewSeat } from '@/lib/games';
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
  const body = await request.json().catch(() => ({})) as { groupId?: unknown; seats?: unknown; startingLife?: unknown; firstSeat?: unknown };
  const groupId = typeof body.groupId === 'string' ? body.groupId : '';
  if (!groupFor(who.profile, groupId)) return NextResponse.json({ error: 'No such playgroup' }, { status: 404 });
  const members = new Map(groupsOf(who.profile).find((g) => g.id === groupId)!.members.map((m) => [m.id, m]));

  const raw = Array.isArray(body.seats) ? body.seats as Array<{ memberId?: unknown; deckId?: unknown; deckName?: unknown }> : [];
  if (raw.length < 2 || raw.length > MAX_PLAYERS) return NextResponse.json({ error: `A game needs 2 to ${MAX_PLAYERS} players` }, { status: 400 });
  const seats: NewSeat[] = [];
  for (const s of raw) {
    const member = typeof s.memberId === 'string' ? members.get(s.memberId) : undefined;
    if (!member) return NextResponse.json({ error: 'Everyone at the table has to be in the playgroup' }, { status: 400 });
    if (seats.some((x) => x.memberId === member.id)) return NextResponse.json({ error: `${member.name} is sitting down twice` }, { status: 400 });
    // A deck on the app is read here, not taken from the browser: its name and commander as they are now.
    const deck = typeof s.deckId === 'string' && member.profileId ? getList(s.deckId, member.profileId) : null;
    if (deck && deck.kind === 'deck') seats.push({ memberId: member.id, deckId: deck.id, deckName: deck.name, commander: commanderOf(deck.commander) });
    else seats.push({ memberId: member.id, deckId: null, deckName: cleanName(s.deckName, 60), commander: null });
  }
  const life = Number(body.startingLife);
  const startingLife = Number.isInteger(life) && life > 0 && life <= 999 ? life : 40;
  const first = Number(body.firstSeat);
  const firstSeat = Number.isInteger(first) && first >= 0 && first < seats.length ? first : 0;
  return NextResponse.json({ id: startGame(groupId, who.profile, seats, startingLife, firstSeat) }, { status: 201 });
}
