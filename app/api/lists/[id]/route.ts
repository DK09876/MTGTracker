/**
 * One list or deck: its cards, a rename or new commander, or its removal.
 * Only the profile that owns it can see it.
 */

import { NextResponse } from 'next/server';

import { cardsInList, deleteList, getList, promoteToCommander, renameList, setCommander, slotQuestions } from '@/lib/db';
import { planConfirmed, planProgress } from '@/lib/deck-plan';
import { requireList } from '@/lib/profile-route';
import { isPublic, setPublic } from '@/lib/profile-style';
import { getCard, ScryfallError } from '@/lib/scryfall';
import { sectionsOf } from '@/lib/sections';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const owned = requireList(request, id);
    if (owned instanceof NextResponse) return owned;
    const deck = owned.list.kind === 'deck';
    return NextResponse.json({
      list: owned.list, cards: cardsInList(id), public: isPublic(id), planConfirmed: planConfirmed(id), planProgress: deck ? planProgress(id) : null,
      // A deck's sections beyond Main, and what to ask about its second commander or companion.
      sections: deck ? sectionsOf(id) : [], slotQuestions: deck ? slotQuestions(id) : [],
    });
  } catch (error) {
    console.error('[list] read failed', error);
    return NextResponse.json({ error: 'Could not read that list' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  let body: { name?: string; note?: string; commanderId?: string | null; fromList?: boolean; public?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const name = body.name === undefined ? undefined : body.name.trim();
  if (name === '') return NextResponse.json({ error: 'A list needs a name' }, { status: 400 });

  try {
    if (name !== undefined) renameList(id, name, body.note);
    // Shown to other people on the owner's profile, or not (the default).
    if (typeof body.public === 'boolean') setPublic(id, body.public);
    // A deck's commander, by Scryfall id; null clears it. `fromList` takes
    // a card already in the deck, moving it out of the 99.
    if (body.commanderId && body.fromList) {
      if (!promoteToCommander(id, body.commanderId)) {
        return NextResponse.json({ error: 'That card is not in this deck' }, { status: 400 });
      }
    } else if (body.commanderId !== undefined) {
      setCommander(id, body.commanderId ? await getCard(body.commanderId) : null);
    }
    return NextResponse.json({ list: getList(id, owned.profile), public: isPublic(id) });
  } catch (error) {
    if (error instanceof ScryfallError) return NextResponse.json({ error: error.message }, { status: 502 });
    console.error('[list] rename failed', error);
    return NextResponse.json({ error: 'Could not rename that list' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  try {
    deleteList(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[list] delete failed', error);
    return NextResponse.json({ error: 'Could not delete that list' }, { status: 500 });
  }
}
