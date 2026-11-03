/**
 * GET: errors that still need a look (the banner), or with ?all=1 the
 * whole log for Settings.
 * POST {id?}: acknowledge one error, or all of them.
 */

import { NextResponse } from 'next/server';

import { acknowledge, listErrors, openErrors } from '@/lib/errors';
import { requireProfile } from '@/lib/profile-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  const all = new URL(request.url).searchParams.get('all') === '1';
  return NextResponse.json({ errors: all ? listErrors() : openErrors() });
}

export async function POST(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  const body = await request.json().catch(() => ({})) as { id?: string };
  return NextResponse.json({ acknowledged: acknowledge(who.profile, body.id) });
}
