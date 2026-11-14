/**
 * One chat. GET: the chat, and whether Claude is still replying.
 * PATCH {message, card: {id, name}}: a card name the answer marked that the app couldn't find, found by the owner's
 * hover (handoff 10, item 39): stored with the message so the next view links it at once.
 * PATCH {message, change, do?}: one proposal. do 'apply' makes it happen
 * (lib/chat-actions.ts), 'undo' takes it back; with no do, it is marked as
 * sent to Tune.
 * DELETE: forget the chat.
 */

import { NextResponse } from 'next/server';

import { applyChange, ChatActionRefused, undoChange, type Undo } from '@/lib/chat-actions';
import { deleteChat, getChat, saveChat, unreplace } from '@/lib/deck-chat';
import { storeCard } from '@/lib/db';
import { latestJob } from '@/lib/jobs';
import { getCard, imageOf } from '@/lib/scryfall';
import { foldName, markedIn } from '@/lib/card-lookup';
import { requireList } from '@/lib/profile-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; chatId: string }> };

export async function GET(request: Request, { params }: Ctx) {
  const { id, chatId } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const chat = getChat(id, chatId);
  if (!chat) return NextResponse.json({ error: 'No such chat' }, { status: 404 });
  const job = latestJob('chat', id);
  // Claude is replying when the last word is the owner's and the job runs.
  const waiting = chat.messages.at(-1)?.role === 'user';
  return NextResponse.json({
    chat,
    replying: waiting && job?.status === 'running',
    error: waiting && job && job.status !== 'running' ? job.error ?? 'The reply did not finish' : null,
  });
}

export async function PATCH(request: Request, { params }: Ctx) {
  const { id, chatId } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const chat = getChat(id, chatId);
  const body = await request.json().catch(() => ({})) as { message?: number; change?: number; do?: 'apply' | 'undo'; card?: { id?: unknown; name?: unknown } };
  if (body.card) {
    const at = body.message ?? -1;
    const m = chat?.messages[at];
    const name = typeof body.card.name === 'string' ? body.card.name.trim() : '';
    // Only a name this answer marked, and the card as the card data has it (not the page's word).
    if (!m || m.role !== 'assistant' || !name || !markedIn(m.text, name)) return NextResponse.json({ error: 'No such name in that answer' }, { status: 404 });
    // Not while Claude writes the next answer: its job saves the whole chat when it ends (review PR56, 15).
    if (chat!.messages.at(-1)?.role === 'user' && latestJob('chat', id)?.status === 'running') return NextResponse.json({ error: 'Claude is answering: look it up again when the answer is in' }, { status: 409 });
    const card = typeof body.card.id === 'string' ? await getCard(body.card.id).catch(() => null) : null;
    if (!card || foldName(card.name) !== foldName(name)) return NextResponse.json({ error: 'Couldn’t find this card' }, { status: 404 });
    storeCard(card);
    // After the outside lookup, read the chat again and change only that message's cards, in one synchronous step,
    // so an answer saved meanwhile is never written over with the old copy (review 15).
    const fresh = getChat(id, chatId);
    const fm = fresh?.messages[at];
    if (!fresh || !fm || fm.role !== 'assistant' || fm.text !== m.text) return NextResponse.json({ error: 'That answer changed' }, { status: 409 });
    if (!(fm.cards ?? []).some((c) => foldName(c.name) === foldName(card.name))) {
      fm.cards = [...(fm.cards ?? []), { name: card.name, id: card.id, image: imageOf(card, 'normal') }];
      if (fm.unresolved) fm.unresolved = Math.max(0, fm.unresolved - 1) || undefined;
      saveChat(fresh);
    }
    return NextResponse.json({ chat: fresh });
  }
  const change = chat?.messages[body.message ?? -1]?.changes?.[body.change ?? -1];
  if (!chat || !change) return NextResponse.json({ error: 'No such change' }, { status: 404 });
  try {
    // Chat's Apply stays open when the plan isn't confirmed, unlike Tune and Trim (requirePlan). The owner's
    // decision, 2026-11-12: "i would leave chat open because its like a direct question to the user who has to
    // accept it." Don't add the Tune lock here.
    if (body.do === 'apply') {
      if (change.applied) return NextResponse.json({ error: 'That is already applied' }, { status: 409 });
      if (change.replaced) return NextResponse.json({ error: 'A later answer replaced that one: apply the newer proposal instead' }, { status: 409 });
      change.applied = { at: new Date().toISOString(), undo: await applyChange(owned.list, owned.profile, change) };
    } else if (body.do === 'undo') {
      if (!change.applied) return NextResponse.json({ error: 'That isn’t applied' }, { status: 409 });
      await undoChange(owned.list, owned.profile, change.applied.undo as Undo);
      change.applied = null;
      unreplace(chat, body.message!, body.change!);
    } else change.done = true;
    // Applied now: a reason it couldn't be, written when Claude answered, no longer holds.
    if (change.applied) delete change.blocked;
  } catch (e) {
    if (e instanceof ChatActionRefused) {
      // The deck may have changed since the answer: the row says today's reason (or loses a stale one).
      if (body.do === 'apply' && (change.kind === 'add' || change.kind === 'swap')) { change.blocked = e.message; saveChat(chat); }
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
  saveChat(chat);
  return NextResponse.json({ chat });
}

export async function DELETE(request: Request, { params }: Ctx) {
  const { id, chatId } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  if (!deleteChat(id, chatId)) return NextResponse.json({ error: 'No such chat' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
