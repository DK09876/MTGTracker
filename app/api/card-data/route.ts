/**
 * GET: how fresh the card data on the Pi is. POST: refresh it now, in the
 * background (the jobs menu shows it).
 */

import { NextResponse } from 'next/server';

import { cardDataStatus, startCardRefresh } from '@/lib/card-store';
import { requireAdmin, requireProfile } from '@/lib/profile-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  return NextResponse.json({ status: cardDataStatus() });
}

export async function POST(request: Request) {
  const who = requireAdmin(request);
  if (who instanceof NextResponse) return who;
  return NextResponse.json({ job: startCardRefresh() });
}
