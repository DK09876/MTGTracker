/**
 * A decklist into an existing list or deck.
 *
 *   POST {decklist}   add these cards to what is there
 *   PUT  {decklist}   make the list exactly this - "Edit as text", saved.
 *                     Refused with 422, changing nothing, if any line
 *                     cannot be found.
 */

import { NextResponse } from 'next/server';

import { getList } from '@/lib/db';
import { importInto, replaceWith } from '@/lib/import-into';
import { requireList } from '@/lib/profile-route';
import { ScryfallError } from '@/lib/scryfall';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  let body: { decklist?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!body.decklist?.trim()) return NextResponse.json({ error: 'Paste a decklist first' }, { status: 400 });

  try {
    const imported = await importInto(owned.list, body.decklist);
    return NextResponse.json({ list: getList(id, owned.profile), imported });
  } catch (error) {
    if (error instanceof ScryfallError) return NextResponse.json({ error: error.message }, { status: 502 });
    console.error('[import] failed', error);
    return NextResponse.json({ error: 'Could not import that list' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  let body: { decklist?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  try {
    const result = await replaceWith(owned.list, body.decklist ?? '');
    if (!result.applied) {
      return NextResponse.json({ error: 'Some lines could not be found, so nothing was changed', imported: result }, { status: 422 });
    }
    return NextResponse.json({ list: getList(id, owned.profile), imported: result });
  } catch (error) {
    if (error instanceof ScryfallError) return NextResponse.json({ error: error.message }, { status: 502 });
    console.error('[replace] failed', error);
    return NextResponse.json({ error: 'Could not save that list' }, { status: 500 });
  }
}
