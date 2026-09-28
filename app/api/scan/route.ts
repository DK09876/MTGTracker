/**
 * Which card the scanner is looking at, from what it read.
 *
 * POST {title, set?, number?}: the name bar and the bottom-left small print.
 * A set and collector number give the exact printing, trusted only if a
 * name was read and is close to it (OCR can misread a digit into another
 * real card). Otherwise the name is matched loosely, in the set read if there was
 * one. Answers the card and how sure: 'printing' or 'name'.
 */

import { NextResponse } from 'next/server';

import { nameMatches } from '@/lib/scan';
import { cardAt, findCardNamed, ScryfallError, type ScryfallCard } from '@/lib/scryfall';
import { slimCard } from '@/lib/slim';

// The camera reads the same card several times a second while it is held
// up, and several people may scan the same staples: lookups are remembered
// for an hour, misses included, so Scryfall is asked once (it rate-limits at
// ten requests a second, and warns of a block beyond).
const CACHE_MS = 60 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map<string, { at: number; card: ScryfallCard | null }>();

async function remembered(key: string, look: () => Promise<ScryfallCard | null>): Promise<ScryfallCard | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.card;
  const card = await look();
  cache.set(key, { at: Date.now(), card });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return card;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export async function POST(request: Request) {
  const b = await request.json().catch(() => ({})) as Record<string, unknown>;
  const title = text(b.title, 80);
  const titles = title.length >= 3 ? [title] : [];
  const set = text(b.set, 6).toLowerCase().replace(/[^a-z0-9]/g, '');
  const number = text(b.number, 6).replace(/[^0-9a-z]/gi, '');
  if (!title && !(set && number)) return NextResponse.json({ error: 'Nothing was read' }, { status: 400 });

  try {
    let card: ScryfallCard | null = null;
    let match: 'printing' | 'name' = 'name';
    if (set && number) {
      const printing = await remembered(`at:${set}/${number}`, () => cardAt(set, number));
      // Only with a name that agrees: a misread number or a code's digits
      // found other real cards (Promise of Loyalty for a Sol Ring).
      if (printing && titles.some((t) => nameMatches(t, printing.name))) {
        card = printing;
        match = 'printing';
      }
    }
    // Scryfall's fuzzy match is generous - a misread "Swords to Plowshares"
    // came back as Approach of the Second Sun - so it must be close to what
    // was read, or it is no match.
    for (const [i, t] of titles.entries()) {
      if (card) break;
      const key = t.toLowerCase();
      // Only the best guess is also tried within the set read.
      const named = (set && i === 0 ? await remembered(`named:${key}|${set}`, () => findCardNamed(t, set)) : null)
        ?? await remembered(`named:${key}`, () => findCardNamed(t));
      if (named && nameMatches(t, named.name)) card = named;
    }
    if (!card) return NextResponse.json({ card: null, read: { title, set, number } });
    return NextResponse.json({ card: slimCard(card), match, read: { title, set, number } });
  } catch (error) {
    if (error instanceof ScryfallError) return NextResponse.json({ error: error.message }, { status: 502 });
    console.error('[scan] identify failed', error);
    return NextResponse.json({ error: 'Could not look that card up' }, { status: 500 });
  }
}
