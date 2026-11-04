/**
 * GET: the deck's cut candidates with their reasons (lib/cut-score.ts), the
 * cards protected by tags or a star, whether it reads as a Type A or B deck,
 * where the curve is heavy, and the role counts so the page can show what
 * cutting a few would leave. No model.
 * PUT {oracleId, keep}: star a card to keep it (or not).
 */

import { NextResponse } from 'next/server';

import { karstenLands } from '@/lib/build';
import { cutCandidates } from '@/lib/cut-score';
import { cachedRoles, cardsInList, deckTags, saveRoles } from '@/lib/db';
import { deckRoles, keeps, setKeep } from '@/lib/deck-roles';
import { commanderPage, edhrecEnabled } from '@/lib/edhrec';
import { fitProfile } from '@/lib/fit';
import { analyse } from '@/lib/health';
import { requireList } from '@/lib/profile-route';
import { countRoles } from '@/lib/roles';
import { imageOf, searchCards } from '@/lib/scryfall';

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
  // What the commander itself does, from the same tags (it is in every game).
  const commanderRoles = list.commander
    ? (await countRoles([{ card: list.commander, quantity: 1 }], { search: (q) => searchCards(q), cached: cachedRoles, save: saveRoles }))
      .filter((r) => r.count > 0).map((r) => r.id)
    : [];
  const { candidates, protectedCards, type, curve } = cutCandidates({
    cards: main, roles, fit: fitProfile(list.commander), commander: list.commander, commanderRoles,
    tags: deckTags(id), keep: keeps(id), stats: page?.stats ?? null,
    lands: { have: health.lands, want },
  });
  const byId = new Map(main.map((c) => [c.card.id, c.card]));
  return NextResponse.json({
    size: health.size,
    candidates: candidates.map((c) => ({ ...c, image: byId.get(c.cardId) ? imageOf(byId.get(c.cardId)!, 'small') : null })),
    protectedCards,
    type,
    curve,
    averageMv: health.averageMv,
    roles: roles.filter((r) => r.target).map((r) => ({ id: r.id, label: r.label, count: r.count, target: r.target })),
  });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const b = await request.json().catch(() => ({})) as { oracleId?: string; keep?: boolean };
  if (!b.oracleId || typeof b.keep !== 'boolean') return NextResponse.json({ error: 'Say which card' }, { status: 400 });
  setKeep(id, b.oracleId, b.keep);
  return NextResponse.json({ ok: true });
}
