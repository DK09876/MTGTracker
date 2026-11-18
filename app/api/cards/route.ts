/**
 * Cards by name or id, through the app's one way of getting a card (lib/cards.ts): what the app holds first, then
 * Scryfall for a card it hasn't seen (stored, so the weekly refresh keeps it fresh).
 *
 *   GET ?name=<name>&name=<name>…   up to 60 names: { cards, missing }
 *   GET ?id=<scryfall id>           one card: { card } or 404
 */

import { NextResponse } from 'next/server';

import { cardById, findCards } from '@/lib/cards';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const id = q.get('id');
  if (id) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Not a card id' }, { status: 400 });
    const card = await cardById(id).catch(() => null);
    return card ? NextResponse.json({ card }) : NextResponse.json({ error: 'No such card' }, { status: 404 });
  }
  const names = [...new Set(q.getAll('name').map((n) => n.trim().slice(0, 150)).filter(Boolean))].slice(0, 60);
  if (!names.length) return NextResponse.json({ error: 'Give a name or an id' }, { status: 400 });
  const found = await findCards(names);
  return NextResponse.json({ cards: names.map((n) => found.get(n)).filter((c, i, a) => c && a.indexOf(c) === i), missing: names.filter((n) => !found.get(n)) });
}
