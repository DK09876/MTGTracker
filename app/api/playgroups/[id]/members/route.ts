/**
 * POST { profileId } or { name }: add someone on the app, or a guest by name.
 * DELETE ?member=: take someone out; their games stay.
 */

import { NextResponse } from 'next/server';

import { access } from '@/lib/auth';
import { addMember, cleanName, groupFor, removeMember } from '@/lib/games';
import { requireProfile } from '@/lib/profile-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

function find(request: Request, id: string) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  return groupFor(who.profile, id) ? who : NextResponse.json({ error: 'No such playgroup' }, { status: 404 });
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const who = find(request, id);
  if (who instanceof NextResponse) return who;
  const body = await request.json().catch(() => ({})) as { profileId?: unknown; name?: unknown };
  if (typeof body.profileId === 'string') {
    const p = access(body.profileId);
    if (!p || p.id === 'tour') return NextResponse.json({ error: 'No such profile' }, { status: 404 });
    return NextResponse.json({ member: addMember(id, { profileId: p.id, name: p.name }) }, { status: 201 });
  }
  const name = cleanName(body.name);
  if (!name) return NextResponse.json({ error: 'A guest needs a name' }, { status: 400 });
  const member = addMember(id, { profileId: null, name });
  if (!member) return NextResponse.json({ error: `${name} is already in this playgroup` }, { status: 409 });
  return NextResponse.json({ member }, { status: 201 });
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const who = find(request, id);
  if (who instanceof NextResponse) return who;
  const member = new URL(request.url).searchParams.get('member');
  if (member) removeMember(id, member);
  return NextResponse.json({ ok: true });
}
