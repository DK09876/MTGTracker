/**
 * GET: the playgroups this profile is in.
 * POST { name }: a new playgroup, with this profile in it.
 */

import { NextResponse } from 'next/server';

import { access } from '@/lib/auth';
import { cleanName, createGroup, groupsOf } from '@/lib/games';
import { requireProfile } from '@/lib/profile-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  return NextResponse.json({ groups: groupsOf(who.profile) });
}

export async function POST(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  const body = await request.json().catch(() => ({})) as { name?: unknown };
  const name = cleanName(body.name, 60);
  if (!name) return NextResponse.json({ error: 'A playgroup needs a name' }, { status: 400 });
  const me = access(who.profile)!;
  return NextResponse.json({ group: createGroup({ id: me.id, name: me.name }, name) }, { status: 201 });
}
