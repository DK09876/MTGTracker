/**
 * The Plan tab (lib/plan-help.ts).
 *
 * GET: what the tab shows - the owner's settings, how the deck wins, ways to
 * win and key cards, the last AI run's open suggestions and questions,
 * whether the plan is confirmed.
 * POST {action, ...}: one change (see PlanAction in lib/plan-help-shared.ts).
 *   run      ask the AI helper in the background (Opus); 503 with no Claude key
 *   confirm  refused (400) while a suggestion or question is open
 * Answers the new state.
 */

import { NextResponse } from 'next/server';

import { modelById, ModelError } from '@/lib/ai';
import { startJob } from '@/lib/jobs';
import { act, HELP_MODEL, planState, PlanRefused, runHelp } from '@/lib/plan-help';
import type { PlanAction } from '@/lib/plan-help-shared';
import { requireList } from '@/lib/profile-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  return NextResponse.json(await planState(owned.list, owned.profile));
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const { list, profile } = owned;
  const b = await request.json().catch(() => ({})) as PlanAction;
  if (b.action === 'run') {
    const model = modelById(HELP_MODEL, [], { profile, feature: 'tagging', label: list.name });
    if (!model) return NextResponse.json({ error: 'No Claude key is set on the server. Everything else on this page works without one.' }, { status: 503 });
    startJob({ kind: 'planhelp', label: 'AI plan suggestions', subject: list.name, profileId: profile, listId: id, errorLevel: (e) => (e instanceof ModelError ? 'warn' : 'error') },
      async ({ progress }) => { const help = await runHelp(model, list, profile, progress); return { helpId: help.id }; });
  } else {
    try {
      await act(list, profile, b);
    } catch (e) {
      if (e instanceof PlanRefused) return NextResponse.json({ error: e.message }, { status: 400 });
      throw e;
    }
  }
  return NextResponse.json(await planState(list, profile));
}
