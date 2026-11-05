/**
 * A deck's tagging job - see lib/tag-jobs.ts.
 *
 *   GET                  the latest job, the deck's tags, and today's budget
 *   POST {kind: 'propose', instructions, boards}
 *   POST {kind: 'tag', mode, scope, audit, boards}   start one
 *   DELETE               stop the running one
 */

import { NextResponse } from 'next/server';

import { currentBudget } from '@/lib/ai';
import { deckTags } from '@/lib/db';
import type { Board } from '@/lib/decklist';
import { hasBoard } from '@/lib/sections';
import { requireList, requirePlan } from '@/lib/profile-route';
import { currentJob, startJob, stopJob } from '@/lib/tag-job-server';
import type { JobParams } from '@/lib/tag-jobs';
import { StepError } from '@/lib/tag-steps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


const state = (id: string, profile: string) => ({ job: currentJob(id), tags: deckTags(id), budget: currentBudget(profile, 'tagging') });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  return NextResponse.json(state(id, owned.profile));
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  // The tagger tags by the plan, so it waits for one.
  const locked = requirePlan(id);
  if (locked) return locked;
  let b: { kind?: unknown; instructions?: unknown; boards?: unknown; mode?: unknown; scope?: unknown; audit?: unknown; tagIds?: unknown; missingTag?: unknown; picked?: unknown };
  try {
    b = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (b.kind !== 'propose' && b.kind !== 'tag') return NextResponse.json({ error: 'Unknown kind' }, { status: 400 });
  const boards = Array.isArray(b.boards) ? b.boards.filter((x): x is Board => hasBoard(id, x)) : [];
  const job: JobParams = b.kind === 'propose'
    ? { kind: 'propose', boards: boards.length ? boards : ['main'], instructions: typeof b.instructions === 'string' ? b.instructions.slice(0, 4000) : '' }
    : {
      kind: 'tag',
      boards: boards.length ? boards : ['main'],
      mode: b.mode === 'smart' ? 'smart' : 'free',
      scope: b.scope === 'untagged' || b.scope === 'missing' || b.scope === 'picked' ? b.scope : 'all',
      audit: b.audit !== false,
      tagIds: Array.isArray(b.tagIds) ? b.tagIds.filter((x): x is string => typeof x === 'string').slice(0, 50) : undefined,
      missingTag: typeof b.missingTag === 'string' ? b.missingTag : undefined,
      picked: Array.isArray(b.picked) ? b.picked.filter((x): x is string => typeof x === 'string').slice(0, 300) : undefined,
      instructions: typeof b.instructions === 'string' ? b.instructions.slice(0, 2000) : '',
    };
  if (job.kind === 'tag' && job.scope === 'missing' && !job.missingTag) return NextResponse.json({ error: 'Pick the tag the cards should be missing' }, { status: 400 });
  if (job.kind === 'tag' && job.scope === 'picked' && !job.picked?.length) return NextResponse.json({ error: 'Pick some cards first' }, { status: 400 });
  try {
    startJob(owned.list, job, owned.profile);
  } catch (error) {
    if (error instanceof StepError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
  return NextResponse.json(state(id, owned.profile));
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  stopJob(id);
  // The job settles as stopped a moment later; the page keeps polling until it does.
  return NextResponse.json(state(id, owned.profile));
}
