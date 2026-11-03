/**
 * GET ?profile=: what this browser may do as that profile - whether it has
 * to sign in first (and, for an admin with no password yet, set one), and
 * whether it is an admin.
 */

import { NextResponse } from 'next/server';

import { access, guarded, signedIn } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('profile') ?? '';
  const who = access(id);
  if (!who) return NextResponse.json({ error: 'No such profile' }, { status: 404 });
  const session = signedIn(request) === id;
  return NextResponse.json({
    ...who,
    signedIn: session,
    needsSignIn: guarded(who) && !session,
    // An admin's first sign-in sets their password.
    setsPassword: who.isAdmin && !who.hasPassword,
  });
}
