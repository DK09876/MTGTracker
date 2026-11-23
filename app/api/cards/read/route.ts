/**
 * Read the owner's words for cards before they go anywhere (lib/cards.ts readCards; AGENTS.md "Reading the owner's
 * words"). Every page that sends what the owner typed to an AI asks here first (components/CardChoice.tsx,
 * useCardCheck).
 *
 *   POST {text, known?, picks?}   { text (cards marked [[like this]]), cards, choices, readAs }
 *   DELETE ?phrase=<words>        forget the profile's pick for those words
 */

import { NextResponse } from 'next/server';

import { phraseKey, type CardPick, type ChoiceKind } from '@/lib/card-names';
import { forgetPick } from '@/lib/card-picks';
import { readCards } from '@/lib/cards';
import { profileOf } from '@/lib/profile-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KINDS = new Set<ChoiceKind>(['typo', 'several', 'maybe']);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { text?: unknown; known?: unknown; picks?: unknown };
  const text = str(body.text, 4000);
  if (!text.trim()) return NextResponse.json({ text, cards: [], choices: [], readAs: [] });
  const known = (Array.isArray(body.known) ? body.known : []).map((k) => str(k, 150)).filter(Boolean).slice(0, 400);
  const picks: CardPick[] = (Array.isArray(body.picks) ? body.picks : [])
    .map((p) => p as Record<string, unknown>)
    .filter((p) => typeof p.mention === 'string' && typeof p.name === 'string' && KINDS.has(p.kind as ChoiceKind))
    .slice(0, 10)
    .map((p) => ({ mention: str(p.mention, 200), name: str(p.name, 150), kind: p.kind as ChoiceKind }));
  try {
    return NextResponse.json(await readCards(text, { profile: profileOf(request), known, picks }));
  } catch (error) {
    // Without the name list (Scryfall unreachable, nothing kept), the text goes as typed: nothing is attached.
    console.error('[cards/read] failed', error);
    return NextResponse.json({ text, cards: [], choices: [], readAs: [] });
  }
}

export async function DELETE(request: Request) {
  const profile = profileOf(request);
  const phrase = phraseKey(new URL(request.url).searchParams.get('phrase') ?? '');
  if (profile && phrase) forgetPick(profile, phrase);
  return NextResponse.json({ ok: true });
}
