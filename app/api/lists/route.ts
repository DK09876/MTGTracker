/**
 * One profile's lists and decks: read them, or make one. `?profile=` required.
 *
 *   GET  ?kind=deck|list
 *   POST {name, kind?, commanderId?, decklist?}
 *
 * A deck can be made from a pasted decklist in one go; the answer then says
 * what was imported and which lines could not be found.
 */

import { NextResponse } from 'next/server';

import { createList, getList, listLists, type ListKind } from '@/lib/db';
import { importInto } from '@/lib/import-into';
import { requireProfile } from '@/lib/profile-route';
import { getCard, ScryfallError } from '@/lib/scryfall';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const kindOf = (value: unknown): ListKind | undefined => (value === 'deck' || value === 'list' ? value : undefined);

export async function GET(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  try {
    const kind = kindOf(new URL(request.url).searchParams.get('kind'));
    return NextResponse.json({ lists: listLists(who.profile, kind) });
  } catch (error) {
    console.error('[lists] read failed', error);
    return NextResponse.json({ error: 'Could not read your lists' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  let body: { name?: string; note?: string; kind?: string; commanderId?: string; decklist?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const name = (body.name ?? '').trim();
  if (!name) return NextResponse.json({ error: 'A list needs a name' }, { status: 400 });
  const kind = kindOf(body.kind) ?? 'list';

  try {
    // The client names the commander by id; the card itself comes from Scryfall.
    const commander = kind === 'deck' && body.commanderId ? await getCard(body.commanderId) : null;
    const list = createList(who.profile, name, (body.note ?? '').trim(), { kind, commander });
    const imported = body.decklist?.trim() ? await importInto(list, body.decklist) : undefined;
    return NextResponse.json({ list: getList(list.id, who.profile), imported });
  } catch (error) {
    if (error instanceof ScryfallError) return NextResponse.json({ error: error.message }, { status: 502 });
    console.error('[lists] create failed', error);
    return NextResponse.json({ error: 'Could not create that list' }, { status: 500 });
  }
}
