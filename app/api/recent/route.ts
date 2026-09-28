/**
 * The profile's recent searches.
 *
 *   GET                         newest first
 *   POST {text, replay}         keep one (again: to the top)
 *   DELETE ?text=               forget one; without text, all of them
 */

import { NextResponse } from 'next/server';

import { forgetRecentSearch, recentSearches, saveRecentSearch } from '@/lib/db';
import { requireProfile } from '@/lib/profile-route';
import { cleanText, parseReplay } from '@/lib/recent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  return NextResponse.json({ recent: recentSearches(who.profile) });
}

export async function POST(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  let body: { text?: unknown; replay?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const text = cleanText(body.text);
  const replay = parseReplay(body.replay);
  if (!text || !replay) return NextResponse.json({ error: 'text and replay required' }, { status: 400 });
  saveRecentSearch(who.profile, text, replay);
  return NextResponse.json({ recent: recentSearches(who.profile) });
}

export async function DELETE(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  const text = new URL(request.url).searchParams.get('text');
  forgetRecentSearch(who.profile, text === null ? null : text);
  return NextResponse.json({ recent: recentSearches(who.profile) });
}
