/** One list: its cards, a rename, or its removal. */

import { NextResponse } from 'next/server';

import { cardsInList, deleteList, getList, renameList } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const list = getList(id);
    if (!list) return NextResponse.json({ error: 'No such list' }, { status: 404 });
    return NextResponse.json({ list, cards: cardsInList(id) });
  } catch (error) {
    console.error('[list] read failed', error);
    return NextResponse.json({ error: 'Could not read that list' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { name?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const name = (body.name ?? '').trim();
  if (!name) return NextResponse.json({ error: 'A list needs a name' }, { status: 400 });

  try {
    renameList(id, name, body.note);
    return NextResponse.json({ list: getList(id) });
  } catch (error) {
    console.error('[list] rename failed', error);
    return NextResponse.json({ error: 'Could not rename that list' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    deleteList(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[list] delete failed', error);
    return NextResponse.json({ error: 'Could not delete that list' }, { status: 500 });
  }
}
