/**
 * Boxes and binders.
 *
 *   POST   {name, kind?}          make one
 *   PATCH  {from, to?, kind?}      rename or change kind; its cards follow
 *   DELETE ?name=                  remove one; its cards become unsorted
 */

import { NextResponse } from 'next/server';

import { addLocation, deleteLocation, locations, renameLocation, type LocationKind } from '@/lib/collection';
import { requireProfile } from '@/lib/profile-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const nameOf = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, 60) : '');
const kindOf = (v: unknown): LocationKind | undefined => (v === 'box' || v === 'binder' ? v : undefined);

export async function POST(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  const b = await request.json().catch(() => ({})) as { name?: unknown; kind?: unknown };
  const name = nameOf(b.name);
  if (!name) return NextResponse.json({ error: 'A box needs a name' }, { status: 400 });
  addLocation(who.profile, name, kindOf(b.kind) ?? 'box');
  return NextResponse.json({ locations: locations(who.profile) });
}

export async function PATCH(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  const b = await request.json().catch(() => ({})) as { from?: unknown; to?: unknown; kind?: unknown };
  const from = nameOf(b.from);
  const to = b.to === undefined ? from : nameOf(b.to);
  if (!from || !to) return NextResponse.json({ error: 'from and to required' }, { status: 400 });
  renameLocation(who.profile, from, to, kindOf(b.kind));
  return NextResponse.json({ locations: locations(who.profile) });
}

export async function DELETE(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  const name = nameOf(new URL(request.url).searchParams.get('name'));
  if (name) deleteLocation(who.profile, name);
  return NextResponse.json({ locations: locations(who.profile) });
}
