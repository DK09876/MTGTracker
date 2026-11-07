/**
 * How much of each deck the profile owns, for the decks page: every deck's
 * collection summary in one request, worked out from one read of each table.
 *
 *   GET   {decks: {[listId]: summary}}
 */

import { NextResponse } from 'next/server';

import { deckSummaries } from '@/lib/collection';
import { requireProfile } from '@/lib/profile-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  return NextResponse.json({ decks: deckSummaries(who.profile) });
}
