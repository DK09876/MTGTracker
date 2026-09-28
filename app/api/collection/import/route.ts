/**
 * Import a collection: a CSV from ManaBox, Moxfield, Deckbox or TCGplayer,
 * or a plain list. POST {text, location?} - cards without a box column go
 * into `location`. Answers what was added and what could not be found.
 */

import { NextResponse } from 'next/server';

import { addManyToCollection } from '@/lib/collection';
import { readCollectionFile, resolveRows } from '@/lib/collection-import';
import { requireProfile } from '@/lib/profile-route';
import { collection, ScryfallError } from '@/lib/scryfall';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A few thousand rows is a big collection; far beyond is a mistake.
const MAX_TEXT = 3_000_000;

export async function POST(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  let b: { text?: unknown; location?: unknown };
  try {
    b = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const text = typeof b.text === 'string' ? b.text : '';
  if (!text.trim()) return NextResponse.json({ error: 'Nothing to import' }, { status: 400 });
  if (text.length > MAX_TEXT) return NextResponse.json({ error: 'That file is too big to import in one go' }, { status: 413 });
  const location = typeof b.location === 'string' ? b.location.trim().slice(0, 60) : '';

  try {
    const { rows, unreadable, format } = readCollectionFile(text, location);
    const { items, missing, byName } = await resolveRows(rows, collection);
    addManyToCollection(who.profile, items);
    return NextResponse.json({
      format,
      copies: items.reduce((n, i) => n + i.quantity, 0),
      unique: new Set(items.map((i) => i.card.oracle_id ?? i.card.id)).size,
      missing,
      byName,
      unreadable,
    });
  } catch (error) {
    if (error instanceof ScryfallError) return NextResponse.json({ error: error.message }, { status: 502 });
    console.error('[collection] import failed', error);
    return NextResponse.json({ error: 'Could not import that' }, { status: 500 });
  }
}
