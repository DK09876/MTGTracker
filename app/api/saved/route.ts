/**
 * The profile's saved searches: searches kept under a name to carry on later.
 *
 *   GET                                 all, most recently touched first
 *   POST   {name, session}               save one; answers its id
 *   PATCH  {id, name?, session?}         rename it, or save where it has got to
 *   DELETE ?id=                          forget it
 */

import { NextResponse } from 'next/server';

import { deleteSavedSearch, savedSearches, saveSearch, updateSavedSearch } from '@/lib/db';
import { requireProfile } from '@/lib/profile-route';
import { parseSession } from '@/lib/recent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const nameOf = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, 80) : '');

export async function GET(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  return NextResponse.json({ saved: savedSearches(who.profile) });
}

export async function POST(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  const b = await request.json().catch(() => ({})) as { name?: unknown; session?: unknown };
  const name = nameOf(b.name);
  const session = parseSession(b.session);
  if (!name || !session) return NextResponse.json({ error: 'A saved search needs a name and a search' }, { status: 400 });
  const id = saveSearch(who.profile, name, session);
  if (!id) return NextResponse.json({ error: 'That is 100 saved searches - forget some first' }, { status: 409 });
  return NextResponse.json({ id, saved: savedSearches(who.profile) });
}

export async function PATCH(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  const b = await request.json().catch(() => ({})) as { id?: unknown; name?: unknown; session?: unknown };
  if (typeof b.id !== 'string') return NextResponse.json({ error: 'id required' }, { status: 400 });
  const name = b.name === undefined ? undefined : nameOf(b.name);
  const session = b.session === undefined ? undefined : parseSession(b.session);
  if (name === '' || session === null) return NextResponse.json({ error: 'That name or search is not valid' }, { status: 400 });
  if (!updateSavedSearch(who.profile, b.id, { name, session })) return NextResponse.json({ error: 'No such saved search' }, { status: 404 });
  return NextResponse.json({ saved: savedSearches(who.profile) });
}

export async function DELETE(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  const id = new URL(request.url).searchParams.get('id');
  if (id) deleteSavedSearch(who.profile, id);
  return NextResponse.json({ saved: savedSearches(who.profile) });
}
