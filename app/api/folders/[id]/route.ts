/**
 * PATCH { name }: rename a deck folder.
 * DELETE: remove it; its decks stay, out of any folder.
 */

import { NextResponse } from 'next/server';

import { cleanFolderName, deleteFolder, folderOf, renameFolder } from '@/lib/deck-folders';
import { requireProfile } from '@/lib/profile-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  if (!folderOf(who.profile, id)) return NextResponse.json({ error: 'No such folder' }, { status: 404 });
  const body = await request.json().catch(() => ({})) as { name?: unknown };
  const name = cleanFolderName(body.name);
  if (!name) return NextResponse.json({ error: 'A folder needs a name' }, { status: 400 });
  if (!renameFolder(who.profile, id, name)) return NextResponse.json({ error: `You already have a folder called “${name}”` }, { status: 409 });
  return NextResponse.json({ folder: { id, name } });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  deleteFolder(who.profile, id);
  return NextResponse.json({ ok: true });
}
