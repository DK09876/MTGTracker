/**
 * GET: the deck's cut candidates with their reasons (lib/cut-score.ts), the
 * cards protected by tags or a star, whether it reads as a Type A or B deck,
 * where the curve is heavy, and the role counts so the page can show what
 * cutting a few would leave. No model.
 * PUT {oracleId, keep}: star a card to keep it (or not).
 * PATCH {settings}: the deck's own rule settings (lib/cut-rules.ts).
 */

import { NextResponse } from 'next/server';

import { cleanSettings } from '@/lib/cut-rules';
import { deckCutList } from '@/lib/cut-list';
import { setCutSettings } from '@/lib/deck-plan';
import { setKeep } from '@/lib/deck-roles';
import { requireList } from '@/lib/profile-route';
import { imageOf } from '@/lib/scryfall';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const { candidates, protectedCards, type, curve, main, health, roles, settings } = await deckCutList(owned.list);
  const byId = new Map(main.map((c) => [c.card.id, c.card]));
  return NextResponse.json({
    size: health.size,
    candidates: candidates.map((c) => ({ ...c, image: byId.get(c.cardId) ? imageOf(byId.get(c.cardId)!, 'small') : null })),
    protectedCards,
    type,
    curve,
    averageMv: health.averageMv,
    roles: roles.filter((r) => r.target).map((r) => ({ id: r.id, label: r.label, count: r.count, target: r.target })),
    settings,
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

/** PATCH {settings}: the deck's own cut rules - switched off, reweighted, or written by the owner. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const b = await request.json().catch(() => ({})) as { settings?: unknown };
  return NextResponse.json({ settings: setCutSettings(id, cleanSettings(b.settings)) });
}
