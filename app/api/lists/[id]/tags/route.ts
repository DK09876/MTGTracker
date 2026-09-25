/**
 * A deck's tags: read them, write the brief, add a tag, change, reorder,
 * accept, turn down or merge tags, and delete one. Every write answers
 * with the whole of the deck's tags, so the page never has to guess.
 */

import { NextResponse } from 'next/server';

import {
  createTag, deckTags, deleteTag, mergeTags, reorderTags, setTagBrief, updateTag,
} from '@/lib/db';
import { requireList } from '@/lib/profile-route';
import { nextColor, TAG_KINDS, type TagKind, type TagStatus } from '@/lib/tags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES = new Set<TagStatus>(['proposed', 'accepted', 'rejected']);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
const kindOf = (v: unknown): TagKind | null | undefined =>
  v === null ? null : typeof v === 'string' && v in TAG_KINDS ? (v as TagKind) : undefined;
const colorOf = (v: unknown) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : undefined);

async function body(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  return NextResponse.json(deckTags(id));
}

/** The brief: what the owner wants the deck to do. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const b = await body(request);
  const brief = text(b?.brief, 4000);
  if (brief === undefined) return NextResponse.json({ error: 'brief required' }, { status: 400 });
  setTagBrief(id, brief);
  return NextResponse.json(deckTags(id));
}

/** A new tag, made by hand - accepted from the start. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const b = await body(request);
  const name = text(b?.name, 60);
  if (!name) return NextResponse.json({ error: 'A tag needs a name' }, { status: 400 });
  const current = deckTags(id);
  if (current.tags.some((t) => t.status !== 'rejected' && t.name.toLowerCase() === name.toLowerCase())) {
    return NextResponse.json({ error: `This deck already has a tag called "${name}"` }, { status: 409 });
  }
  const tag = createTag(id, {
    name,
    description: text(b?.description, 600) ?? '',
    color: colorOf(b?.color) ?? nextColor(current.tags.map((t) => t.color)),
    kind: kindOf(b?.kind) ?? null,
    status: 'accepted',
    origin: 'manual',
  });
  return NextResponse.json({ ...deckTags(id), created: tag.id });
}

/**
 * One of: change a tag ({tagId, name?, description?, color?, kind?, status?}),
 * reorder them ({order: [ids]}), accept every suggestion ({acceptAll: true})
 * or merge one into another ({mergeFrom, mergeInto}).
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const b = await body(request);
  if (!b) return NextResponse.json({ error: 'invalid json' }, { status: 400 });

  if (Array.isArray(b.order)) {
    reorderTags(id, b.order.filter((x): x is string => typeof x === 'string'));
  } else if (b.acceptAll === true) {
    for (const t of deckTags(id).tags) if (t.status === 'proposed') updateTag(id, t.id, { status: 'accepted' });
  } else if (typeof b.mergeFrom === 'string' && typeof b.mergeInto === 'string') {
    if (!mergeTags(id, b.mergeFrom, b.mergeInto)) return NextResponse.json({ error: 'No such tags' }, { status: 404 });
  } else if (typeof b.tagId === 'string') {
    const name = text(b.name, 60);
    if (name === '') return NextResponse.json({ error: 'A tag needs a name' }, { status: 400 });
    const status = typeof b.status === 'string' && STATUSES.has(b.status as TagStatus) ? (b.status as TagStatus) : undefined;
    const changed = updateTag(id, b.tagId, {
      name, description: text(b.description, 600), color: colorOf(b.color), kind: kindOf(b.kind), status,
    });
    if (!changed) return NextResponse.json({ error: 'No such tag' }, { status: 404 });
  } else {
    return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });
  }
  return NextResponse.json(deckTags(id));
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const tagId = new URL(request.url).searchParams.get('tagId');
  if (!tagId) return NextResponse.json({ error: 'tagId required' }, { status: 400 });
  deleteTag(id, tagId);
  return NextResponse.json(deckTags(id));
}
