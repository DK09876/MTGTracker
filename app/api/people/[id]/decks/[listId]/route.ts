/** GET: a deck someone shows others - read only. A private deck is a 404 to anyone but its owner. */

import { NextResponse } from 'next/server';

import { cardsInList, getList } from '@/lib/db';
import { requireProfile } from '@/lib/profile-route';
import { isPublic, ownerOf } from '@/lib/profile-style';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string; listId: string }> }) {
  const { id, listId } = await params;
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  if (ownerOf(listId) !== id || (who.profile !== id && !isPublic(listId))) return NextResponse.json({ error: 'No such deck' }, { status: 404 });
  const list = getList(listId, id);
  if (!list) return NextResponse.json({ error: 'No such deck' }, { status: 404 });
  return NextResponse.json({ list, cards: cardsInList(listId).filter((c) => c.board === 'main') });
}
