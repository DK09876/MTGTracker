/**
 * Card names for the search dropdown, proxied for the same reason search is:
 * Scryfall want a User-Agent, and the rate limit lives in one place.
 */

import { NextResponse } from 'next/server';

import { autocomplete } from '@/lib/scryfall';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const prefix = new URL(request.url).searchParams.get('q') ?? '';
  try {
    return NextResponse.json({ names: await autocomplete(prefix) });
  } catch (error) {
    // A missing suggestion list is not worth an error on screen.
    console.error('[autocomplete] failed', error);
    return NextResponse.json({ names: [] });
  }
}
