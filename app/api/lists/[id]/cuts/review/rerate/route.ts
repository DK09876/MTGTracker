/**
 * POST {name, tier?, reason}: the owner disagrees with how the last review
 * rated a card. Claude re-rates that one card with their reason (a small
 * request); the review keeps the new tier and the dispute. A card that ends
 * up S or A is starred to keep, so the cut list stops offering it.
 */

import { NextResponse } from 'next/server';

import { appModel, ModelError } from '@/lib/ai';
import { lastReview, rerateCard, saveReview, TIERS, verdictOfTier, type Tier } from '@/lib/cut-review';
import { cardsInList, deckTags } from '@/lib/db';
import { planStyles } from '@/lib/deck-plan';
import { setKeep } from '@/lib/deck-roles';
import { requireList, requirePlan } from '@/lib/profile-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const locked = requirePlan(id);
  if (locked) return locked;
  const { list, profile } = owned;
  const body = await request.json().catch(() => ({})) as { name?: unknown; tier?: unknown; reason?: unknown };
  const name = typeof body.name === 'string' ? body.name : '';
  const wantTier = TIERS.includes(body.tier as Tier) ? body.tier as Tier : null;
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 1000) : '';
  const review = lastReview(id);
  const entry = cardsInList(id).find((c) => c.card.name === name);
  if (!review || !entry) return NextResponse.json({ error: 'That card is not in the last review or the deck' }, { status: 404 });
  const model = appModel(profile, 'tagging', list.name);
  if (!model) return NextResponse.json({ error: 'No model API key is set on the server' }, { status: 503 });

  const was = review.items.find((i) => i.name === name) ?? null;
  const main = cardsInList(id).filter((c) => (c.board ?? 'main') === 'main');
  try {
    const found = await rerateCard(model, {
      commander: list.commander,
      brief: deckTags(id).brief,
      styles: planStyles(id, list.commander, main).map((s) => s.label),
      card: entry.card,
      was,
      wantTier,
      reason,
    });
    const item = { name, verdict: verdictOfTier(found.tier), why: found.why, tier: found.tier, disputed: { from: was?.tier ?? null, reason } };
    saveReview(id, { ...review, items: was ? review.items.map((i) => (i.name === name ? item : i)) : [...review.items, item] });
    const key = found.tier === 'S' || found.tier === 'A';
    if (key) setKeep(id, entry.card.oracle_id ?? entry.card.id, true);
    return NextResponse.json({ item, kept: key });
  } catch (error) {
    if (error instanceof ModelError) return NextResponse.json({ error: error.message }, { status: 502 });
    throw error;
  }
}
