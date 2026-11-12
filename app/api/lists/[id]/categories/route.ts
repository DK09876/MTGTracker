/**
 * A deck's categories (lib/categories.ts): the Tags tab's rows, and the Plan
 * tab's ways to win and key cards, which are the same records.
 *
 * GET: the Tags tab (lib/tags-tab.ts): what is on the deck, and the
 * suggestions from the cards and from AI.
 * POST {action, ...}:
 *   add {name}                    the owner's own category
 *   remove {id}                   take one off (key cards only empty)
 *   card {id, name, on}           put a card in or take it out
 *   merge {id, into}              move one into another
 *   edit {id, name?, how?}        rename, or change its line
 *   accept {keys[]} / skip {key}  suggestions on the Tags tab
 *   refresh                       bring back what was skipped in step 1
 *   ai                            refine with AI (Opus, in the background)
 */

import { NextResponse } from 'next/server';

import { modelById, ModelError } from '@/lib/ai';
import { startJob } from '@/lib/jobs';
import { isConfirmed } from '@/lib/plan-help';
import { requireList } from '@/lib/profile-route';
import { runTagsAi, TAGS_MODEL, tagsAct, tagsTab, TagsRefused } from '@/lib/tags-tab';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  return NextResponse.json(await tagsTab(owned.list, owned.profile));
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const b = await request.json().catch(() => ({})) as Record<string, unknown>;
  const { list, profile } = owned;
  if (b.action === 'ai') {
    if (!isConfirmed(id)) return NextResponse.json({ error: 'AI reads your confirmed plan, so confirm the plan first.' }, { status: 400 });
    const model = modelById(TAGS_MODEL, [], { profile, feature: 'tagging', label: list.name });
    if (!model) return NextResponse.json({ error: 'No Claude key is set on the server. Step 1 works without one.' }, { status: 503 });
    startJob({ kind: 'tagsai', label: 'Refining tags with AI', subject: list.name, profileId: profile, listId: id, errorLevel: (e) => (e instanceof ModelError ? 'warn' : 'error') },
      async ({ progress }) => { const run = await runTagsAi(model, list, profile, progress); return { runId: run.id }; });
    return NextResponse.json(await tagsTab(list, profile));
  }
  try {
    await tagsAct(owned.list, owned.profile, b);
  } catch (e) {
    if (e instanceof TagsRefused) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  return NextResponse.json(await tagsTab(owned.list, owned.profile));
}
