/** POST: get the guided tour's sample ready (seeded the first time) and answer its deck. */

import { NextResponse } from 'next/server';

import { ensureTour } from '@/lib/tour';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    return NextResponse.json({ deckId: await ensureTour() });
  } catch (error) {
    console.error('[tour] seeding failed', error);
    return NextResponse.json({ error: 'Could not get the tour ready - try again in a moment' }, { status: 502 });
  }
}
