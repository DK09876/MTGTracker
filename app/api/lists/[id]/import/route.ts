/**
 * A decklist into an existing list or deck.
 *
 *   POST {decklist}   add these cards to what is there
 *   PUT  {decklist}   make the list exactly this - "Edit as text", saved.
 *                     Refused with 422, changing nothing, if any line
 *                     cannot be found. With {preview: true} nothing is
 *                     saved: the answer says what would change.
 *
 * Both are recorded in the deck's history, and over a deck that already
 * has cards a snapshot is taken first.
 */

import { NextResponse } from 'next/server';

import { cardsInList, getList } from '@/lib/db';
import { deckText, DeckLinkError } from '@/lib/deck-links';
import { batchOf, countLine, recorded, takeSnapshot } from '@/lib/deck-history';
import { importInto, previewReplace, replaceWith } from '@/lib/import-into';
import { requireList } from '@/lib/profile-route';
import { warmRoles } from '@/lib/role-warmup';
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
    const { text } = await deckText(body.decklist);
    if (cardsInList(id).length) takeSnapshot(id, 'Before an import', { profile: owned.profile }, true);
    const { result: imported } = await recorded(id, { profile: owned.profile, batch: batchOf(request) }, 'import', 'Imported a list', () => importInto(owned.list, text, owned.profile));
    warmRoles(owned.list, owned.profile);
    return NextResponse.json({ list: getList(id, owned.profile), imported });
  } catch (error) {
    if (error instanceof DeckLinkError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof ScryfallError) return NextResponse.json({ error: error.message }, { status: 502 });
    console.error('[import] failed', error);
    return NextResponse.json({ error: 'Could not import that list' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  let body: { decklist?: string; preview?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  try {
    const { text } = await deckText(body.decklist ?? '');
    if (body.preview) {
      const preview = await previewReplace(owned.list, text);
      return NextResponse.json({ preview: { ...preview, summary: countLine(preview.diff) } });
    }
    if (cardsInList(id).length) takeSnapshot(id, 'Before saving the list as text', { profile: owned.profile }, true);
    const { result } = await recorded(id, { profile: owned.profile, batch: batchOf(request) }, 'import', 'Saved the list as text', () => replaceWith(owned.list, text));
    if (!result.applied) {
      return NextResponse.json({ error: 'Some lines could not be found, so nothing was changed', imported: result }, { status: 422 });
    }
    warmRoles(owned.list, owned.profile);
    return NextResponse.json({ list: getList(id, owned.profile), imported: result });
  } catch (error) {
    if (error instanceof DeckLinkError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof ScryfallError) return NextResponse.json({ error: error.message }, { status: 502 });
    console.error('[replace] failed', error);
    return NextResponse.json({ error: 'Could not save that list' }, { status: 500 });
  }
}
