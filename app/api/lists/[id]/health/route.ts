/**
 * A deck's health: its curve, colours, types, warnings and opening-hand
 * odds, all from the stored cards, so it answers at once. With ?roles=1 it
 * gives the role counts instead, which need Scryfall's tags the first time
 * a card is seen (saved after) - asked for separately so the rest of the
 * page does not wait on them. Main board only.
 */

import { NextResponse } from 'next/server';

import { cachedRoles, cardsInList, saveRoles } from '@/lib/db';
import { analyse } from '@/lib/health';
import { requireList } from '@/lib/profile-route';
import { countRoles, LAND_TARGET } from '@/lib/roles';
import { searchCards } from '@/lib/scryfall';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;

  const main = cardsInList(id).filter((c) => c.board === 'main');
  if (new URL(request.url).searchParams.get('roles') !== '1') {
    return NextResponse.json({ health: analyse({ commander: owned.list.commander, cards: main }), landTarget: LAND_TARGET });
  }
  try {
    const roles = await countRoles(main, { search: (q) => searchCards(q), cached: cachedRoles, save: saveRoles });
    return NextResponse.json({ roles });
  } catch (error) {
    console.error('[health] roles failed', error);
    return NextResponse.json({ error: 'Could not reach Scryfall for the role tags' }, { status: 502 });
  }
}
