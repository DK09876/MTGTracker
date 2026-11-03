/** GET: everyone on the app, with their picture and how many decks they show. */

import { NextResponse } from 'next/server';

import { everyone } from '@/lib/auth';
import { requireProfile } from '@/lib/profile-route';
import { getStyle, publicIds } from '@/lib/profile-style';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  return NextResponse.json({
    people: everyone().map((p) => {
      const style = getStyle(p.id);
      return { id: p.id, name: p.name, isAdmin: p.isAdmin, art: style.commander?.art ?? null, commander: style.commander?.name ?? null, publicDecks: publicIds(p.id).size };
    }),
  });
}
