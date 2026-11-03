/** POST: sign this browser out. */

import { NextResponse } from 'next/server';

import { cookieToken, endSession, sessionCookie } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const token = cookieToken(request);
  if (token) endSession(token);
  const res = NextResponse.json({ ok: true });
  res.headers.set('Set-Cookie', sessionCookie(request, '', null));
  return res;
}
