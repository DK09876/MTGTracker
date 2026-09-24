/**
 * Cards within a list: add one (to a board, in a finish), change its
 * quantity, board, printing or finish, or take it out.
 *
 * POST takes a Scryfall id rather than a card body: the client should not be
 * able to decide what a card says. The server fetches it and stores the whole
 * payload, so a list keeps working - art, text, prices - with Scryfall
 * unreachable.
 */

import { NextResponse } from 'next/server';

import { addCardToList, removeCardFromList, setQuantity, updateListCard } from '@/lib/db';
import type { Board } from '@/lib/decklist';
import { requireList } from '@/lib/profile-route';
import { getCard, ScryfallError, type Finish } from '@/lib/scryfall';

const BOARDS = new Set<Board>(['main', 'side', 'maybe']);
const FINISHES = new Set<Finish>(['nonfoil', 'foil', 'etched']);
const boardOf = (v: unknown) => (BOARDS.has(v as Board) ? (v as Board) : undefined);
const finishOf = (v: unknown) => (FINISHES.has(v as Finish) ? (v as Finish) : undefined);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: listId } = await params;
  const owned = requireList(request, listId);
  if (owned instanceof NextResponse) return owned;
  let body: { cardId?: string; quantity?: number; board?: string; finish?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!body.cardId) return NextResponse.json({ error: 'cardId required' }, { status: 400 });

  try {
    const card = await getCard(body.cardId);
    addCardToList(listId, card, Math.max(1, Math.trunc(body.quantity ?? 1)), finishOf(body.finish), boardOf(body.board));
    return NextResponse.json({ ok: true, card });
  } catch (error) {
    if (error instanceof ScryfallError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    console.error('[cards] add failed', error);
    return NextResponse.json({ error: 'Could not add that card' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: listId } = await params;
  const owned = requireList(request, listId);
  if (owned instanceof NextResponse) return owned;
  let body: { cardId?: string; quantity?: number; board?: string; finish?: string; printingId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!body.cardId) return NextResponse.json({ error: 'cardId required' }, { status: 400 });
  try {
    if (typeof body.quantity === 'number') setQuantity(listId, body.cardId, Math.trunc(body.quantity));
    const board = boardOf(body.board);
    const finish = finishOf(body.finish);
    // A new printing comes from Scryfall by id, like any card added.
    const printing = body.printingId ? await getCard(body.printingId) : undefined;
    if (board || finish || printing) {
      if (!updateListCard(listId, body.cardId, { board, finish, printing })) {
        return NextResponse.json({ error: 'That card is not in this list' }, { status: 404 });
      }
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ScryfallError) return NextResponse.json({ error: error.message }, { status: 502 });
    console.error('[cards] quantity failed', error);
    return NextResponse.json({ error: 'Could not update that card' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: listId } = await params;
  const owned = requireList(request, listId);
  if (owned instanceof NextResponse) return owned;
  const cardId = new URL(request.url).searchParams.get('cardId');
  if (!cardId) return NextResponse.json({ error: 'cardId required' }, { status: 400 });
  try {
    removeCardFromList(listId, cardId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[cards] remove failed', error);
    return NextResponse.json({ error: 'Could not remove that card' }, { status: 500 });
  }
}
