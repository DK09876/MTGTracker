/**
 * POST {profile, password}: sign this browser in as a profile. An admin
 * with no password yet sets one here, on first sign-in. Five wrong tries
 * lock the profile for a minute.
 */

import { NextResponse } from 'next/server';

import { access, clearFailures, lockedFor, MIN_PASSWORD, noteFailure, passwordMatches, sessionCookie, setPassword, startSession } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { profile?: string; password?: string };
  const who = body.profile ? access(body.profile) : null;
  if (!who) return NextResponse.json({ error: 'No such profile' }, { status: 404 });
  const password = body.password ?? '';
  const wait = lockedFor(who.id);
  if (wait) return NextResponse.json({ error: `Too many tries - wait ${Math.ceil(wait / 1000)} seconds` }, { status: 429 });

  if (!who.hasPassword) {
    if (who.isAdmin) {
      // First sign-in as an admin: the password typed becomes theirs.
      if (password.length < MIN_PASSWORD) return NextResponse.json({ error: `Admins need a password of at least ${MIN_PASSWORD} characters` }, { status: 400 });
      setPassword(who.id, password);
    }
  } else if (!passwordMatches(who.id, password)) {
    noteFailure(who.id);
    return NextResponse.json({ error: 'That password is not right' }, { status: 401 });
  }
  clearFailures(who.id);
  const { token, expires } = startSession(who.id);
  const res = NextResponse.json({ ok: true, access: access(who.id) });
  res.headers.set('Set-Cookie', sessionCookie(request, token, expires));
  return res;
}
