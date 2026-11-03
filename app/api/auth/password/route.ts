/**
 * POST {current?, next}: set, change or (with next empty) remove the
 * profile's password. Changing or removing one asks for the current one;
 * an admin cannot remove theirs. Other browsers signed in as the profile
 * are signed out.
 */

import { NextResponse } from 'next/server';

import { access, endSessionsFor, MIN_PASSWORD, passwordMatches, sessionCookie, setPassword, startSession } from '@/lib/auth';
import { requireProfile } from '@/lib/profile-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  const me = access(who.profile)!;
  const body = await request.json().catch(() => ({})) as { current?: string; next?: string };
  const next = body.next ?? '';
  if (me.hasPassword && !passwordMatches(me.id, body.current ?? '')) return NextResponse.json({ error: 'Your current password is not right' }, { status: 401 });
  if (!next && me.isAdmin) return NextResponse.json({ error: 'Admins must keep a password' }, { status: 400 });
  if (next && next.length < MIN_PASSWORD) return NextResponse.json({ error: `Use at least ${MIN_PASSWORD} characters` }, { status: 400 });
  setPassword(me.id, next || null);
  endSessionsFor(me.id);
  const res = NextResponse.json({ access: access(me.id) });
  // This browser stays signed in.
  if (next) {
    const { token, expires } = startSession(me.id);
    res.headers.set('Set-Cookie', sessionCookie(request, token, expires));
  }
  return res;
}
