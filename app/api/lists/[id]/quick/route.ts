/**
 * Card names for adding by name, as you type: from the Pi's card copy, in
 * the deck's colours, with where each card already sits in the deck.
 */

import { NextResponse } from 'next/server';

import { quickCards } from '@/lib/card-store';
import { cardsInList } from '@/lib/db';
import { requireList } from '@/lib/profile-route';
import { imageOf, manaCostOf, typeLineOf } from '@/lib/scryfall';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const front = (name: string) => name.split(' // ')[0];

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const q = new URL(request.url).searchParams.get('q') ?? '';
  const list = owned.list;
  const cards = cardsInList(id);
  // A deck plays inside its commanders' colours; a plain list takes anything.
  const partner = cards.find((c) => c.slot === 'partner')?.card;
  const colors = list.kind === 'deck' && list.commander
    ? [...new Set([...(list.commander.color_identity ?? []), ...(partner?.color_identity ?? [])])]
    : null;
  const where = new Map(cards.map((c) => [front(c.card.name), c.board]));
  // A card already in the deck is added as the printing it already has, so it counts up rather than making a second row.
  const printing = new Map(cards.map((c) => [front(c.card.name), c.card.id]));
  if (list.commander) where.set(front(list.commander.name), 'commander' as never);
  const hits = quickCards(q, colors, 8).map((c) => ({
    id: printing.get(front(c.name)) ?? c.id, oracleId: c.oracle_id ?? c.id, name: c.name, cost: manaCostOf(c), type: typeLineOf(c), image: imageOf(c, 'small'),
    gameChanger: c.game_changer === true, inDeck: where.get(front(c.name)) ?? null,
  }));
  return NextResponse.json({ q, cards: hits });
}
