/**
 * Trim for one deck (lib/trim.ts): the cut flow for a deck over 100.
 *
 * GET: the view: the approach, the latest list with the owner's choices, what
 * the chosen cuts do to the deck's numbers, and the call running now.
 * POST {action, ...}:
 *   approach {text?, draft?, clear?, claude?}  what matters for these cuts:
 *       the owner's box as typed (empty clears it), the code's draft from the
 *       deck's numbers (free), or Claude adding bullets below `text` in the
 *       background
 *   find {rerun?, message?}  ask Claude for the cut list in the background.
 *       The first starts a session; rerun sends the whole session with the
 *       marks made since the last list and the owner's message
 *   choices {choices}     the owner's choices and reasons, replaced whole; answers
 *       with the view so the numbers follow
 *   never {name, on}      mark a card never cut from its opened card, or take it off
 *   apply {cutsTo?, keepNotes?}  cut the chosen cards, after a snapshot; the
 *       session lines ticked "Keep for next time" go to the deck's notes
 *   undo                  put back what the last apply moved
 *   reset                 drop the list and the session, and start over
 */

import { NextResponse } from 'next/server';

import { modelById, ModelError } from '@/lib/ai';
import { recorded, takeSnapshot } from '@/lib/deck-history';
import { startJob } from '@/lib/jobs';
import { requireList, requirePlan } from '@/lib/profile-route';
import { hasBoard } from '@/lib/sections';
import { applyTrim, resetTrim, runTrim, setApproach, setChoices, setNeverCut, trimView, undoTrim, writeApproach } from '@/lib/trim';
import { TRIM_MODELS, type TrimModel } from '@/lib/trim-shared';
import type { Board } from '@/lib/decklist';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_KEY = 'No Claude key is set on the server, so Claude can’t be asked. You can still write an approach and cut cards from the Cards tab.';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  return NextResponse.json(await trimView(owned.list, owned.profile));
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const locked = requirePlan(id);
  if (locked) return locked;
  const { list, profile } = owned;
  const b = await request.json().catch(() => ({})) as Record<string, unknown>;
  const warn = (e: unknown) => (e instanceof ModelError ? 'warn' as const : 'error' as const);
  switch (b.action) {
    case 'approach': {
      if (b.claude === true) {
        const model = modelById(TRIM_MODELS.opus.id, [], { profile, feature: 'tagging', label: list.name });
        if (!model) return NextResponse.json({ error: NO_KEY }, { status: 503 });
        startJob({ kind: 'trimapproach', label: 'Writing the cut approach', subject: list.name, profileId: profile, listId: id, errorLevel: warn },
          async ({ progress }) => { progress('Claude is adding to it'); await writeApproach(model, list, profile, typeof b.text === 'string' ? b.text : ''); return { ok: true }; });
        break;
      }
      await setApproach(list, profile, { text: typeof b.text === 'string' ? b.text : undefined, draft: b.draft === true, clear: b.clear === true });
      break;
    }
    case 'find': {
      const which: TrimModel = 'opus';
      const model = modelById(TRIM_MODELS[which].id, [], { profile, feature: 'tagging', label: list.name });
      if (!model) return NextResponse.json({ error: NO_KEY }, { status: 503 });
      startJob({ kind: 'trim', label: 'Ranking the cuts', subject: list.name, profileId: profile, listId: id, errorLevel: warn },
        ({ progress }) => runTrim(model, list, profile, { model: which, rerun: b.rerun === true, message: typeof b.message === 'string' ? b.message : '' }, progress));
      break;
    }
    case 'choices':
      setChoices(id, b.choices);
      break;
    case 'never':
      if (typeof b.name === 'string') setNeverCut(id, b.name, b.on !== false);
      break;
    case 'apply': {
      const cutsTo = typeof b.cutsTo === 'string' && b.cutsTo !== 'main' && hasBoard(id, b.cutsTo) ? b.cutsTo as Board : undefined;
      try {
        takeSnapshot(id, 'Before trimming to 100', { profile }, true);
        const keepNotes = Array.isArray(b.keepNotes) ? b.keepNotes.filter((x): x is string => typeof x === 'string').slice(0, 50) : [];
        await recorded(id, { profile }, 'tune', 'Trimmed the deck', () => applyTrim(list, profile, cutsTo, keepNotes));
      } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not apply the cuts' }, { status: 400 });
      }
      break;
    }
    case 'undo':
      await recorded(id, { profile }, 'undo', 'Undid the trim', () => undoTrim(list));
      break;
    case 'reset':
      resetTrim(id);
      break;
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
  return NextResponse.json(await trimView(list, profile));
}
