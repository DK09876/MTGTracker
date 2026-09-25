/**
 * The owner putting a tag on a card, or taking it off. Answers with the
 * deck's tags. Taking off a tag the model applied is remembered, so a
 * later run does not put it back.
 */

import { NextResponse } from 'next/server';

import { deckTags, setCardTag } from '@/lib/db';
import { requireList } from '@/lib/profile-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  let b: { cardKey?: unknown; tagId?: unknown; on?: unknown };
  try {
    b = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (typeof b.cardKey !== 'string' || typeof b.tagId !== 'string' || typeof b.on !== 'boolean') {
    return NextResponse.json({ error: 'cardKey, tagId and on required' }, { status: 400 });
  }
  if (!setCardTag(id, b.cardKey, b.tagId, b.on)) return NextResponse.json({ error: 'No such tag' }, { status: 404 });
  return NextResponse.json(deckTags(id));
}
