/**
 * GET ?role=wipe&owned=1&max=10: cards to fill a gap in the deck (see
 * lib/gap-cards.ts). No model.
 */

import { NextResponse } from 'next/server';

import { gapCards } from '@/lib/gap-cards';
import { requireList } from '@/lib/profile-route';
import { ROLES } from '@/lib/roles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const q = new URL(request.url).searchParams;
  const role = q.get('role') ?? '';
  if (!ROLES.some((r) => r.id === role)) return NextResponse.json({ error: 'No such role' }, { status: 400 });
  return NextResponse.json(await gapCards(owned.list, owned.profile, role, { owned: q.get('owned') === '1', max: Number(q.get('max')) || null }));
}
