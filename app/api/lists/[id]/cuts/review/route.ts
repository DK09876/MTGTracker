/**
 * Claude's review of the cut list.
 *
 * GET: the last review, and the job if one is running.
 * POST {instructions?}: start one in the background. It waits for the
 * deck's plan, which it reads.
 */

import { NextResponse } from 'next/server';

import { appModel, ModelError } from '@/lib/ai';
import { deckCutList } from '@/lib/cut-list';
import { lastReview, REVIEW_SIZE, reviewCuts, saveReview } from '@/lib/cut-review';
import { latestJob, startJob } from '@/lib/jobs';
import { requireList, requirePlan } from '@/lib/profile-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const job = latestJob('cutreview', id);
  return NextResponse.json({ review: lastReview(id), job: job && job.status !== 'done' ? job : null });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const locked = requirePlan(id);
  if (locked) return locked;
  const { list, profile } = owned;
  const body = await request.json().catch(() => ({})) as { instructions?: string };
  const instructions = typeof body.instructions === 'string' ? body.instructions.slice(0, 2000) : '';
  const model = appModel(profile, 'tagging', list.name);
  if (!model) return NextResponse.json({ error: 'No model API key is set on the server' }, { status: 503 });

  const job = startJob({
    kind: 'cutreview', label: 'Reviewing the cuts', subject: list.name, profileId: profile, listId: id,
    errorLevel: (e) => (e instanceof ModelError ? 'warn' : 'error'),
  }, async ({ progress }) => {
    progress('Ranking the cuts by your rules');
    const cut = await deckCutList(list);
    const byId = new Map([...cut.main.map((c) => [c.card.id, c.card] as const)]);
    const top = cut.candidates.slice(0, REVIEW_SIZE).filter((c) => byId.has(c.cardId)).map((c) => ({ ...c, card: byId.get(c.cardId)! }));
    const on = cut.tags.cardTags.filter((t) => t.on);
    progress(`Claude is reading the plan and the top ${top.length}`);
    const found = await reviewCuts(model, {
      commander: list.commander,
      brief: cut.tags.brief,
      styles: cut.styles.map((s) => s.label),
      tags: cut.tags.tags.filter((t) => t.status === 'accepted').map((t) => ({ name: t.name, description: t.description, cards: on.filter((x) => x.tagId === t.id).map((x) => x.key) })),
      candidates: top,
      over: cut.health.size - 100,
      instructions,
    });
    saveReview(id, { at: new Date().toISOString(), model: found.model, instructions, over: cut.health.size - 100, items: found.items });
    return { reviewed: found.items.length };
  });
  return NextResponse.json({ job });
}
