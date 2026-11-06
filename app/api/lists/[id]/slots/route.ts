/**
 * A deck's second commander and companion (commanders.ts).
 *
 * POST {cardId, slot: 'partner' | 'companion' | null} makes a card in the
 * deck one of them, or neither. POST {dismiss: 'partner' | 'companion'}
 * answers an import's question with "neither". Either way that question is
 * settled. The answer is the deck's cards and what is left to ask.
 */

import { NextResponse } from 'next/server';

import { canPair, isCompanion, type Slot } from '@/lib/commanders';
import { cardsInList, setSlot, setSlotQuestions, slotQuestions } from '@/lib/db';
import { requireList } from '@/lib/profile-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isSlot = (v: unknown): v is Slot => v === 'partner' || v === 'companion';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  let b: { cardId?: string; slot?: unknown; dismiss?: unknown };
  try { b = await request.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const settle = (kind: Slot) => setSlotQuestions(id, slotQuestions(id).filter((q) => q.kind !== kind));

  if (isSlot(b.dismiss)) {
    settle(b.dismiss);
  } else if (typeof b.cardId === 'string' && (b.slot === null || isSlot(b.slot))) {
    const entry = cardsInList(id).find((c) => c.card.id === b.cardId);
    if (!entry) return NextResponse.json({ error: 'That card is not in this deck' }, { status: 404 });
    const commander = owned.list.commander;
    if (b.slot === 'partner' && !(commander && canPair(commander, entry.card))) {
      return NextResponse.json({ error: `${entry.card.name} can't lead the deck beside ${commander?.name ?? 'no commander'}` }, { status: 400 });
    }
    if (b.slot === 'companion' && !isCompanion(entry.card)) {
      return NextResponse.json({ error: `${entry.card.name} isn't a companion` }, { status: 400 });
    }
    setSlot(id, b.cardId, b.slot);
    settle(b.slot ?? entry.slot ?? 'partner');
  } else {
    return NextResponse.json({ error: 'cardId and slot, or dismiss, required' }, { status: 400 });
  }
  return NextResponse.json({ cards: cardsInList(id), questions: slotQuestions(id) });
}
