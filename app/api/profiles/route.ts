/**
 * The profiles the app can switch between, and a new one.
 *
 * Unauthenticated and name-only, like LifeOS's: the switcher needs the list
 * before anyone has picked who they are. Anyone who can reach the app can
 * add a profile - it is shared with friends on the tailnet, and a profile
 * is only somewhere to keep lists, not a login.
 */

import { NextResponse } from 'next/server';

import { createProfile, listProfiles } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ profiles: listProfiles() });
  } catch (error) {
    console.error('[profiles] list failed', error);
    return NextResponse.json({ error: 'Could not read profiles' }, { status: 500 });
  }
}

const MAX_NAME = 30;
const MAX_PROFILES = 50;

export async function POST(request: Request) {
  let body: { name?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  if (!name) return NextResponse.json({ error: 'A profile needs a name' }, { status: 400 });
  if (name.length > MAX_NAME) return NextResponse.json({ error: `Keep it under ${MAX_NAME} characters` }, { status: 400 });

  try {
    // A ceiling, so a script hammering the button cannot fill the table.
    if (listProfiles().length >= MAX_PROFILES) {
      return NextResponse.json({ error: 'That is enough profiles for one Pi' }, { status: 400 });
    }
    return NextResponse.json({ profile: createProfile(name) });
  } catch (error) {
    console.error('[profiles] create failed', error);
    return NextResponse.json({ error: 'Could not add that profile' }, { status: 500 });
  }
}
