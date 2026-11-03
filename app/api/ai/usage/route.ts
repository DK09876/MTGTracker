/**
 * The AI usage trail: every Claude request in the last `days` (7 by default,
 * at most 90), newest first, with who made it, what for, the model, its
 * tokens and what it cost. An admin sees everyone's; anyone else their own.
 */

import { NextResponse } from 'next/server';

import { access } from '@/lib/auth';
import { aiCalls, listProfiles } from '@/lib/db';
import { requireProfile } from '@/lib/profile-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  const admin = access(who.profile)?.isAdmin ?? false;
  const days = Math.min(90, Math.max(1, Number(new URL(request.url).searchParams.get('days')) || 7));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const names = Object.fromEntries(listProfiles().map((p) => [p.id, p.name]));
  const calls = aiCalls(since).filter((c) => admin || c.profileId === who.profile);
  return NextResponse.json({ calls, names, days, everyone: admin });
}
