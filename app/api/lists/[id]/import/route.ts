/** Paste a decklist into an existing list or deck. */

import { NextResponse } from 'next/server';

import { getList } from '@/lib/db';
import { importInto } from '@/lib/import-into';
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
