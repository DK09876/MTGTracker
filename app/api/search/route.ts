/**
 * Card search, proxied through the server.
 *
 * Going through here rather than calling Scryfall from the browser keeps the
 * rate limiting and the User-Agent in one place - a browser cannot set a
 * User-Agent, and Scryfall refuse requests without one - and lets a result
 * say which of your lists already hold each card.
 */

import { NextResponse } from 'next/server';

import { listsHolding } from '@/lib/db';
import { searchCards, ScryfallError } from '@/lib/scryfall';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = params.get('q') ?? '';
  const page = Number(params.get('page') ?? '1') || 1;

  if (!query.trim()) {
    return NextResponse.json({ cards: [], totalCards: 0, hasMore: false, inLists: {} });
  }

  try {
    const result = await searchCards(query, page);
    return NextResponse.json({
      ...result,
      inLists: listsHolding(result.cards.map((c) => c.id)),
    });
  } catch (error) {
    if (error instanceof ScryfallError) {
      // 400 usually means the query syntax is wrong, which is worth showing.
      return NextResponse.json({ error: error.message }, { status: error.status === 400 ? 400 : 502 });
    }
    console.error('[search] failed', error);
    return NextResponse.json({ error: 'Could not reach Scryfall' }, { status: 502 });
  }
}
