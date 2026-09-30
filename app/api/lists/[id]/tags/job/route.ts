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
import { requireList } from '@/lib/profile-route';
import { currentJob, startJob, stopJob } from '@/lib/tag-job-server';
import type { JobParams } from '@/lib/tag-jobs';
import { StepError } from '@/lib/tag-steps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BOARDS = new Set<Board>(['main', 'side', 'maybe']);

const state = (id: string) => ({ job: currentJob(id), tags: deckTags(id), budget: currentBudget() });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  return NextResponse.json(state(id));
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  let b: { kind?: unknown; instructions?: unknown; boards?: unknown; mode?: unknown; scope?: unknown; audit?: unknown };
  try {
    b = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (b.kind !== 'propose' && b.kind !== 'tag') return NextResponse.json({ error: 'Unknown kind' }, { status: 400 });
  const boards = Array.isArray(b.boards) ? b.boards.filter((x): x is Board => BOARDS.has(x as Board)) : [];
  const job: JobParams = b.kind === 'propose'
    ? { kind: 'propose', boards: boards.length ? boards : ['main'], instructions: typeof b.instructions === 'string' ? b.instructions.slice(0, 4000) : '' }
    : {
      kind: 'tag',
      boards: boards.length ? boards : ['main'],
      mode: b.mode === 'smart' ? 'smart' : 'free',
      scope: b.scope === 'untagged' ? 'untagged' : 'all',
      audit: b.audit !== false,
    };
  try {
    startJob(owned.list, job);
  } catch (error) {
    if (error instanceof StepError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
  return NextResponse.json(state(id));
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  stopJob(id);
  // The job settles as stopped a moment later; the page keeps polling until it does.
  return NextResponse.json(state(id));
}
