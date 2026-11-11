/**
 * The plan read (lib/plan-pass.ts) for one deck.
 *
 * GET: the Plan tab's view: what the commander does, the last read with the
 * owner's edits on top, its questions, whether it is confirmed or out of
 * date, and the read running now.
 * POST {action, ...}:
 *   generate {answers?, skipped?, note?}  save what the owner typed to their
 *       notes, then read the deck again in the background (Opus, never on its own)
 *   confirm {answers?, skipped?, note?}  the same notes, then confirm the plan; refused
 *       (400) while a question the read asked is neither answered nor skipped
 *   commanderRoles {roles}   what the commander does (Unsure stands alone)
 *   edits {edits}            the owner's edits; each part given is theirs. Card
 *                            names must be in the deck (400 names the ones that aren't)
 *   drafts {answers, skipped, note}  what's typed but not sent, kept as they type
 *   undoEdits                give every part back to the read
 *   ownPlan {text, fill?}    the owner writes the plan; fill: read the rest from it
 *   useStale                 use an out-of-date read anyway
 *   acceptCommander          take the read's suggestion for what the commander does
 *   acceptBracket            take the read's bracket, while the owner's is Unsure
 *   neverCut {add?, remove?} mark cards ★ never cut, or take the mark off, by name
 */

import { NextResponse } from 'next/server';

import { modelById, ModelError } from '@/lib/ai';
import { startJob } from '@/lib/jobs';
import {
  acceptBracketSuggestion, acceptCommanderSuggestion, confirmPlan, keepStalePlan, NotInDeck, PASS_MODEL, planView, runPass, saveDrafts, setCommanderRoles, setEdits, setNeverCut, takeOwnerInput, undoEdits, writeOwnPlan,
} from '@/lib/plan-pass';
import { requireList } from '@/lib/profile-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Input = { answers?: Array<{ question: string; answer: string }>; skipped?: string[]; note?: string };
const inputOf = (b: Record<string, unknown>): Input => ({
  answers: Array.isArray(b.answers) ? (b.answers as Input['answers'])!.filter((a) => a && typeof a.question === 'string' && typeof a.answer === 'string').slice(0, 3) : [],
  skipped: Array.isArray(b.skipped) ? (b.skipped as unknown[]).filter((s): s is string => typeof s === 'string').slice(0, 3) : [],
  note: typeof b.note === 'string' ? b.note.slice(0, 2000) : '',
});

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  return NextResponse.json(planView(owned.list));
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const { list, profile } = owned;
  const b = await request.json().catch(() => ({})) as Record<string, unknown>;
  const read = () => {
    const model = modelById(PASS_MODEL, [], { profile, feature: 'tagging', label: list.name });
    if (!model) return NextResponse.json({ error: 'No Claude key is set on the server, so the plan can’t be read. You can write it yourself.' }, { status: 503 });
    startJob({ kind: 'planpass', label: 'Reading the plan', subject: list.name, profileId: profile, listId: id, errorLevel: (e) => (e instanceof ModelError ? 'warn' : 'error') },
      async ({ progress }) => { const pass = await runPass(model, list, profile, progress); return { passId: pass.id }; });
    return null;
  };
  switch (b.action) {
    case 'generate': {
      takeOwnerInput(id, profile, inputOf(b));
      const refused = read();
      if (refused) return refused;
      break;
    }
    case 'confirm': {
      // Every question the read asked is answered or skipped first: confirming must not drop one unseen.
      const input = inputOf(b);
      const settled = new Set([...(input.answers ?? []).filter((a) => a.answer.trim()).map((a) => a.question), ...(input.skipped ?? [])]);
      const open = (planView(list).pass?.questions ?? []).filter((q) => !settled.has(q));
      if (open.length) return NextResponse.json({ error: `Answer or skip ${open.length === 1 ? 'the question' : `the ${open.length} questions`} first`, open }, { status: 400 });
      takeOwnerInput(id, profile, input);
      confirmPlan(id);
      break;
    }
    case 'commanderRoles':
      setCommanderRoles(id, Array.isArray(b.roles) ? b.roles : []);
      break;
    case 'edits':
      try {
        setEdits(id, (b.edits ?? {}) as Parameters<typeof setEdits>[1], list);
      } catch (e) {
        if (e instanceof NotInDeck) return NextResponse.json({ error: e.message, names: e.names }, { status: 400 });
        throw e;
      }
      break;
    case 'drafts':
      saveDrafts(id, b);
      break;
    case 'undoEdits':
      undoEdits(id);
      break;
    case 'ownPlan': {
      const text = typeof b.text === 'string' ? b.text.trim() : '';
      if (!text) return NextResponse.json({ error: 'Write a sentence or two first' }, { status: 400 });
      writeOwnPlan(id, text);
      if (b.fill === true) { const refused = read(); if (refused) return refused; }
      break;
    }
    case 'useStale':
      keepStalePlan(id);
      break;
    case 'acceptCommander':
      acceptCommanderSuggestion(id);
      break;
    case 'acceptBracket':
      acceptBracketSuggestion(id);
      break;
    case 'neverCut':
      setNeverCut(list, { add: b.add, remove: b.remove });
      break;
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
  return NextResponse.json(planView(list));
}
