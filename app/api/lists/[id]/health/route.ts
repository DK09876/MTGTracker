/**
 * A deck's health: its curve, colours, types, warnings and opening-hand
 * odds, all from the stored cards, so it answers at once. With ?roles=1 it
 * gives the role counts instead, which need Scryfall's tags the first time
 * a card is seen (saved after) - asked for separately so the rest of the
 * page does not wait on them. Main board only.
 */

import { deckRoles, deckRolesKnown } from '@/lib/deck-roles';
import { hardWarnings } from '@/lib/hard-checks';
import { NextResponse } from 'next/server';

import { jobsOnDeck, SIX_JOBS } from '@/lib/categories';

import { cardsInList } from '@/lib/db';
import { analyse } from '@/lib/health';
import { requireList } from '@/lib/profile-route';
import { planFor } from '@/lib/deck-plan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;

  const main = cardsInList(id).filter((c) => c.board === 'main');
  if (new URL(request.url).searchParams.get('roles') !== '1') {
    // Lands against the plan's range: the same number Plan and Tune show.
    const plan = planFor(id, '', owned.list.commander, main);
    const health = analyse({ commander: owned.list.commander, cards: main });
    // Hard failures past legality: no draw (from roles already known, no lookup), lands far under.
    // Card draw is checked only when it is one of the jobs on the deck: otherwise the check is skipped, not failed.
    const on = jobsOnDeck(id);
    const draw = on.has('draw') ? await deckRolesKnown(id, main).then((r) => r.find((x) => x.id === 'draw')?.count ?? null).catch(() => null) : null;
    health.warnings.push(...hardWarnings({ lands: { have: plan.landNumber.have, range: plan.lands }, draw, nearlyBuilt: health.size >= 90 }));
    const untracked = SIX_JOBS.filter((j) => !on.has(j.id)).map((j) => j.label);
    return NextResponse.json({ health, landTarget: plan.lands, landCount: plan.landNumber.have, untracked });
  }
  try {
    const roles = await deckRoles(id, main);
    return NextResponse.json({ roles });
  } catch (error) {
    console.error('[health] roles failed', error);
    return NextResponse.json({ error: 'Could not reach Scryfall for the role tags' }, { status: 502 });
  }
}
