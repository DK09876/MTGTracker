'use client';

/**
 * The deck's Chat tab: ask Claude about the deck - what to add, what to
 * cut, whether the plan holds. Every chat is saved. Claude looks things up
 * (Scryfall, your collection) and puts each change it suggests on its own
 * row: a cut, an add, a swap, a move to a section, a card into or out of a
 * group, never cut, a note, a way to win, a key card. Nothing changes until
 * you press Apply on it, and Undo takes it back. Adds and cuts can also go
 * to Tune instead. Replies run in the background, so the page can be left
 * while Claude thinks.
 */

import Tip from './Tip';
import { useCallback, useEffect, useRef, useState } from 'react';

import AiModelPicker from './AiModelPicker';
import CardName from './CardName';
import { AI_READS } from '@/lib/ai-reads';
import * as api from '@/lib/api';
import type { Change, DeckChat as Chat } from '@/lib/deck-chat';
import type { ScryfallCard } from '@/lib/scryfall';
import type { ListedCard } from '@/lib/db';
import { modelLabel } from '@/lib/quota';

interface Props {
  listId: string;
  cards: ListedCard[];
  /** A question to start a new chat with, ready to send (from Tune). */
  question?: string;
  /** After a proposal is applied or undone, the deck page reads the deck again. */
  onChanged?: () => Promise<void> | void;
  /** Open a card the way the card view does. */
  onCard?: (card: ScryfallCard) => void;
  commander?: ScryfallCard | null;
}

const KIND_LABEL: Record<Change['kind'], [string, string]> = {
  add: ['add', 'text-emerald-400'], cut: ['cut', 'text-red-300'], swap: ['swap', 'text-amber-300'], move: ['move', 'text-sky-300'],
  group: ['group', 'text-[#c4a6f5]'], ungroup: ['ungroup', 'text-[#c4a6f5]'], never: ['never cut', 'text-[#e2b93b]'],
  note: ['note', 'text-[var(--muted)]'], win: ['way to win', 'text-[#e2b93b]'], key: ['key card', 'text-[#e2b93b]'],
};

const POLL_MS = 2_000;
const PROMPTS = ['What should I cut?', 'Suggest upgrades from my collection', 'Does the deck have enough ways to win?', 'Is the mana base right?', 'Which cards belong in a group together?'];
const when = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export default function DeckChat({ listId, cards, question = '', onChanged, onCard, commander = null }: Props) {
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

  // One question at a time: a second tap while the first is on its way used to start a second chat and a second paid reply.
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const send = async (question = text) => {
    if (!question.trim() || replying || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
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
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  // Claude's changes go to Tune, as swaps where an add and a cut pair up: they wait there with the rest.
  const sendToTune = async (m: number, only?: number) => {
    const changes = chat?.messages[m]?.changes ?? [];
    if (!chat) return;
    const open = changes.map((c, j) => ({ c, j })).filter(({ c, j }) => !c.done && !c.applied && c.cardId && (only === undefined || j === only) && (c.kind === 'add' || (c.kind === 'cut' && inDeck.has(c.cardId))));
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
  const [doing, setDoing] = useState<string | null>(null);

  // Apply one proposal, or take it back; the deck page reads the deck again.
  const change = async (m: number, j: number, act: 'apply' | 'undo') => {
    if (!chat) return;
    setDoing(`${m}:${j}`);
    setError(null);
    try {
      setChat((await api.chatChange(listId, chat.id, m, j, act)).chat);
      await onChanged?.();
      void loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not do that');
    } finally {
      setDoing(null);
    }
  };
  const applyAll = async (m: number) => {
    const open = (chat?.messages[m]?.changes ?? []).map((c, j) => ({ c, j })).filter(({ c }) => !c.applied && !c.done && !c.blocked && !((c.kind === 'add' || c.kind === 'swap') && !c.cardId));
    for (const { j } of open) await change(m, j, 'apply');
  };
  const byName = (n: string) => { const f = n.split(' // ')[0].toLowerCase(); return cards.find((c) => c.card.name.split(' // ')[0].toLowerCase() === f)?.card ?? (commander && commander.name.split(' // ')[0].toLowerCase() === f ? commander : undefined); };
  const nm = (n: string) => <CardName name={n} card={byName(n)} onOpen={onCard} />;

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
              Claude knows the deck, its plan, its groups and your collection. It can suggest anything the other pages can do: a cut, an add, a swap, a move to a section, a card into a group, never cut, a note, a way to win. Each comes with its own Apply button, and nothing changes until you press it.
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
              {m.changes?.map((c, j) => {
                const busy = doing === `${i}:${j}`;
                const what = c.kind === 'swap' ? <>{nm(c.out?.name ?? '')} out, {nm(c.name)} in</>
                  : c.kind === 'move' ? <>{nm(c.name)} to {c.to}</>
                  : c.kind === 'group' ? <>{nm(c.name)} into {c.to}</>
                  : c.kind === 'ungroup' ? <>{nm(c.name)} out of {c.to}</>
                  : c.kind === 'note' ? <span className="font-normal">“{c.name}”</span>
                  : c.kind === 'win' ? <>{c.name}{c.cards?.length ? <span className="font-normal text-[var(--muted)]"> · {c.cards.map((x, k) => <span key={x}>{k ? ', ' : ''}{nm(x)}</span>)}</span> : null}</>
                  : <>{nm(c.name)}{(c.kind === 'cut' || c.kind === 'add') && c.to ? <span className="font-normal text-[var(--muted)]"> to {c.to}</span> : null}</>;
                const unknown = (c.kind === 'add' || c.kind === 'swap') && !c.cardId;
                return (
                  <div key={j} className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2" data-chat-change={c.kind}>
                    <span className={`w-20 shrink-0 text-xs font-bold uppercase ${KIND_LABEL[c.kind][1]}`}>{KIND_LABEL[c.kind][0]}</span>
                    <div className="min-w-0 flex-[1_1_12rem]">
                      <p className="text-sm font-medium">
                        {what}
                        {(c.kind === 'add' || c.kind === 'swap') && (c.held ? <span className="ml-2 text-xs text-emerald-400">{c.held}</span> : c.price && <span className="ml-2 text-xs text-[var(--muted)]">${c.price}</span>)}
                      </p>
                      {c.why && <p className="text-xs text-[var(--muted)]">{c.why}</p>}
                    </div>
                    {c.applied ? (
                      <span className="flex items-center gap-2"><span className="text-xs text-emerald-400">Applied</span>
                        <button onClick={() => change(i, j, 'undo')} disabled={busy} className="rounded-full border border-[var(--border)] px-3 py-1 text-sm hover:bg-[var(--surface-hover)] disabled:opacity-50">Undo</button></span>
                    ) : c.done ? (
                      <span className="text-xs text-emerald-400">In Tune</span>
                    ) : unknown ? (
                      <span className="text-xs text-[var(--muted)]">Card not found</span>
                    ) : c.blocked ? (
                      <span className="flex max-w-[18rem] items-center gap-2" data-blocked>
                        <span className="text-xs text-amber-300">{c.blocked}</span>
                        <button disabled className="rounded-full border border-[var(--border)] px-3 py-1 text-sm opacity-40">Apply</button>
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <button onClick={() => change(i, j, 'apply')} disabled={busy} aria-label={`Apply: ${KIND_LABEL[c.kind][0]} ${c.kind === 'swap' ? `${c.out?.name} for ${c.name}` : c.name}`}
                          className="rounded-full border border-[var(--border)] px-3 py-1 text-sm font-semibold hover:bg-[var(--surface-hover)] disabled:opacity-50">{busy ? 'Applying…' : 'Apply'}</button>
                        {(c.kind === 'add' || (c.kind === 'cut' && !!c.cardId && inDeck.has(c.cardId))) && (
                          <button onClick={() => sendToTune(i, j)} className="text-xs text-[var(--muted)] underline hover:text-[var(--foreground)]">or send to Tune</button>
                        )}
                      </span>
                    )}
                  </div>
                );
              })}
              {(m.changes?.filter((c) => !c.done && !c.applied && !c.blocked).length ?? 0) > 1 && (
                <button onClick={() => applyAll(i)} disabled={!!doing} className="self-start rounded-full bg-[var(--accent)] px-3.5 py-1 text-sm font-semibold text-[#221c08] disabled:opacity-50">
                  Apply all {m.changes!.filter((c) => !c.done && !c.applied && !c.blocked).length}
                </button>
              )}
              {sent[`${i}`] && <p className="text-xs text-[var(--muted)]">Waiting in Tune, under {sent[`${i}`] === 'swaps' ? 'Swaps' : sent[`${i}`] === 'find' ? 'Find cards' : 'Cuts'}: nothing changes until you accept them there.</p>}
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
        {/* Room between the last answer and the message box. */}
        <div ref={end} className="h-6 shrink-0" />

        {!replying && (
          <div className="flex flex-wrap gap-2">
            {PROMPTS.map((p) => (
              <button key={p} onClick={() => send(p)} disabled={sending} className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs text-[var(--muted)] hover:text-[var(--foreground)]">{p}</button>
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
          <button type="submit" disabled={replying || sending || !text.trim()} className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[#221c08] disabled:opacity-50">Send</button>
        </form>
      </section>
    </div>
  );
}
