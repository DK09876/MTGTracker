/** PUT { folderId }: put a deck in one of its owner's folders, or out of any with null. */

import { NextResponse } from 'next/server';

import { folderOf, placeDeck } from '@/lib/deck-folders';
import { requireList } from '@/lib/profile-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const body = await request.json().catch(() => ({})) as { folderId?: unknown };
  const folderId = typeof body.folderId === 'string' ? body.folderId : null;
  if (folderId && !folderOf(owned.profile, folderId)) return NextResponse.json({ error: 'No such folder' }, { status: 404 });
  placeDeck(id, folderId);
  return NextResponse.json({ ok: true });
}
