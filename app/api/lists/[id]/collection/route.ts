/**
 * A deck and the collection: where each card it wants is, and moving copies.
 *
 *   GET   ownership, and the fetch and buy lists
 *   POST  {action: 'pull', key, quantity?, from?: {cardId, finish, location}}
 *         {action: 'pullAll'}
 *         {action: 'take', fromListId, key, quantity?}
 *         {action: 'return', key?, quantity?, to?}      key omitted: everything
 *         {action: 'proxies', cardId, proxies}
 */

import { NextResponse } from 'next/server';

import { fetchList, giveBack, ownership, pull, pullAll, setProxies, takeFromDeck } from '@/lib/collection';
import { getList } from '@/lib/db';
import { requireList } from '@/lib/profile-route';
import type { Finish } from '@/lib/scryfall';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function state(listId: string) {
  const o = ownership({ id: listId });
  return { ...o, ...fetchList(o) };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  return NextResponse.json(state(id));
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  if (owned.list.kind !== 'deck') return NextResponse.json({ error: 'Only decks take cards from the collection' }, { status: 400 });
  const b = await request.json().catch(() => ({})) as Record<string, unknown>;
  const key = typeof b.key === 'string' ? b.key : null;
  const quantity = typeof b.quantity === 'number' && b.quantity > 0 ? Math.trunc(b.quantity) : undefined;
  let moved = 0;
  switch (b.action) {
    case 'pull': {
      if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 });
      const from = b.from as { cardId?: unknown; finish?: unknown; location?: unknown } | undefined;
      moved = pull(id, key, quantity, from && typeof from.cardId === 'string'
        ? { cardId: from.cardId, finish: (from.finish as Finish) ?? 'nonfoil', location: typeof from.location === 'string' ? from.location : '' }
        : undefined);
      break;
    }
    case 'pullAll':
      moved = pullAll(id);
      break;
    case 'take': {
      const fromListId = typeof b.fromListId === 'string' ? b.fromListId : '';
      if (!key || !getList(fromListId, owned.profile)) return NextResponse.json({ error: 'key and one of your decks required' }, { status: 400 });
      moved = takeFromDeck(id, fromListId, key, quantity);
      break;
    }
    case 'return':
      moved = giveBack(id, key, quantity, typeof b.to === 'string' ? b.to.trim().slice(0, 60) : undefined);
      break;
    case 'proxies':
      if (typeof b.cardId !== 'string') return NextResponse.json({ error: 'cardId required' }, { status: 400 });
      setProxies(id, b.cardId, Math.max(0, Math.trunc(Number(b.proxies) || 0)));
      break;
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
  return NextResponse.json({ ...state(id), moved });
}
