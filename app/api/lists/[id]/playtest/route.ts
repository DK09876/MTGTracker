/**
 * A deck's playtest settings: the keep rule (Health and Playtest share it),
 * the goldfish settings and saved presets, and each card's tags - built-in
 * and the owner's - so the page can deal and play hands by them.
 *
 * GET: all of that. PUT {settings?, presets?}: save either.
 */

import { NextResponse } from 'next/server';

import { cardsInList, deckTags } from '@/lib/db';
import { playtestFor, savePlaytest } from '@/lib/deck-plan';
import { deckRoles } from '@/lib/deck-roles';
import { requireList } from '@/lib/profile-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function cardTags(id: string) {
  const main = cardsInList(id).filter((c) => c.board === 'main');
  const roles = await deckRoles(id, main).catch(() => []);
  const tags = deckTags(id);
  const names = new Map(tags.tags.filter((t) => t.status === 'accepted').map((t) => [t.id, t.name]));
  const byKey = new Map(main.map((c) => [c.card.oracle_id ?? c.card.id, c.card.name]));
  const of: Record<string, string[]> = {};
  const add = (name: string, tag: string) => { of[name] = [...new Set([...(of[name] ?? []), tag])]; };
  for (const r of roles) for (const n of r.cards) add(n, r.label);
  for (const ct of tags.cardTags) {
    const name = byKey.get(ct.key);
    if (ct.on && name && names.has(ct.tagId)) add(name, names.get(ct.tagId)!);
  }
  const builtIn = roles.filter((r) => r.count > 0).map((r) => r.label);
  return { of, tagNames: [...names.values(), ...builtIn.filter((b) => ![...names.values()].includes(b))], main };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const tags = await cardTags(id);
  const play = playtestFor(id, owned.list.commander, tags.main);
  return NextResponse.json({ ...play, cardTags: tags.of, tagNames: tags.tagNames });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const body = await request.json().catch(() => ({})) as { settings?: unknown; presets?: unknown };
  const main = cardsInList(id).filter((c) => c.board === 'main');
  const current = playtestFor(id, owned.list.commander, main);
  return NextResponse.json(savePlaytest(id, body, current));
}
