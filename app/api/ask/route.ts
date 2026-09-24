/**
 * Search from anything typed: Scryfall syntax, a card name, or plain English.
 *
 *   ?q=...                      work out what was meant (lib/interpret.ts)
 *   ?query=...&commander=...    run an edited query as written, no model
 *
 * /api/search still runs a bare query with nothing else attached.
 */

import { NextResponse } from 'next/server';

import { listsHolding } from '@/lib/db';
import { commanderStats, edhrecEnabled } from '@/lib/edhrec';
import { geminiTranslator } from '@/lib/gemini';
import { interpret, runQuery, type Deps } from '@/lib/interpret';
import { cardsNamed, findCardNamed, findCommander, searchCards, ScryfallError } from '@/lib/scryfall';
import { searchCombos, SpellbookError } from '@/lib/spellbook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const deps: Deps = {
    search: (q) => searchCards(q),
    findCardNamed,
    findCommander,
    cardsNamed,
    searchCombos,
    commanderStats: edhrecEnabled() ? commanderStats : null,
    translate: geminiTranslator(),
  };

  try {
    const edited = params.get('query');
    const result = edited !== null
      ? await runQuery(edited, params.get('commander') || null, deps)
      : await interpret(params.get('q') ?? '', deps);
    return NextResponse.json({
      ...result,
      inLists: listsHolding(result.cards.map((c) => c.id)),
    });
  } catch (error) {
    if (error instanceof ScryfallError || error instanceof SpellbookError) {
      // 400 usually means the query syntax is wrong, which is worth showing.
      return NextResponse.json({ error: error.message }, { status: error.status === 400 ? 400 : 502 });
    }
    console.error('[ask] failed', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 502 });
  }
}
