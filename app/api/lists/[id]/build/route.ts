/**
 * GET: the deck's Build checklist - commander style, plan, role gaps,
 * Karsten's land count and size - from the cards, no model.
 */

import { deckRoles } from '@/lib/deck-roles';
import { NextResponse } from 'next/server';

import { buildPlan } from '@/lib/build';
import { cardsInList, deckTags } from '@/lib/db';
import { analyse } from '@/lib/health';
import { requireList } from '@/lib/profile-route';
import { readsFor } from '@/lib/reads';

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
  return NextResponse.json(buildPlan({
    commander: list.commander,
    cards: main,
    roles,
    lands: health.lands,
    averageMv: health.averageMv,
    size: health.size,
    colors: health.colors.map((c) => ({ color: c.color, sources: c.sources, needed: c.needed, neededFor: c.neededFor })),
    brief: deckTags(id).brief,
    savedReads: readsFor(id).saved.length,
  }));
}
