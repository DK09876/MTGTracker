/**
 * A deck's reads - how it wins and what it needs.
 *
 * GET: the waiting draft, the saved reads (each with the cards in and out
 * since, and how its routes compare with the newest read), and the read
 * job if one is running.
 * POST {mode}: start a read in the background - 'quick' from the cards
 * alone, or the model's 'scratch', 'build' or 'check'. Answers the job.
 * PATCH {id, saved}: keep a read or let it go back to being the draft.
 * DELETE ?read=: drop one.
 */

import { NextResponse } from 'next/server';

import { appModel, ModelError } from '@/lib/ai';
import { cachedRoles, cardsInList, saveRoles, type List } from '@/lib/db';
import { latestJob, startJob } from '@/lib/jobs';
import { requireList } from '@/lib/profile-route';
import { addRead, cardChange, compareReads, deleteRead, readsFor, setSaved, type ReadMode } from '@/lib/reads';
import { countRoles } from '@/lib/roles';
import { ScryfallError, searchCards } from '@/lib/scryfall';
import { combosInDeck } from '@/lib/spellbook';
import { briefStep, StepError } from '@/lib/tag-steps';
import { guessWinRoutes } from '@/lib/wincons';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MODES: ReadMode[] = ['quick', 'scratch', 'build', 'check'];
const LABELS: Record<ReadMode, string> = {
  quick: 'Quick read', scratch: 'Drafting the brief', build: 'Building on the brief', check: 'Checking the brief',
};

const mainNames = (listId: string) => cardsInList(listId).filter((c) => c.board === 'main').map((c) => c.card.name);

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const { draft, saved } = readsFor(id);
  const now = mainNames(id);
  const newest = draft ?? saved[0] ?? null;
  const job = latestJob('brief', id);
  return NextResponse.json({
    draft,
    saved: saved.map((r) => ({
      ...r,
      since: cardChange(r.cards, now),
      against: newest && newest.id !== r.id ? compareReads(r, newest) : null,
    })),
    job: job && (job.status === 'running' || job.status === 'failed' || job.status === 'interrupted') ? job : null,
  });
}

async function quickRead(list: List) {
  const main = cardsInList(list.id).filter((c) => c.board === 'main');
  const [roles, combos] = await Promise.all([
    countRoles(main, { search: (q) => searchCards(q), cached: cachedRoles, save: saveRoles }),
    combosInDeck({ commanders: list.commander ? [list.commander.name] : [], main: main.map((c) => ({ name: c.card.name, quantity: c.quantity })) }).catch(() => null),
  ]);
  const guess = guessWinRoutes({ cards: [...main, ...(list.commander ? [{ card: list.commander, quantity: 1 }] : [])], roles, combos: combos?.included ?? null });
  return {
    model: null,
    winConditions: guess.routes.map((r) => ({ how: r.how, cards: r.cards, label: r.label, strength: r.strength })),
    missing: guess.missing,
    brief: '',
  };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const { list, profile } = owned;
  const body = await request.json().catch(() => ({})) as { mode?: string };
  const mode = MODES.find((m) => m === body.mode) ?? 'build';

  const model = mode === 'quick' ? null : appModel(profile, 'tagging', list.name);
  if (mode !== 'quick' && !model) return NextResponse.json({ error: 'No model API key is set on the server' }, { status: 503 });

  const job = startJob({
    kind: 'brief', label: LABELS[mode], subject: list.name, profileId: profile, listId: id,
    // A busy model or a slow Scryfall is worth a retry, not a banner.
    errorLevel: (e) => (e instanceof ModelError || e instanceof StepError || e instanceof ScryfallError ? 'warn' : 'error'),
  }, async ({ progress }) => {
    progress(mode === 'quick' ? 'Reading roles and combos' : 'The model is reading the deck');
    const found = mode === 'quick' ? await quickRead(list) : await briefStep(model!, { list, boards: ['main'] }, { maxBusy: 1 }, mode);
    const read = addRead({ listId: id, profileId: profile, mode, model: found.model, winConditions: found.winConditions, missing: found.missing, brief: found.brief, cards: mainNames(id) });
    return { readId: read.id };
  });
  return NextResponse.json({ job });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const body = await request.json().catch(() => ({})) as { id?: string; saved?: boolean };
  if (!body.id || typeof body.saved !== 'boolean' || !setSaved(id, body.id, body.saved)) {
    return NextResponse.json({ error: 'No such read' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const readId = new URL(request.url).searchParams.get('read');
  if (!readId || !deleteRead(id, readId)) return NextResponse.json({ error: 'No such read' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
