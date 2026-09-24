/**
 * Which profile a request is for, checked against the database.
 *
 * Every list route takes `?profile=`, as LifeOS's data routes do. A missing
 * or unknown profile is refused rather than defaulted, so nothing is ever
 * written where its owner cannot see it.
 */

import { NextResponse } from 'next/server';

import { getList, knownProfile, type List } from './db';

export function profileOf(request: Request): string | null {
  return knownProfile(new URL(request.url).searchParams.get('profile')?.trim() || null);
}

/** The profile, or the response to send instead. */
export function requireProfile(request: Request): { profile: string } | NextResponse {
  const profile = profileOf(request);
  return profile ? { profile } : NextResponse.json({ error: 'Pick a profile first' }, { status: 400 });
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
