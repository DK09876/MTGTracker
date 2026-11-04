/**
 * GET: the profile's deck folders and which folder each deck is in.
 * POST { name }: a new folder.
 */

import { NextResponse } from 'next/server';

import { cleanFolderName, createFolder, foldersFor } from '@/lib/deck-folders';
import { requireProfile } from '@/lib/profile-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  return NextResponse.json(foldersFor(who.profile));
}

export async function POST(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  const body = await request.json().catch(() => ({})) as { name?: unknown };
  const name = cleanFolderName(body.name);
  if (!name) return NextResponse.json({ error: 'A folder needs a name' }, { status: 400 });
  const folder = createFolder(who.profile, name);
  if (!folder) return NextResponse.json({ error: `You already have a folder called “${name}”` }, { status: 409 });
  return NextResponse.json({ folder }, { status: 201 });
}
