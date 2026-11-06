/**
 * A deck's sections beyond Main: add one (POST {name, purpose}), rename or
 * re-purpose one (PATCH {id, name?, purpose?}), or delete one of the
 * owner's own (DELETE ?id=), whose cards move to the Maybeboard.
 * Every answer is the deck's sections as they now stand.
 */

import { NextResponse } from 'next/server';

import { requireList } from '@/lib/profile-route';
import { addSection, changeSection, deleteSection, sectionsOf } from '@/lib/sections';
import { isPurpose } from '@/lib/sections-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function body(request: Request): Promise<Record<string, unknown> | null> {
  try { return await request.json() as Record<string, unknown>; } catch { return null; }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  return NextResponse.json({ sections: sectionsOf(id) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const b = await body(request);
  if (!b) return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  if (owned.list.kind !== 'deck') return NextResponse.json({ error: 'Only decks have sections' }, { status: 400 });
  if (sectionsOf(id).length >= 12) return NextResponse.json({ error: 'A deck can have up to 10 sections of its own' }, { status: 400 });
  const made = addSection(id, String(b.name ?? ''), isPurpose(b.purpose) ? b.purpose : 'list');
  if (!made) return NextResponse.json({ error: 'A section needs a name' }, { status: 400 });
  return NextResponse.json({ section: made, sections: sectionsOf(id) }, { status: 201 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const b = await body(request);
  if (!b || typeof b.id !== 'string') return NextResponse.json({ error: 'id required' }, { status: 400 });
  const changed = changeSection(id, b.id, {
    name: typeof b.name === 'string' ? b.name : undefined,
    purpose: isPurpose(b.purpose) ? b.purpose : undefined,
  });
  if (!changed) return NextResponse.json({ error: 'No such section' }, { status: 404 });
  return NextResponse.json({ sections: sectionsOf(id) });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const section = new URL(request.url).searchParams.get('id') ?? '';
  const moved = deleteSection(id, section);
  if (moved === null) return NextResponse.json({ error: 'Only your own sections can be deleted' }, { status: 400 });
  return NextResponse.json({ moved, sections: sectionsOf(id) });
}
