/**
 * POST {name?}: a copy of the deck or list for the same profile - cards,
 * commander, plan, brief, tags and role corrections - private, and with no
 * copies pulled from boxes yet. Answers with the new list.
 */

import { NextResponse } from 'next/server';

import { duplicateList, getList } from '@/lib/db';
import { copyPlacement } from '@/lib/deck-folders';
import { copyPlan } from '@/lib/deck-plan';
import { copyDeckRoles } from '@/lib/deck-roles';
import { requireList } from '@/lib/profile-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const body = await request.json().catch(() => ({})) as { name?: string };
  const name = (body.name ?? '').trim() || `${owned.list.name} (copy)`;
  const copy = duplicateList(id, owned.profile, name.slice(0, 120));
  if (!copy) return NextResponse.json({ error: 'No such list' }, { status: 404 });
  copyDeckRoles(id, copy);
  copyPlan(id, copy);
  copyPlacement(id, copy);
  return NextResponse.json({ list: getList(copy, owned.profile) }, { status: 201 });
}
