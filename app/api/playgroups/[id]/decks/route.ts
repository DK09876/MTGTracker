/** GET: each member's decks to pick from when starting a game - names and commanders only. */

import { NextResponse } from 'next/server';

import { decksForGroup, groupFor } from '@/lib/games';
import { requireProfile } from '@/lib/profile-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  if (!groupFor(who.profile, id)) return NextResponse.json({ error: 'No such playgroup' }, { status: 404 });
  return NextResponse.json({ decks: decksForGroup(id) });
}
