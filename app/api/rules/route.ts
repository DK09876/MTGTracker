/**
 * Rules questions - see lib/rules.
 *
 *   GET                                   the profile's conversations, and today's model requests
 *   GET    ?id=                           one conversation
 *   POST   {question, threadId?, picks?}  ask; answers the conversation, or which cards were meant
 *   PATCH  {id, title?, starred?}         rename, save (star) or unsave
 *   DELETE ?id=                           forget a conversation
 */

import { NextResponse } from 'next/server';

import { currentBudget, ModelError, modelFor, resolveMode } from '@/lib/ai';
import {
  addRulesTurn, deleteRulesThread, rulesThread, rulesThreads, startRulesThread, updateRulesThread,
} from '@/lib/db';
import { requireProfile } from '@/lib/profile-route';
import { askRules } from '@/lib/rules/ask';
import { cardNames, cardRulings, rulesIndex, wikiPage } from '@/lib/rules/sources';
import { cardsNamed, imageOf, ScryfallError } from '@/lib/scryfall';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  const id = new URL(request.url).searchParams.get('id');
  if (id) {
    const thread = rulesThread(who.profile, id);
    return thread ? NextResponse.json({ thread }) : NextResponse.json({ error: 'No such conversation' }, { status: 404 });
  }
  return NextResponse.json({ threads: rulesThreads(who.profile), budget: currentBudget() });
}

export async function POST(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  const b = await request.json().catch(() => ({})) as { question?: unknown; threadId?: unknown; picks?: unknown; smarter?: unknown; secondCheck?: unknown };
  const question = typeof b.question === 'string' ? b.question.trim().slice(0, 600) : '';
  if (!question) return NextResponse.json({ error: 'Ask a question' }, { status: 400 });
  const threadId = typeof b.threadId === 'string' ? b.threadId : null;
  const earlier = threadId ? rulesThread(who.profile, threadId)?.turns ?? null : [];
  if (earlier === null) return NextResponse.json({ error: 'No such conversation' }, { status: 404 });
  const picks = b.picks && typeof b.picks === 'object'
    ? Object.fromEntries(Object.entries(b.picks as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as Record<string, string>
    : {};

  // Smarter only while the smarter model has been answering (lib/ai.ts).
  const model = modelFor(resolveMode(b.smarter));
  if (!model) return NextResponse.json({ error: 'No GEMINI_API_KEY is set on the server, so rules answers are off' }, { status: 503 });
  try {
    const result = await askRules({ question, earlier, picks, secondCheck: b.secondCheck === true }, {
      rules: rulesIndex, names: cardNames, cards: cardsNamed, rulings: cardRulings, wiki: wikiPage, model,
    }, { maxBusy: 1 });
    if ('choice' in result) {
      // Pictures of the options, to pick by.
      const cards = await cardsNamed(result.choice.flatMap((c) => c.options)).catch(() => []);
      const picture = new Map(cards.map((c) => [c.name, imageOf(c, 'normal')]));
      return NextResponse.json({
        choice: result.choice.map((c) => ({ mention: c.mention, options: c.options.map((name) => ({ name, image: picture.get(name) ?? null })) })),
      });
    }
    const id = threadId ?? startRulesThread(who.profile, result.turn);
    if (threadId) addRulesTurn(who.profile, threadId, result.turn);
    return NextResponse.json({ thread: rulesThread(who.profile, id), budget: currentBudget() });
  } catch (error) {
    if (error instanceof ModelError) {
      return NextResponse.json({ error: `The model failed: ${error.message}`, budget: currentBudget() }, { status: 502 });
    }
    if (error instanceof ScryfallError) return NextResponse.json({ error: error.message }, { status: 502 });
    console.error('[rules] ask failed', error);
    return NextResponse.json({ error: 'Could not answer that just now' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  const b = await request.json().catch(() => ({})) as { id?: unknown; title?: unknown; starred?: unknown };
  if (typeof b.id !== 'string') return NextResponse.json({ error: 'id required' }, { status: 400 });
  const title = typeof b.title === 'string' ? b.title.trim().replace(/\s+/g, ' ').slice(0, 120) || undefined : undefined;
  const starred = typeof b.starred === 'boolean' ? b.starred : undefined;
  if (!updateRulesThread(who.profile, b.id, { title, starred })) return NextResponse.json({ error: 'No such conversation' }, { status: 404 });
  return NextResponse.json({ thread: rulesThread(who.profile, b.id), threads: rulesThreads(who.profile) });
}

export async function DELETE(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  const id = new URL(request.url).searchParams.get('id');
  if (id) deleteRulesThread(who.profile, id);
  return NextResponse.json({ threads: rulesThreads(who.profile) });
}
