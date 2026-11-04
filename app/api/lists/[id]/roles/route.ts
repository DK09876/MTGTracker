/**
 * One card's roles in a deck. GET ?card=<oracle id>: every role, whether the
 * card fills it, and whether that is Scryfall's word or the owner's.
 * PUT {oracleId, role, has}: correct it for this deck; has null goes back to
 * what Scryfall says.
 */

import { NextResponse } from 'next/server';

import { cachedRoles, cardsInList, saveRoles, type List } from '@/lib/db';
import { overrides, setOverride } from '@/lib/deck-roles';
import { requireList } from '@/lib/profile-route';
import { countRoles, ROLE_GROUPS, ROLES } from '@/lib/roles';
import { searchCards } from '@/lib/scryfall';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function cardRoles(list: List, oracleId: string) {
  const listId = list.id;
  // The commander is in the deck too, though not among its listed cards.
  const commander = list.commander && (list.commander.oracle_id ?? list.commander.id) === oracleId ? { card: list.commander, quantity: 1 } : null;
  const card = commander ?? cardsInList(listId).find((c) => (c.card.oracle_id ?? c.card.id) === oracleId);
  if (!card) return null;
  const found = await countRoles([card], { search: (q) => searchCards(q), cached: cachedRoles, save: saveRoles });
  const mine = overrides(listId).filter((o) => o.oracleId === oracleId);
  return ROLES.map((r) => {
    const scryfall = found.find((f) => f.id === r.id)!.count > 0;
    const own = mine.find((o) => o.role === r.id);
    return { id: r.id, label: r.label, group: ROLE_GROUPS[r.group], scryfall, has: own ? own.has : scryfall, corrected: !!own };
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const roles = await cardRoles(owned.list, new URL(request.url).searchParams.get('card') ?? '');
  return roles ? NextResponse.json({ roles }) : NextResponse.json({ error: 'That card is not in this deck' }, { status: 404 });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const b = await request.json().catch(() => ({})) as { oracleId?: string; role?: string; has?: boolean | null };
  if (!b.oracleId || !b.role || !ROLES.some((r) => r.id === b.role)) return NextResponse.json({ error: 'Say which card and role' }, { status: 400 });
  setOverride(id, b.oracleId, b.role, typeof b.has === 'boolean' ? b.has : null);
  const roles = await cardRoles(owned.list, b.oracleId);
  return roles ? NextResponse.json({ roles }) : NextResponse.json({ error: 'That card is not in this deck' }, { status: 404 });
}
