/**
 * Claude's ideas for one Tune intent (lib/tune-claude.ts).
 *
 * GET ?intent=: the job if one is running for the deck.
 * POST {intent, instructions?, problem?}: start one in the background. It
 * waits for the deck's plan, and reads what the rules already suggest so
 * it doesn't repeat them. The ideas land in Tune's suggestions.
 */

import { NextResponse } from 'next/server';

import { appModel, ModelError } from '@/lib/ai';
import { latestJob, startJob } from '@/lib/jobs';
import { requireList, requirePlan } from '@/lib/profile-route';
import { tuneState } from '@/lib/tune';
import { tuneIdeas } from '@/lib/tune-claude';
import { INTENTS, SYMPTOMS, type Intent } from '@/lib/tune-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const job = latestJob('tuneideas', id);
  return NextResponse.json({ job: job && (job.status === 'running' || Date.now() - Date.parse(job.finishedAt ?? '') < 60_000) ? job : null });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const locked = requirePlan(id);
  if (locked) return locked;
  const { list, profile } = owned;
  const b = await request.json().catch(() => ({})) as { intent?: string; instructions?: string; problem?: string };
  const intent = INTENTS.find((i) => i.id === b.intent)?.id as Intent | undefined;
  if (!intent) return NextResponse.json({ error: 'Say what to tune' }, { status: 400 });
  const model = appModel(profile, 'tagging', list.name);
  if (!model) return NextResponse.json({ error: 'No model API key is set on the server' }, { status: 503 });
  const instructions = typeof b.instructions === 'string' ? b.instructions.slice(0, 2000) : '';
  const problem = SYMPTOMS.find((s) => s.id === b.problem)?.label;
  const job = startJob({
    kind: 'tuneideas', label: `Ideas from Claude: ${INTENTS.find((i) => i.id === intent)!.label.toLowerCase()}`, subject: list.name, profileId: profile, listId: id,
    errorLevel: (e) => (e instanceof ModelError ? 'warn' : 'error'),
  }, async ({ progress }) => {
    progress('Reading what the rules suggest');
    const state = await tuneState(list, profile, { intent, symptom: SYMPTOMS.find((s) => s.id === b.problem)?.id });
    const suggested = state.groups.filter((g) => g.source === 'rules').flatMap((g) => g.items.map((i) => [i.add ? `add ${i.add.name}` : '', i.cut ? `cut ${i.cut.name}` : ''].filter(Boolean).join(' for ')));
    progress('Claude is reading the plan and the deck');
    const group = await tuneIdeas(model, list, { intent, instructions, suggested, problem });
    return { ideas: group.items.length };
  });
  return NextResponse.json({ job });
}
