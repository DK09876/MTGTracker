/**
 * The AI usage trail: every Claude request in the last `days` (7 by default,
 * at most 90), newest first, with who made it, what for, the model, its
 * tokens and what it cost. Everyone's, like the caps - the app is shared.
 */

import { NextResponse } from 'next/server';

import { aiCalls, listProfiles } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const days = Math.min(90, Math.max(1, Number(new URL(request.url).searchParams.get('days')) || 7));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const names = Object.fromEntries(listProfiles().map((p) => [p.id, p.name]));
  return NextResponse.json({ calls: aiCalls(since), names, days });
}
