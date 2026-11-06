'use client';

/**
 * The deck's Chat tab: ask Claude about the deck - what to add, what to
 * cut, whether the plan holds. Every chat is saved. Claude looks things up
 * (Scryfall, your collection) and puts each change it recommends
 * on a button; nothing changes until you press one. Replies run in the
 * background, so the page can be left while Claude thinks.
 */

import Tip from './Tip';
import { useCallback, useEffect, useRef, useState } from 'react';

import AiModelPicker from './AiModelPicker';
import { AI_READS } from '@/lib/ai-reads';
import * as api from '@/lib/api';
import type { DeckChat as Chat } from '@/lib/deck-chat';
import type { ListedCard } from '@/lib/db';
import { modelLabel } from '@/lib/quota';

interface Props {
  listId: string;
  cards: ListedCard[];
  /** A question to start a new chat with, ready to send (from Tune). */
  question?: string;
}

const POLL_MS = 2_000;
const PROMPTS = ['What should I cut?', 'Suggest upgrades from my collection', 'Does the deck have enough ways to win?', 'Is the mana base right?'];
const when = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export default function DeckChat({ listId, cards, question = '' }: Props) {
  const [chats, setChats] = useState<api.ChatSummary[] | null>(() => api.peek<{ chats: api.ChatSummary[] }>(api.paths.chats(listId))?.chats ?? null);
  const [open, setOpen] = useState<string | null>(null);
  const [chat, setChat] = useState<Chat | null>(null);
  const [replying, setReplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState(question);
  const end = useRef<HTMLDivElement>(null);

  const loadList = useCallback(() => api.deckChats(listId).then((r) => setChats(r.chats)).catch(() => setChats([])), [listId]);
  useEffect(() => { void loadList(); }, [loadList]);

  // The open chat, and while Claude replies, a look every couple of seconds.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = () => api.deckChat(listId, open).then((r) => {
      if (cancelled) return;
      setChat(r.chat);
      setReplying(r.replying);
      setError(r.error);
      if (r.replying) timer = setTimeout(look, POLL_MS);
      else void loadList();
    }).catch(() => { if (!cancelled) timer = setTimeout(look, POLL_MS * 3); });
    look();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [listId, open, replying, loadList]);

  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [chat?.messages.length, replying]);

  const send = async (question = text) => {
    if (!question.trim() || replying) return;
    setError(null);
    try {
      const r = await api.askDeck(listId, question, open ?? undefined);
      setText('');
      setChat(r.chat);
      setOpen(r.chat.id);
      setReplying(true);
      void loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not ask that');
    }
  };

  // Claude's changes go to Tune, as swaps where an add and a cut pair up: they wait there with the rest.
  const sendToTune = async (m: number, only?: number) => {
    const changes = chat?.messages[m]?.changes ?? [];
    if (!chat) return;
    const open = changes.map((c, j) => ({ c, j })).filter(({ c, j }) => !c.done && c.cardId && (only === undefined || j === only) && (c.kind === 'add' || inDeck.has(c.cardId)));
    if (!open.length) return;
    const card = (c: (typeof open)[number]['c']) => ({ id: c.cardId!, name: c.name, cmc: 0, manaCost: '', typeLine: '', image: null, where: c.held ?? null, price: c.price ?? null, quantity: 1 });
    const adds = open.filter(({ c }) => c.kind === 'add');
    const cuts = open.filter(({ c }) => c.kind === 'cut');
    const items = [
      ...adds.map((a, k) => ({ key: `${chat.id}:${m}:${a.j}`, add: card(a.c), ...(cuts[k] ? { cut: card(cuts[k].c) } : {}), why: [a.c.why, cuts[k]?.c.why].filter(Boolean).join(' Out: ') })),
      ...cuts.slice(adds.length).map((x) => ({ key: `${chat.id}:${m}:${x.j}`, cut: card(x.c), why: x.c.why })),
    ];
    const intent = adds.length && cuts.length ? 'swaps' : adds.length ? 'find' : 'cuts';
    try {
      await api.tuneAct(listId, { action: 'propose', intent, title: `From Chat · ${items.length}`, why: `Claude proposed these in “${chat.title}”.`, items });
      let next = chat;
      for (const { j } of open) next = (await api.markChange(listId, chat.id, m, j)).chat;
      setChat(next);
      setSent((s) => ({ ...s, [`${m}`]: intent }));
      void loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send that to Tune');
    }
  };
  const [sent, setSent] = useState<Record<string, string>>({});

  const inDeck = new Set(cards.map((c) => c.card.id));

  return (
    <div className="mt-5 flex flex-wrap items-start gap-5">
      <aside data-tour="chat-list" className="flex min-w-0 flex-[1_1_15rem] flex-col gap-2">
        <button onClick={() => { setOpen(null); setChat(null); setError(null); }} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"><span aria-hidden className="text-base leading-none">＋</span> New chat</button>
        <p className="mt-1 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--faint)]" title="Chats are saved as you go">Chats</p>
        {chats?.length === 0 && <p className="px-3 text-sm text-[var(--faint)]">None yet - they&apos;re kept as you go.</p>}
        {chats?.map((c) => (
          <button
            key={c.id}
            data-tour-entry
            onClick={() => setOpen(c.id)}
            className={`rounded-xl border px-3 py-2 text-left ${open === c.id ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-hover)]'}`}
          >
            <span className="block truncate text-sm font-medium">{c.title}</span>
            <span className="block text-xs text-[var(--muted)]">
              {when(c.updatedAt)}{c.added || c.cut ? ` · ${c.added ? `${c.added} added` : ''}${c.added && c.cut ? ', ' : ''}${c.cut ? `${c.cut} cut` : ''}` : ''}
            </span>
          </button>
        ))}
      </aside>

      <section data-tour="chat-thread" className="flex min-w-0 flex-[999_1_34rem] flex-col gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/50 p-4">
        <AiModelPicker area="chat" align="right" />
        {!chat && (
          <div className="flex flex-col gap-2">
            <h3 className="font-display text-lg font-semibold">Ask about this deck</h3>
            <p className="text-sm text-[var(--muted)]">
              Claude knows the deck, its plan and your collection. What it suggests can be sent to Tune, where it waits with the other suggestions - nothing changes until you accept it there.
            </p>
          </div>
        )}
        {chat?.messages.map((m, i) => (
          m.role === 'user' ? (
            <p key={i} className="max-w-[85%] self-end whitespace-pre-wrap rounded-2xl rounded-br-md border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-3.5 py-2 text-sm">{m.text}</p>
          ) : (
            <div key={i} className="flex max-w-[95%] flex-col gap-2">
              {m.lookups && m.lookups.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {m.lookups.map((l) => <span key={l} className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--muted)]">{l}</span>)}
                </div>
              )}
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.text}</p>
              {m.changes?.map((c, j) => (
                <div key={j} className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                  <span className={`text-xs font-bold uppercase ${c.kind === 'add' ? 'text-emerald-400' : 'text-red-300'}`}>{c.kind}</span>
                  <div className="min-w-0 flex-[1_1_12rem]">
                    <p className="text-sm font-medium">
                      {c.name}
                      {c.kind === 'add' && (c.held ? <span className="ml-2 text-xs text-emerald-400">{c.held}</span> : c.price && <span className="ml-2 text-xs text-[var(--muted)]">${c.price}</span>)}
                    </p>
                    <p className="text-xs text-[var(--muted)]">{c.why}</p>
                  </div>
                  {c.done ? (
                    <span className="text-xs text-emerald-400">In Tune</span>
                  ) : !c.cardId || (c.kind === 'cut' && !inDeck.has(c.cardId)) ? (
                    <span className="text-xs text-[var(--muted)]">{c.kind === 'add' ? 'Card not found' : 'Not in the deck'}</span>
                  ) : (
                    <button onClick={() => sendToTune(i, j)} className="rounded-full border border-[var(--border)] px-3 py-1 text-sm hover:bg-[var(--surface-hover)]">
                      Send to Tune
                    </button>
                  )}
                </div>
              ))}
              {(m.changes?.filter((c) => !c.done && c.cardId).length ?? 0) > 1 && (
                <button onClick={() => sendToTune(i)} className="self-start rounded-full bg-[var(--accent)] px-3.5 py-1 text-sm font-semibold text-[#221c08]">
                  Send all {m.changes!.filter((c) => !c.done && c.cardId).length} to Tune
                </button>
              )}
              {sent[`${i}`] && <p className="text-xs text-[var(--muted)]">Waiting in Tune, under {sent[`${i}`] === 'swaps' ? 'Swaps & upgrades' : sent[`${i}`] === 'find' ? 'Find cards' : 'Cuts'}: nothing changes until you accept them there.</p>}
              {m.model && <p className="text-[11px] text-[var(--faint,var(--muted))]">{modelLabel(m.model).replace(/^Claude /, '')}</p>}
            </div>
          )
        ))}
        {replying && (
          <div className="flex flex-col gap-1.5">
            <p className="text-sm text-[var(--muted)]">Claude is looking into it… you can leave this page.</p>
            <div className="h-1 w-40 overflow-hidden rounded-full bg-[var(--border)]"><div className="id-grad h-full w-1/3 animate-[slide_1.6s_ease-in-out_infinite] rounded-full motion-reduce:animate-none" /></div>
          </div>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div ref={end} />

        {!replying && (
          <div className="flex flex-wrap gap-2">
            {PROMPTS.map((p) => (
              <button key={p} onClick={() => send(p)} className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs text-[var(--muted)] hover:text-[var(--foreground)]">{p}</button>
            ))}
          </div>
        )}
        {/* The composer stays at the bottom of the screen as the thread grows, as on Rules. */}
        <form data-tour="chat-composer" onSubmit={(e) => { e.preventDefault(); void send(); }} className="sticky bottom-[calc(var(--nav-h,0px)+5.5rem)] z-20 flex items-end gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-xl lg:bottom-4">
          <label htmlFor={`ask-${listId}`} className="sr-only">Ask about this deck</label>
          <textarea
            id={`ask-${listId}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
            rows={2}
            maxLength={4000}
            placeholder={chat ? 'Ask a follow-up…' : 'Ask about this deck…'}
            className="min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none"
          />
          <span className="self-center"><Tip label="What Claude reads"><span className="font-semibold">What Claude reads:</span><ul className="mt-1 list-disc pl-4">{AI_READS.chat.map((x) => <li key={x}>{x}</li>)}</ul></Tip></span>
          <button type="submit" disabled={replying || !text.trim()} className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[#221c08] disabled:opacity-50">Send</button>
        </form>
      </section>
    </div>
  );
}
