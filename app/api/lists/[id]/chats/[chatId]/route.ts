/**
 * One chat. GET: the chat, and whether Claude is still replying.
 * PATCH {message, change}: mark a proposed change as applied.
 * DELETE: forget the chat.
 */

import { NextResponse } from 'next/server';

import { deleteChat, getChat, saveChat } from '@/lib/deck-chat';
import { latestJob } from '@/lib/jobs';
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
  const body = await request.json().catch(() => ({})) as { message?: number; change?: number };
  const change = chat?.messages[body.message ?? -1]?.changes?.[body.change ?? -1];
  if (!chat || !change) return NextResponse.json({ error: 'No such change' }, { status: 404 });
  change.done = true;
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
