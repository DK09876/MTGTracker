/**
 * GET: the app's version, the deploy history, and (with ?profile=) the newest
 * release that profile has seen. POST {version}: that profile has now seen
 * the notes up to it. The notes themselves are baked into the pages
 * (lib/releases.ts); only what changes on the server comes from here.
 */

import { NextResponse } from 'next/server';

import { profileOf, requireProfile } from '@/lib/profile-route';
import { APP_VERSION } from '@/lib/releases';
import { deploys, markSeen, seenVersion } from '@/lib/releases-server';
import { buildId } from '@/lib/updating';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const profile = profileOf(request);
  return NextResponse.json(
    { version: APP_VERSION, build: buildId(), seen: profile ? seenVersion(profile) : null, deploys: deploys() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  const b = await request.json().catch(() => ({})) as { version?: unknown };
  return NextResponse.json({ seen: markSeen(who.profile, typeof b.version === 'string' ? b.version : APP_VERSION) });
}
