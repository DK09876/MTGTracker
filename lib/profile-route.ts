/**
 * Which profile a request is for, checked against the database.
 *
 * Every list route takes `?profile=`, as LifeOS's data routes do. A missing
 * or unknown profile is refused rather than defaulted, so nothing is ever
 * written where its owner cannot see it.
 */

import { NextResponse } from 'next/server';


import { access, guarded, signedIn } from './auth';
import { getList, knownProfile, type List } from './db';

// Kept here rather than imported from tour.ts, which pulls in the seeding.
const TOUR_PROFILE = 'tour';

/**
 * The profile a request asks for, if it may use it: a profile with a
 * password (or an admin) only from a browser signed in as it.
 */
export function profileOf(request: Request): string | null {
  const id = knownProfile(new URL(request.url).searchParams.get('profile')?.trim() || null);
  if (!id) return null;
  const who = access(id);
  return who && guarded(who) && signedIn(request) !== id ? null : id;
}

/** The profile, or the response to send instead - 401 when it needs signing in. */
export function requireProfile(request: Request): { profile: string } | NextResponse {
  const asked = knownProfile(new URL(request.url).searchParams.get('profile')?.trim() || null);
  if (!asked) return NextResponse.json({ error: 'Pick a profile first' }, { status: 400 });
  const profile = profileOf(request);
  if (!profile) return NextResponse.json({ error: 'Sign in first', signIn: asked }, { status: 401 });
  // The guided tour's sample is shown, never changed.
  if (profile === TOUR_PROFILE && request.method !== 'GET') {
    return NextResponse.json({ error: 'This is the tour\'s sample - nothing here changes. End the tour to use your own.' }, { status: 403 });
  }
  return { profile };
}

/** The profile, if it is an admin's, or the response to send instead. */
export function requireAdmin(request: Request): { profile: string } | NextResponse {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  return access(who.profile)?.isAdmin ? who : NextResponse.json({ error: 'Only an admin can do that' }, { status: 403 });
}

/**
 * The list, if it exists and belongs to the request's profile. Another
 * profile's list is a 404, the same as one that does not exist.
 */
export function requireList(request: Request, id: string): { profile: string; list: List } | NextResponse {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  const list = getList(id, who.profile);
  return list ? { profile: who.profile, list } : NextResponse.json({ error: 'No such list' }, { status: 404 });
}

/**
 * Tune, Chat and the AI steps used to wait for a confirmed plan. They no
 * longer do (deck flow plan, slice 3): the evaluation found no case for a
 * hard lock, and they read the plan when there is one. Kept so the routes
 * that call it need no change; it never refuses.
 */
export function requirePlan(listId: string): NextResponse | null {
  void listId;
  return null;
}
