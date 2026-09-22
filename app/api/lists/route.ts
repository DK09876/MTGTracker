/** The lists themselves: read them all, or make one. */

import { NextResponse } from 'next/server';

import { createList, listLists } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ lists: listLists() });
  } catch (error) {
    console.error('[lists] read failed', error);
    return NextResponse.json({ error: 'Could not read your lists' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: { name?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const name = (body.name ?? '').trim();
  if (!name) return NextResponse.json({ error: 'A list needs a name' }, { status: 400 });

  try {
    return NextResponse.json({ list: createList(name, (body.note ?? '').trim()) });
  } catch (error) {
    console.error('[lists] create failed', error);
    return NextResponse.json({ error: 'Could not create that list' }, { status: 500 });
  }
}
