/**
 * Search from anything typed: Scryfall syntax, a card name, or plain English.
 *
 * /api/search still runs a query exactly as given; this is the front door
 * that decides what the input meant first. See lib/interpret.ts.
 */

import { NextResponse } from 'next/server';

import { listsHolding } from '@/lib/db';
import { geminiTranslator } from '@/lib/gemini';
import { interpret } from '@/lib/interpret';
import { findCardNamed, searchCards, ScryfallError } from '@/lib/scryfall';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q') ?? '';

  try {
    const result = await interpret(query, {
      search: (q) => searchCards(q),
      findCardNamed,
      translate: geminiTranslator(),
    });
    return NextResponse.json({
      ...result,
      inLists: listsHolding(result.cards.map((c) => c.id)),
    });
  } catch (error) {
    if (error instanceof ScryfallError) {
      // 400 usually means the query syntax is wrong, which is worth showing.
      return NextResponse.json({ error: error.message }, { status: error.status === 400 ? 400 : 502 });
    }
    console.error('[ask] failed', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 502 });
  }
}
