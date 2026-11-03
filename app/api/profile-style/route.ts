/**
 * The profile's own look. GET: its style and the colour variables it sets.
 * PUT {theme?, motion?, commanderId?, featuredDeck?}: change it; a
 * commander is looked up by Scryfall id for its art and colours.
 */

import { NextResponse } from 'next/server';

import { getList } from '@/lib/db';
import { requireProfile } from '@/lib/profile-route';
import { getStyle, setStyle, type ProfileStyle } from '@/lib/profile-style';
import { getCard, ScryfallError } from '@/lib/scryfall';
import { themeVars, THEME_IDS, type ThemeId } from '@/lib/themes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const answer = (style: ProfileStyle) => ({ style, vars: themeVars(style.theme, style.commander?.identity ?? null) });

export async function GET(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  return NextResponse.json(answer(getStyle(who.profile)));
}

export async function PUT(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  const b = await request.json().catch(() => ({})) as { theme?: string; motion?: boolean; commanderId?: string | null; featuredDeck?: string | null };
  const change: Partial<ProfileStyle> = {};
  if (b.theme !== undefined) {
    if (!THEME_IDS.includes(b.theme as ThemeId)) return NextResponse.json({ error: 'No such theme' }, { status: 400 });
    change.theme = b.theme as ThemeId;
  }
  if (typeof b.motion === 'boolean') change.motion = b.motion;
  if (b.featuredDeck !== undefined) {
    if (b.featuredDeck && !getList(b.featuredDeck, who.profile)) return NextResponse.json({ error: 'No such deck' }, { status: 404 });
    change.featuredDeck = b.featuredDeck;
  }
  if (b.commanderId !== undefined) {
    if (!b.commanderId) change.commander = null;
    else {
      try {
        const card = await getCard(b.commanderId);
        change.commander = {
          id: card.id, name: card.name, identity: card.color_identity ?? [],
          art: card.image_uris?.art_crop ?? card.card_faces?.[0]?.image_uris?.art_crop ?? null,
        };
      } catch (error) {
        if (error instanceof ScryfallError) return NextResponse.json({ error: error.message }, { status: 502 });
        throw error;
      }
    }
  }
  return NextResponse.json(answer(setStyle(who.profile, change)));
}
