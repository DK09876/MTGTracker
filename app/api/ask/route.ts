/**
 * Search from anything typed: Scryfall syntax, a card name, or plain English.
 *
 *   GET  ?q=...                    work out what was meant (lib/interpret.ts)
 *   POST {q, previous}             a follow-up, refining the search before it
 *   POST {q, previous?, resume}    carry on after the user picked a commander
 *   GET  ?query=&commander=&sort=  run a query as written, no model - for an
 *                                  edited query, a new sort (&edhrec=0 skips
 *                                  rebuilding the EDHREC tab), or a tab
 *                                  opened later; &page=2 for the next 175
 *   GET  ?combosFor=...            a commander's combos, for the Combos tab
 *
 * /api/search still runs a bare query with nothing else attached.
 */

import { NextResponse } from 'next/server';

import { listsHolding } from '@/lib/db';
import { profileOf } from '@/lib/profile-route';
import { commanderPage, edhrecEnabled } from '@/lib/edhrec';
import { geminiTranslator, type Kind, type Previous, type Translation } from '@/lib/gemini';
import { interpret, runCombos, runQuery, type Deps, type Interpreted, type Resume } from '@/lib/interpret';
import { cardsNamed, findCardNamed, findCommanders, searchCards, ScryfallError } from '@/lib/scryfall';
import { parseSortKey } from '@/lib/sort';
import { searchCombos, SpellbookError } from '@/lib/spellbook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function deps(): Deps {
  return {
    search: (q, sort, page) => searchCards(q, page ?? 1, sort),
    findCardNamed,
    findCommanders,
    cardsNamed,
    searchCombos,
    edhrec: edhrecEnabled() ? commanderPage : null,
    translate: geminiTranslator(),
  };
}

/** Run a search, and mark which of the asking profile's lists already hold each card. */
async function respond(request: Request, work: () => Promise<Interpreted>) {
  try {
    const result = await work();
    const ids = [...result.cards, ...(result.edhrec?.cards ?? [])].map((c) => c.id);
    return NextResponse.json({ ...result, inLists: listsHolding([...new Set(ids)], profileOf(request)) });
  } catch (error) {
    if (error instanceof ScryfallError || error instanceof SpellbookError) {
      // 400 usually means the query syntax is wrong, which is worth showing.
      return NextResponse.json({ error: error.message }, { status: error.status === 400 ? 400 : 502 });
    }
    console.error('[ask] failed', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 502 });
  }
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const combosFor = params.get('combosFor');
  if (combosFor) return respond(request, () => runCombos(combosFor, deps()));

  const query = params.get('query');
  if (query !== null) {
    return respond(request, () => runQuery(query, params.get('commander') || null, deps(), parseSortKey(params.get('sort')), {
      withEdhrec: params.get('edhrec') !== '0',
      page: Math.max(1, Number(params.get('page')) || 1),
    }));
  }

  return respond(request, () => interpret(params.get('q') ?? '', deps()));
}

const KINDS = new Set<Kind>(['cards', 'card', 'combos']);
const text = (s: unknown) => (typeof s === 'string' ? s : undefined);

/** A plan sent back by the page, taken no further than its shape. */
function resumeOf(raw: unknown): Resume | undefined {
  const r = raw as { plan?: Partial<Translation>; commander?: unknown } | undefined;
  const p = r?.plan;
  const commander = text(r?.commander);
  if (!p || !commander || !KINDS.has(p.kind as Kind)) return undefined;
  return {
    commander,
    plan: {
      kind: p.kind as Kind,
      cardName: text(p.cardName) ?? null,
      commander: text(p.commander) ?? null,
      query: text(p.query) ?? '',
      constraints: text(p.constraints) ?? null,
      explanation: text(p.explanation) ?? '',
    },
  };
}

export async function POST(request: Request) {
  let body: { q?: unknown; previous?: Partial<Previous>; resume?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const p = body.previous ?? {};
  const kind = p.kind === 'card' || p.kind === 'combos' ? p.kind : 'cards';
  const previous: Previous | undefined = text(p.request)
    ? {
      request: text(p.request)!, kind, commander: text(p.commander), cardName: text(p.cardName),
      query: text(p.query) ?? '', constraints: text(p.constraints),
    }
    : undefined;
  return respond(request, () => interpret(text(body.q) ?? '', deps(), previous, resumeOf(body.resume)));
}
