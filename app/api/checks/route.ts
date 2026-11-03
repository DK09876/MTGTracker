/**
 * GET: the latest self-checks. POST: run them now.
 */

import { NextResponse } from 'next/server';

import { latestChecks, runChecks } from '@/lib/checks';
import { requireProfile } from '@/lib/profile-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  return NextResponse.json({ run: latestChecks() });
}

export async function POST(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  return NextResponse.json({ run: runChecks() });
}
