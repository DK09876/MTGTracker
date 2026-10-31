/**
 * POST: draft the deck's brief with the model - how the deck wins (or that
 * it does not, and what it needs), then its plan. One request, charged to
 * the profile. Nothing is saved: the page puts the draft in the brief box.
 */

import { NextResponse } from 'next/server';

import { appModel, ModelError } from '@/lib/ai';
import { requireList } from '@/lib/profile-route';
import { briefStep, StepError } from '@/lib/tag-steps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const model = appModel(owned.profile, 'tagging', owned.list.name);
  if (!model) return NextResponse.json({ error: 'No model API key is set on the server' }, { status: 503 });
  try {
    return NextResponse.json(await briefStep(model, { list: owned.list, boards: ['main'] }, { maxBusy: 1 }));
  } catch (error) {
    if (error instanceof ModelError || error instanceof StepError) {
      return NextResponse.json({ error: `Could not draft it: ${error.message}` }, { status: 502 });
    }
    throw error;
  }
}
