/** The profile's collection as a CSV: boxes, and the copies decks hold (by the box they came from). */

import { NextResponse } from 'next/server';

import { boxCopies, deckCopies } from '@/lib/collection';
import { toCsv } from '@/lib/collection-import';
import { requireProfile } from '@/lib/profile-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  const rows = [
    ...boxCopies(who.profile),
    ...deckCopies(who.profile).map((d) => ({ ...d, location: d.fromLocation })),
  ];
  return new NextResponse(toCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="mtg-collection-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
