/**
 * The model's steps in tagging a deck, one request each so the page can
 * show progress and a slow or refused call costs one batch, not the run:
 *
 *   {step: 'propose', instructions}   suggest tags for the owner to review
 *   {step: 'assign', keys}            tag these cards by the accepted tags
 *   {step: 'audit', tagIds}           recheck these tags across the whole deck
 *
 * `boards` (default main) says which of the deck's cards count. Every step
 * answers with the deck's tags as they now stand.
 */

import { NextResponse } from 'next/server';

import { ModelError, taggingModel } from '@/lib/ai';
import { applyModelAudit, applyModelTags, deckTags, replaceProposals } from '@/lib/db';
import type { Board } from '@/lib/decklist';
import { requireList } from '@/lib/profile-route';
import { taggingDeck } from '@/lib/tag-deck';
import {
  ASSIGN_SCHEMA, ASSIGN_SYSTEM, assignMessage, AUDIT_SCHEMA, AUDIT_SYSTEM, auditMessage,
  parseAssignments, parseAudit, parseProposals, PROPOSE_SCHEMA, PROPOSE_SYSTEM, proposeMessage,
} from '@/lib/tagging';
import { nextColor } from '@/lib/tags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BOARDS = new Set<Board>(['main', 'side', 'maybe']);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  let b: { step?: unknown; instructions?: unknown; keys?: unknown; tagIds?: unknown; boards?: unknown };
  try {
    b = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const model = taggingModel();
  if (!model) return NextResponse.json({ error: 'No GEMINI_API_KEY is set on the server, so the model is off' }, { status: 503 });

  const boards = Array.isArray(b.boards) ? b.boards.filter((x): x is Board => BOARDS.has(x as Board)) : [];
  const deck = taggingDeck(owned.list, boards.length ? boards : ['main']);
  if (!deck.cards.length) return NextResponse.json({ error: 'The deck has no cards to tag' }, { status: 400 });
  const current = deckTags(id);
  const accepted = current.tags.filter((t) => t.status === 'accepted');
  const context = { commander: owned.list.commander, cards: deck.cards, brief: current.brief };

  try {
    if (b.step === 'propose') {
      const instructions = typeof b.instructions === 'string' ? b.instructions.slice(0, 4000) : '';
      const input = { ...context, instructions, accepted, rejected: current.tags.filter((t) => t.status === 'rejected') };
      const answer = await model({ system: PROPOSE_SYSTEM, user: proposeMessage(input), schema: PROPOSE_SCHEMA, temperature: 0.4 });
      const { overview, tags } = parseProposals(answer, deck.cards, current.tags.filter((t) => t.status !== 'proposed'));
      if (!tags.length) return NextResponse.json({ error: 'The model suggested nothing new - try different instructions' }, { status: 502 });
      const used = current.tags.filter((t) => t.status === 'accepted').map((t) => t.color);
      replaceProposals(id, overview, tags.map((t) => {
        const color = nextColor(used);
        used.push(color);
        return { ...t, color };
      }));
      return NextResponse.json({ ...deckTags(id), proposed: tags.length });
    }

    if (!accepted.length) return NextResponse.json({ error: 'Accept some tags first' }, { status: 400 });

    if (b.step === 'assign') {
      const keys = Array.isArray(b.keys) ? b.keys.filter((k): k is string => typeof k === 'string') : [];
      const batch = keys.map((k) => deck.refOf.get(k)).filter((r): r is string => !!r);
      if (!batch.length) return NextResponse.json({ error: 'None of those cards are in the deck' }, { status: 400 });
      const input = { ...context, tags: accepted, batch };
      const answer = await model({ system: ASSIGN_SYSTEM, user: assignMessage(input), schema: ASSIGN_SCHEMA });
      const { assignments, answered } = parseAssignments(answer, accepted, batch);
      // Only cards the model answered for lose their old model tags; a card it
      // skipped keeps what it had rather than being wiped.
      const added = applyModelTags(id, answered.map((r) => deck.keyOf.get(r)!),
        assignments.map((a) => ({ ...a, key: deck.keyOf.get(a.key)! })));
      return NextResponse.json({ ...deckTags(id), tagged: answered.length, skipped: batch.length - answered.length, added });
    }

    if (b.step === 'audit') {
      const ids = Array.isArray(b.tagIds) ? b.tagIds.filter((t): t is string => typeof t === 'string') : [];
      const checking = accepted.filter((t) => ids.includes(t.id)).map((t) => t.id);
      if (!checking.length) return NextResponse.json({ error: 'None of those tags are accepted' }, { status: 400 });
      const members = new Map<string, Array<{ key: string; manual: boolean }>>();
      for (const link of current.cardTags) {
        const ref = deck.refOf.get(link.key);
        if (!link.on || !ref || !checking.includes(link.tagId)) continue;
        members.set(link.tagId, [...(members.get(link.tagId) ?? []), { key: ref, manual: link.source === 'manual' }]);
      }
      // A card the owner took a tag off is not the model's to put back.
      const blocked = new Set(current.cardTags.filter((l) => !l.on).map((l) => `${l.key}:${l.tagId}`));
      const input = { ...context, tags: accepted, checking, members };
      const answer = await model({ system: AUDIT_SYSTEM, user: auditMessage(input), schema: AUDIT_SCHEMA });
      const changes = parseAudit(answer, input)
        .map((c) => ({ ...c, key: deck.keyOf.get(c.key)! }))
        .filter((c) => !blocked.has(`${c.key}:${c.tagId}`));
      const result = applyModelAudit(id, changes);
      return NextResponse.json({ ...deckTags(id), ...result });
    }

    return NextResponse.json({ error: 'Unknown step' }, { status: 400 });
  } catch (error) {
    if (error instanceof ModelError) return NextResponse.json({ error: `The model failed: ${error.message}` }, { status: 502 });
    console.error('[tags] model step failed', error);
    return NextResponse.json({ error: 'Could not run that step' }, { status: 500 });
  }
}
