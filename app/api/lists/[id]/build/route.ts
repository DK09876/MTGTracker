/**
 * GET: the deck's Build page - commander style, the issues worth fixing,
 * every role, Karsten's land count and colour sources - from the cards, no
 * model.
 */

import { deckRoles } from '@/lib/deck-roles';
import { NextResponse } from 'next/server';

import { buildPlan } from '@/lib/build';
import { cardsInList, deckTags } from '@/lib/db';
import { analyse } from '@/lib/health';
import { requireList } from '@/lib/profile-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const { list } = owned;
  const main = cardsInList(id).filter((c) => c.board === 'main');
  const health = analyse({ commander: list.commander, cards: main });
  const roles = await deckRoles(id, main).catch(() => null);
  // Cards the owner tagged as a win condition count as finishers.
  const tags = deckTags(id);
  const winTags = new Set(tags.tags.filter((t) => t.kind === 'wincon').map((t) => t.id));
  const winKeys = new Set(tags.cardTags.filter((t) => t.on && winTags.has(t.tagId)).map((t) => t.key));
  const pool = list.commander ? [{ card: list.commander }, ...main] : main;
  const wincons = pool.filter((c) => winKeys.has(c.card.oracle_id ?? c.card.id)).map((c) => c.card.name);
  return NextResponse.json(buildPlan({
    commander: list.commander,
    cards: main,
    roles,
    lands: health.lands,
    averageMv: health.averageMv,
    size: health.size,
    colors: health.colors.map((c) => ({ color: c.color, sources: c.sources, needed: c.needed, neededFor: c.neededFor })),
    brief: tags.brief,
    wincons,
  }));
}
