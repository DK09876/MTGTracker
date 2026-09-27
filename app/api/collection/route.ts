/**
 * The profile's collection.
 *
 *   GET                                               copies in boxes, copies decks hold, boxes, totals
 *   POST  {cardId, quantity?, finish?, location?}      add copies (the id is a Scryfall printing)
 *   PATCH {cardId, finish, location, quantity}          set how many are in that box (0 removes)
 *   PATCH {cardId, finish, location, move: {location?, finish?, quantity}}   move or relabel copies
 */

import { NextResponse } from 'next/server';

import { addToCollection, collectionState, moveCopies, setCollectionCount } from '@/lib/collection';
import { requireProfile } from '@/lib/profile-route';
import { getCard, ScryfallError, type Finish } from '@/lib/scryfall';
import { slimCard } from '@/lib/slim';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FINISHES = new Set<Finish>(['nonfoil', 'foil', 'etched']);
const finishOf = (v: unknown): Finish => (FINISHES.has(v as Finish) ? (v as Finish) : 'nonfoil');
const locationOf = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 60) : '');

export async function GET(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  return NextResponse.json(collectionState(who.profile));
}

async function body(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await request.json();
    return b && typeof b === 'object' ? b as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  const b = await body(request);
  if (!b || typeof b.cardId !== 'string') return NextResponse.json({ error: 'cardId required' }, { status: 400 });
  const quantity = Math.max(1, Math.min(999, Math.trunc(Number(b.quantity) || 1)));
  try {
    const card = await getCard(b.cardId);
    const count = addToCollection(who.profile, card, quantity, finishOf(b.finish), locationOf(b.location));
    return NextResponse.json({ ok: true, count, card: slimCard(card) });
  } catch (error) {
    if (error instanceof ScryfallError) return NextResponse.json({ error: error.message }, { status: 502 });
    console.error('[collection] add failed', error);
    return NextResponse.json({ error: 'Could not add that card' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  const b = await body(request);
  if (!b || typeof b.cardId !== 'string') return NextResponse.json({ error: 'cardId required' }, { status: 400 });
  const at = { cardId: b.cardId, finish: finishOf(b.finish), location: locationOf(b.location) };
  const move = b.move as Record<string, unknown> | undefined;
  if (move && typeof move === 'object') {
    moveCopies(who.profile, at, {
      location: move.location === undefined ? undefined : locationOf(move.location),
      finish: move.finish === undefined ? undefined : finishOf(move.finish),
    }, Math.max(1, Math.trunc(Number(move.quantity) || 1)));
  } else if (typeof b.quantity === 'number') {
    setCollectionCount(who.profile, at.cardId, at.finish, at.location, Math.max(0, Math.trunc(b.quantity)));
  } else {
    return NextResponse.json({ error: 'quantity or move required' }, { status: 400 });
  }
  return NextResponse.json(collectionState(who.profile));
}
