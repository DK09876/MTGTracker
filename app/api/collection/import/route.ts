/**
 * Import a collection: a CSV from Mythic Tools, ManaBox, Moxfield, Deckbox
 * or TCGplayer, or a plain list. Cards without a box column go into
 * `location`.
 *
 *   POST {text, location?, preview: true}            what the file holds, nothing written
 *   POST {text, location?, mode?: 'add'|'replace', again?}
 *        add (the default) puts the copies on top of what is there; adding a
 *        file imported before is refused with 409 unless `again`. replace
 *        makes the collection exactly the file.
 */

import { NextResponse } from 'next/server';

import { AlreadyImported, previewRows, runCollectionImport } from '@/lib/collection-import-run';
import { requireProfile } from '@/lib/profile-route';
import { collection, ScryfallError } from '@/lib/scryfall';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A few thousand rows is a big collection; far beyond is a mistake.
const MAX_TEXT = 3_000_000;

export async function POST(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  let b: { text?: unknown; location?: unknown; preview?: unknown; mode?: unknown; again?: unknown };
  try {
    b = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const text = typeof b.text === 'string' ? b.text : '';
  if (!text.trim()) return NextResponse.json({ error: 'Nothing to import' }, { status: 400 });
  if (text.length > MAX_TEXT) return NextResponse.json({ error: 'That file is too big to import in one go' }, { status: 413 });
  const location = typeof b.location === 'string' ? b.location.trim().slice(0, 60) : '';

  if (b.preview === true) {
    return NextResponse.json(previewRows(who.profile, text, location));
  }
  try {
    const result = await runCollectionImport(who.profile, text, {
      location, mode: b.mode === 'replace' ? 'replace' : 'add', again: b.again === true, lookup: collection,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AlreadyImported) return NextResponse.json({ error: error.message, before: error.before }, { status: 409 });
    if (error instanceof ScryfallError) return NextResponse.json({ error: error.message }, { status: 502 });
    console.error('[collection] import failed', error);
    return NextResponse.json({ error: 'Could not import that' }, { status: 500 });
  }
}
