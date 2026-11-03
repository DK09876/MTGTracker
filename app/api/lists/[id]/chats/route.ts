/**
 * A deck's chats. GET: every chat, newest first. POST {text, chatId?}: ask
 * a question - in that chat, or a new one - and start Claude's reply in
 * the background. Answers the chat and the job.
 */

import { NextResponse } from 'next/server';

import { chatsFor, getChat } from '@/lib/deck-chat';
import { ask, ChatError } from '@/lib/deck-chat-server';
import { requireList } from '@/lib/profile-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  return NextResponse.json({ chats: chatsFor(id) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const body = await request.json().catch(() => ({})) as { text?: string; chatId?: string };
  const text = (body.text ?? '').trim();
  if (!text) return NextResponse.json({ error: 'Ask something first' }, { status: 400 });
  const chat = body.chatId ? getChat(id, body.chatId) : null;
  if (body.chatId && !chat) return NextResponse.json({ error: 'No such chat' }, { status: 404 });
  try {
    return NextResponse.json(await ask(owned.list, owned.profile, text.slice(0, 4000), chat));
  } catch (error) {
    if (error instanceof ChatError) return NextResponse.json({ error: error.message }, { status: 503 });
    throw error;
  }
}
