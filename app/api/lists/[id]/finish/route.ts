/**
 * Finish the deck from the owner's collection (lib/finish.ts), as one
 * conversation per deck.
 *
 * GET ?card=<id>: one card's data, to open it from its name.
 * GET: the view: the setting and the funnel, the latest picks with the
 * owner's choices, the searches of the round running now, the combos.
 * POST {action, ...}:
 *   settings {copies?, want?, lands?, buy?, spend?}  which cards may be used ("spare" | "any"),
 *       cards to buy ("none" | "matter" | "any") and the most to spend on them in all (null: no limit),
 *       how many to add (null: fill to 100), and the lands in the deck when a
 *       fill to 100 is done (null: the plan's land number); kept per deck
 *   find {rerun?, message?}    ask Claude in the background: the first list,
 *       or (rerun) the owner's marks and message, refilling the open slots
 *   choices {choices}          Add / Rethink / Skip and reasons, replaced whole
 *   lands {skip?, basics?, add?}  a fill to 100: nonbasic lands left out, how
 *       many of each basic to take, and "+" for another land a search found
 *   unskip {name}              take a card off the deck's skipped-before list
 *   take {name, group}         "+" from a search's results: no paid round
 *   takeOver {name}            "Add anyway" on a card to buy that was over the total: no paid round
 *   apply                      add the cards on Add (and, on a full fill, the
 *       app's lands), after a snapshot
 *   undo                       put every row back as it was
 *   reset                      start over
 */

import { NextResponse } from 'next/server';

import { claudeCall, ModelError } from '@/lib/ai';
import { localCards } from '@/lib/card-store';
import { database } from '@/lib/db';
import { recorded, takeSnapshot } from '@/lib/deck-history';
import { applyFinish, finishView, resetFinish, runFinish, setChoices, setFinish, setLands, takeCard, takeOver, undoFinish, unskip } from '@/lib/finish';
import { latestJob, startJob } from '@/lib/jobs';
import { requireList, requirePlan } from '@/lib/profile-route';
import { TRIM_MODELS } from '@/lib/trim-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_KEY = 'No Claude key is set on the server, so Claude can’t be asked. “Fill from the deck’s numbers” works without one.';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  // ?card=<id>[&name=<name>]: one card's full data, to open it from its name. A card the app hasn't stored (one
  // Chat found by searching all cards) comes from the card data by its name.
  const q = new URL(request.url).searchParams;
  const cardId = q.get('card');
  if (cardId) {
    const r = database().get('SELECT data FROM cards WHERE id = ?', [cardId]) as { data: string } | null;
    if (r) return NextResponse.json(JSON.parse(r.data));
    const byName = q.get('name') ? localCards([q.get('name')!])[0] : undefined;
    return byName ? NextResponse.json(byName) : NextResponse.json({ error: 'No such card' }, { status: 404 });
  }
  return NextResponse.json(await finishView(owned.list, owned.profile));
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const locked = requirePlan(id);
  if (locked) return locked;
  const { list, profile } = owned;
  const b = await request.json().catch(() => ({})) as Record<string, unknown>;
  // While Claude works on a round, the list it will replace can't be changed from another tab (round 2, item 6).
  if ((b.action === 'take' || b.action === 'takeOver' || b.action === 'lands' || b.action === 'unskip') && latestJob('finish', id)?.status === 'running') {
    return NextResponse.json({ error: 'Claude is working on this list: wait for the round to finish' }, { status: 409 });
  }
  try {
    switch (b.action) {
      case 'settings':
        setFinish(id, { copies: b.copies, want: b.want, lands: b.lands, buy: b.buy, spend: b.spend });
        break;
      case 'find': {
        if (!process.env.ANTHROPIC_API_KEY || profile === 'tour') return NextResponse.json({ error: NO_KEY }, { status: 503 });
        // Every AI step on the deck pages runs on Opus.
        const model = TRIM_MODELS.opus.id;
        const call = claudeCall(model, { profile, feature: 'finish', label: list.name });
        startJob({ kind: 'finish', label: 'Finishing the deck from your cards', subject: list.name, profileId: profile, listId: id, errorLevel: (e) => (e instanceof ModelError ? 'warn' : 'error') },
          ({ progress }) => runFinish(call, model, list, profile, { rerun: b.rerun === true, message: typeof b.message === 'string' ? b.message : '' }, progress));
        break;
      }
      case 'choices':
        setChoices(id, b.choices);
        break;
      case 'lands':
        await setLands(list, profile, { skip: b.skip, basics: b.basics, add: b.add });
        break;
      case 'unskip':
        if (typeof b.name !== 'string') return NextResponse.json({ error: 'Which card?' }, { status: 400 });
        unskip(id, b.name);
        break;
      case 'takeOver':
        if (typeof b.name !== 'string') return NextResponse.json({ error: 'Which card?' }, { status: 400 });
        await takeOver(list, profile, b.name);
        break;
      case 'take':
        if (typeof b.name !== 'string') return NextResponse.json({ error: 'Which card?' }, { status: 400 });
        await takeCard(list, profile, b.name, typeof b.group === 'string' ? b.group : 'theme');
        break;
      case 'apply':
        takeSnapshot(id, 'Before finishing from your cards', { profile }, true);
        await recorded(id, { profile }, 'tune', 'Finished from your cards', () => applyFinish(list, profile));
        break;
      case 'undo':
        await recorded(id, { profile }, 'undo', 'Undid the finish', () => undoFinish(list));
        break;
      case 'reset':
        resetFinish(id);
        break;
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not do that' }, { status: 400 });
  }
  return NextResponse.json(await finishView(list, profile));
}
