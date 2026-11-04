/**
 * GET: the deck's cut candidates with their reasons (lib/cut-score.ts), the
 * cards the owner's tags protect, and the role counts so the page can show
 * what cutting a few would leave. No model.
 */

import { NextResponse } from 'next/server';

import { karstenLands } from '@/lib/build';
import { cutCandidates } from '@/lib/cut-score';
import { cardsInList, deckTags } from '@/lib/db';
import { deckRoles } from '@/lib/deck-roles';
import { commanderPage, edhrecEnabled } from '@/lib/edhrec';
import { fitProfile } from '@/lib/fit';
import { analyse } from '@/lib/health';
import { requireList } from '@/lib/profile-route';
import { imageOf } from '@/lib/scryfall';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const { list } = owned;
  const main = cardsInList(id).filter((c) => c.board === 'main');
  const health = analyse({ commander: list.commander, cards: main });
  const roles = await deckRoles(id, main);
  const cheap = new Set(roles.filter((r) => ['ramp', 'draw'].includes(r.id)).flatMap((r) => r.cards));
  const want = karstenLands(health.averageMv, main.filter((c) => cheap.has(c.card.name) && (c.card.cmc ?? 0) <= 2).reduce((n, c) => n + c.quantity, 0));
  const page = list.commander && edhrecEnabled() ? await commanderPage(list.commander.name).catch(() => null) : null;
  const { candidates, protectedCards } = cutCandidates({
    cards: main, roles, fit: fitProfile(list.commander), tags: deckTags(id), stats: page?.stats ?? null,
    lands: { have: health.lands, want },
  });
  const byId = new Map(main.map((c) => [c.card.id, c.card]));
  return NextResponse.json({
    size: health.size,
    candidates: candidates.map((c) => ({ ...c, image: byId.get(c.cardId) ? imageOf(byId.get(c.cardId)!, 'small') : null })),
    protectedCards,
    roles: roles.filter((r) => r.target).map((r) => ({ id: r.id, label: r.label, count: r.count, target: r.target })),
  });
}
