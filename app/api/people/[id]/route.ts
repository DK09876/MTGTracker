/**
 * GET: one person's profile page - their picture and favourite commander,
 * their featured deck, and the decks they show others. Their own page also
 * lists their private decks (marked), to choose what to show.
 */

import { NextResponse } from 'next/server';

import { access } from '@/lib/auth';
import { listLists } from '@/lib/db';
import { requireProfile } from '@/lib/profile-route';
import { getStyle, publicIds } from '@/lib/profile-style';
import { imageOf } from '@/lib/scryfall';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  const person = access(id);
  if (!person) return NextResponse.json({ error: 'No such person' }, { status: 404 });
  const self = who.profile === id;
  const shown = publicIds(id);
  const decks = listLists(id, 'deck').filter((d) => self || shown.has(d.id)).map((d) => ({
    id: d.id, name: d.name, public: shown.has(d.id), commander: d.commander?.name ?? null,
    identity: d.commander?.color_identity ?? [], image: d.commander ? imageOf(d.commander, 'normal') : null,
    art: d.commander?.image_uris?.art_crop ?? d.commander?.card_faces?.[0]?.image_uris?.art_crop ?? null,
    cards: d.totalCards,
  }));
  const style = getStyle(id);
  const featured = decks.find((d) => d.id === style.featuredDeck && (self || d.public)) ?? null;
  return NextResponse.json({
    person: { id: person.id, name: person.name, isAdmin: person.isAdmin },
    self,
    commander: style.commander,
    featured,
    decks,
    hidden: self ? 0 : listLists(id, 'deck').length - decks.length,
  });
}
