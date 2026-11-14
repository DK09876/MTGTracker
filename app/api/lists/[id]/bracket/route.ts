/**
 * POST {name, aside}: set a flagged card aside on this deck's bracket box ("Doesn't count in this deck"), or put
 * it back (Part D 17). The bracket floor, the Plan's bracket read and what Claude is told leave it out.
 */

import { NextResponse } from 'next/server';

import { setAside } from '@/lib/bracket-aside';
import { cardsInList } from '@/lib/db';
import { requireList } from '@/lib/profile-route';
import { estimateBracket } from '@/lib/spellbook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const b = await request.json().catch(() => ({})) as { name?: unknown; aside?: unknown };
  if (typeof b.name !== 'string' || !b.name.trim()) return NextResponse.json({ error: 'Which card?' }, { status: 400 });
  const front = (n: string) => n.split(' // ')[0].trim().toLowerCase();
  // Setting aside takes only a card in the deck that the bracket flags (round 2, item 15); putting back takes any.
  if (b.aside !== false) {
    const main = cardsInList(id).filter((c) => c.board === 'main');
    const inDeck = [...main.map((c) => c.card.name), ...(owned.list.commander ? [owned.list.commander.name] : [])];
    if (!inDeck.some((n) => front(n) === front(b.name as string))) return NextResponse.json({ error: `${b.name} isn't in this deck` }, { status: 400 });
    const report = await estimateBracket({ commanders: owned.list.commander ? [owned.list.commander.name] : [], main: main.map((c) => ({ name: c.card.name, quantity: c.quantity })) }).catch(() => null);
    const flagged = report?.cards.find((c) => front(c.name) === front(b.name as string));
    if (report && !(flagged?.massLandDenial || flagged?.extraTurn)) return NextResponse.json({ error: `${b.name} isn't flagged as land denial or extra turns` }, { status: 400 });
  }
  setAside(id, b.name, b.aside !== false);
  return NextResponse.json({ ok: true });
}
