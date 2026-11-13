/**
 * POST {name, aside}: set a flagged card aside on this deck's bracket box ("Doesn't count in this deck"), or put
 * it back (Part D 17). The bracket floor, the Plan's bracket read and what Claude is told leave it out.
 */

import { NextResponse } from 'next/server';

import { setAside } from '@/lib/bracket-aside';
import { requireList } from '@/lib/profile-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const b = await request.json().catch(() => ({})) as { name?: unknown; aside?: unknown };
  if (typeof b.name !== 'string' || !b.name.trim()) return NextResponse.json({ error: 'Which card?' }, { status: 400 });
  setAside(id, b.name, b.aside !== false);
  return NextResponse.json({ ok: true });
}
