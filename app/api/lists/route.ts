/**
 * One profile's lists and decks: read them, or make one. `?profile=` required.
 *
 *   GET  ?kind=deck|list
 *   POST {name, kind?, commanderId?, decklist?, linked?}
 *
 * A deck can be made from a pasted decklist in one go; the answer then says
 * what was imported and which lines could not be found. `linked` is Mythic
 * Tools' collection-linked list: the deck then holds the copies it names.
 */

import { NextResponse } from 'next/server';

import { localCardsByOracle } from '@/lib/card-store';

import { createList, getList, listLists, renameList, type ListKind } from '@/lib/db';
import { deckText, DeckLinkError } from '@/lib/deck-links';
import { importInto } from '@/lib/import-into';
import { linkMythic, markListProxies, mythicDeckText } from '@/lib/mythic';
import { requireProfile } from '@/lib/profile-route';
import { startJob } from '@/lib/jobs';
import { warmRoles } from '@/lib/role-warmup';
import { starterList } from '@/lib/starter';
import { getCard, ScryfallError } from '@/lib/scryfall';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const kindOf = (value: unknown): ListKind | undefined => (value === 'deck' || value === 'list' ? value : undefined);

export async function GET(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  try {
    const kind = kindOf(new URL(request.url).searchParams.get('kind'));
    return NextResponse.json({ lists: listLists(who.profile, kind) });
  } catch (error) {
    console.error('[lists] read failed', error);
    return NextResponse.json({ error: 'Could not read your lists' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  let body: { name?: string; note?: string; kind?: string; commanderId?: string; commanderOracleId?: string; decklist?: string; linked?: string; starter?: boolean; ownedFirst?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const kind = kindOf(body.kind) ?? 'list';
  // A link in the deck box brings the deck - and its name - from Archidekt.
  let linked: Awaited<ReturnType<typeof deckText>> | null = null;
  try {
    if (body.decklist?.trim()) linked = await deckText(body.decklist);
  } catch (error) {
    if (error instanceof DeckLinkError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
  // A pasted deck with no name takes its commander's once read; 'New deck' until then.
  const unnamed = !(body.name ?? '').trim() && !linked?.name && kind === 'deck' && !!linked?.text.trim();
  const name = (body.name ?? '').trim() || linked?.name || (unnamed ? 'New deck' : '');
  if (!name) return NextResponse.json({ error: 'A list needs a name' }, { status: 400 });

  try {
    // The client names the commander by id. The Pi's copy of Scryfall's cards
    // has it at once; Scryfall is asked only for a card the copy lacks.
    const local = kind === 'deck' && body.commanderOracleId ? localCardsByOracle([body.commanderOracleId]).find((c) => c.id === body.commanderId || !body.commanderId) : undefined;
    const commander = kind === 'deck' && body.commanderId ? local ?? await getCard(body.commanderId) : null;
    const list = createList(who.profile, name, (body.note ?? '').trim(), { kind, commander });
    const mythic = kind === 'deck' && typeof body.linked === 'string' && body.linked.trim() ? body.linked : '';
    const pasted = linked?.text.trim() ? linked.text : '';
    const imported = pasted ? await importInto(list, mythic ? mythicDeckText(pasted, mythic) : pasted, who.profile) : undefined;
    const link = imported && mythic ? linkMythic(list.id, who.profile, pasted, mythic) : null;
    if (imported && !mythic) markListProxies(list.id, pasted);
    if (imported) warmRoles(list, who.profile);
    if (unnamed && imported?.commander) renameList(list.id, imported.commander);
    // A starter list, built in the background: the deck opens at once and fills in.
    if (!imported && body.starter && commander) {
      const profile = who.profile;
      startJob({ kind: 'starter', label: 'Building a starter list', subject: list.name, profileId: profile, listId: list.id }, async ({ progress }) => {
        progress('Picking cards for each role, then the ones that fit the commander');
        const starter = starterList(commander, profile, body.ownedFirst !== false);
        progress('Adding the cards');
        await importInto(list, starter.lines.join('\n'), profile);
        warmRoles(list, profile);
        return { spells: starter.spells, lands: starter.lands };
      });
    }
    return NextResponse.json({ list: getList(list.id, who.profile), imported, link });
  } catch (error) {
    if (error instanceof ScryfallError) return NextResponse.json({ error: error.message }, { status: 502 });
    console.error('[lists] create failed', error);
    return NextResponse.json({ error: 'Could not create that list' }, { status: 500 });
  }
}
