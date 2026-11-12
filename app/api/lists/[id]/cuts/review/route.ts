/**
 * Claude's review of the cut list.
 *
 * GET: the last review, what the owner has done about it since (cut or
 * ★ kept), and the job if one is running.
 * Starting a new review is gone (2026-11-12): Trim and Tune's own steps
 * replaced it. Reviews already made still show in Tune.
 */

import { NextResponse } from 'next/server';

import { deckNames, lastReview, settled } from '@/lib/cut-review';
import { latestJob } from '@/lib/jobs';
import { requireList } from '@/lib/profile-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const job = latestJob('cutreview', id);
  const review = lastReview(id);
  const names = deckNames(id);
  return NextResponse.json({ review, settled: settled(review, names.main, names.kept), job: job && job.status !== 'done' ? job : null });
}
