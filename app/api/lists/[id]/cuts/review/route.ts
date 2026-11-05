/**
 * Claude's review of the cut list.
 *
 * GET: the last review, what the owner has done about it since (cut or
 * ★ kept), and the job if one is running.
 * POST {instructions?, mode?}: start one in the background - 'top' (the
 * list's top, about twice what the deck is over) or 'whole' (every card, in
 * tiers). It waits for the deck's plan, which it reads, and is told what
 * the last review said and what the owner did since.
 */

import { NextResponse } from 'next/server';

import { appModel, ModelError } from '@/lib/ai';
import { deckCutList } from '@/lib/cut-list';
import { deckNames, lastReview, reviewCuts, reviewSize, saveReview, settled, type CutReview, type ReviewMode } from '@/lib/cut-review';
import { latestJob, startJob } from '@/lib/jobs';
import { requireList, requirePlan } from '@/lib/profile-route';

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

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const locked = requirePlan(id);
  if (locked) return locked;
  const { list, profile } = owned;
  const body = await request.json().catch(() => ({})) as { instructions?: string; mode?: string };
  const instructions = typeof body.instructions === 'string' ? body.instructions.slice(0, 2000) : '';
  const mode: ReviewMode = body.mode === 'whole' ? 'whole' : 'top';
  const model = appModel(profile, 'tagging', list.name);
  if (!model) return NextResponse.json({ error: 'No model API key is set on the server' }, { status: 503 });

  const job = startJob({
    kind: 'cutreview', label: mode === 'whole' ? 'Rating the whole deck' : 'Reviewing the cuts', subject: list.name, profileId: profile, listId: id,
    errorLevel: (e) => (e instanceof ModelError ? 'warn' : 'error'),
  }, async ({ progress }) => {
    progress('Ranking the cuts by your rules');
    const cut = await deckCutList(list);
    const over = cut.health.size - 100;
    const byId = new Map([...cut.main.map((c) => [c.card.id, c.card] as const)]);
    const top = cut.candidates.slice(0, mode === 'whole' ? cut.candidates.length : reviewSize(over))
      .filter((c) => byId.has(c.cardId)).map((c) => ({ ...c, card: byId.get(c.cardId)! }));
    // Every card once, the commander aside (it is never cut).
    const cards = [...new Map(cut.main.filter((c) => c.card.id !== list.commander?.id).map((c) => [c.card.name, c.card])).values()];
    const on = cut.tags.cardTags.filter((t) => t.on);
    const before = lastReview(id);
    const names = deckNames(id);
    progress(mode === 'whole' ? `Claude is rating all ${cards.length} cards against the plan` : `Claude is reading the plan and the top ${top.length}`);
    const found = await reviewCuts(model, {
      commander: list.commander,
      brief: cut.tags.brief,
      styles: cut.styles.map((s) => s.label),
      tags: cut.tags.tags.filter((t) => t.status === 'accepted').map((t) => ({ name: t.name, description: t.description, cards: on.filter((x) => x.tagId === t.id).map((x) => x.key) })),
      candidates: top,
      over,
      instructions,
      mode,
      cards: mode === 'whole' ? cards : undefined,
      previous: before ? { at: before.at, items: before.items, ...settled(before, names.main, names.kept) } : null,
    });
    const review: CutReview = { at: new Date().toISOString(), model: found.model, instructions, over, items: found.items, mode };
    saveReview(id, review);
    return { reviewed: found.items.length };
  });
  return NextResponse.json({ job });
}
