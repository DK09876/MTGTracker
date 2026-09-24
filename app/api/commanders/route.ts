/**
 * Cards that can lead a deck, for the commander picker: name, type line and
 * a thumbnail, most played first.
 */

import { NextResponse } from 'next/server';

import { findCommanders, imageOf, typeLineOf } from '@/lib/scryfall';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX = 8;

export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get('q') ?? '').trim();
  if (q.length < 2) return NextResponse.json({ commanders: [] });
  try {
    const cards = (await findCommanders(q)).slice(0, MAX);
    return NextResponse.json({
      commanders: cards.map((c) => ({ id: c.id, name: c.name, typeLine: typeLineOf(c), image: imageOf(c, 'small') })),
    });
  } catch (error) {
    // An empty dropdown is better than an error while typing.
    console.error('[commanders] failed', error);
    return NextResponse.json({ commanders: [] });
  }
}
