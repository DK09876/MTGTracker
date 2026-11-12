/**
 * Trim for one deck (lib/trim.ts): the cut flow for a deck over 100.
 *
 * GET: the view: the approach, the latest list with the owner's choices, what
 * the chosen cuts do to the deck's numbers, and the call running now.
 * POST {action, ...}:
 *   approach {text?, draft?, clear?, claude?}  the owner's own approach, the
 *       code's draft from the deck's numbers (free), none, or one written by
 *       Claude in the background
 *   correction {text}     a line added to the approach, kept as it is typed
 *   find {rerun?}         ask Claude for the cut list in the background; rerun
 *       sends the choices made so far and keeps the approach
 *   choices {choices}     the owner's choices and reasons, replaced whole; answers
 *       with the view so the numbers follow
 *   apply {cutsTo?}       cut the chosen cards, after a snapshot
 *   undo                  put back what the last apply moved
 *   reset                 drop the list and start over
 */

import { NextResponse } from 'next/server';

import { modelById, ModelError } from '@/lib/ai';
import { recorded, takeSnapshot } from '@/lib/deck-history';
import { startJob } from '@/lib/jobs';
import { requireList, requirePlan } from '@/lib/profile-route';
import { hasBoard } from '@/lib/sections';
import { applyTrim, resetTrim, runTrim, setApproach, setChoices, setCorrection, trimView, undoTrim, writeApproach } from '@/lib/trim';
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
          async ({ progress }) => { progress('Claude is writing the approach'); await writeApproach(model, list, profile); return { ok: true }; });
        break;
      }
      await setApproach(list, profile, { text: typeof b.text === 'string' ? b.text : undefined, draft: b.draft === true, clear: b.clear === true });
      break;
    }
    case 'correction':
      setCorrection(id, b.text);
      break;
    case 'find': {
      const which: TrimModel = 'opus';
      const model = modelById(TRIM_MODELS[which].id, [], { profile, feature: 'tagging', label: list.name });
      if (!model) return NextResponse.json({ error: NO_KEY }, { status: 503 });
      startJob({ kind: 'trim', label: 'Ranking the cuts', subject: list.name, profileId: profile, listId: id, errorLevel: warn },
        ({ progress }) => runTrim(model, list, profile, { model: which, rerun: b.rerun === true }, progress));
      break;
    }
    case 'choices':
      setChoices(id, b.choices);
      break;
    case 'apply': {
      const cutsTo = typeof b.cutsTo === 'string' && b.cutsTo !== 'main' && hasBoard(id, b.cutsTo) ? b.cutsTo as Board : undefined;
      try {
        takeSnapshot(id, 'Before trimming to 100', { profile }, true);
        await recorded(id, { profile }, 'tune', 'Trimmed the deck', () => applyTrim(list, profile, cutsTo));
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
