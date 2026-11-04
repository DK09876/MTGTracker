/**
 * Cards that can lead a deck, for the commander picker: name, type line and
 * a thumbnail, most played first.
 */

import { NextResponse } from 'next/server';

import { localCommanders } from '@/lib/card-store';
import { findCommanders, imageOf, typeLineOf } from '@/lib/scryfall';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX = 8;

export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get('q') ?? '').trim();
  if (q.length < 2) return NextResponse.json({ commanders: [] });
  try {
    // The copy of Scryfall's cards on the Pi answers at once; Scryfall itself
    // only when that has nothing (not downloaded yet, or a brand-new card).
    const local = localCommanders(q, MAX);
    const cards = local.length ? local : (await findCommanders(q)).slice(0, MAX);
    return NextResponse.json({
      commanders: cards.map((c) => ({ id: c.id, oracleId: c.oracle_id ?? null, name: c.name, typeLine: typeLineOf(c), image: imageOf(c, 'small') })),
    });
  } catch (error) {
    // An empty dropdown is better than an error while typing.
    console.error('[commanders] failed', error);
    return NextResponse.json({ commanders: [] });
  }
}
