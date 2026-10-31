'use client';

/**
 * Rules: ask how cards interact, or how a rule works, and get an answer drawn
 * from the official sources - each card's Oracle text and Wizards' rulings,
 * the Comprehensive Rules, and the MTG Wiki for mechanics - with each claim
 * numbered to the source it rests on.
 *
 * Like search: a word that could be several cards ("kratos") is asked about
 * first, and so is anything the answer turns on that the question left open
 * ("whose turn is it?"); follow-ups carry the conversation's cards and the
 * last answer's working; every conversation is
 * kept (Recent), and can be starred to keep for good (Saved). Answers are
 * stored with their sources, so opening one again costs no model request.
 */

import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';

import HistoryPanel, { type HistoryEntry } from '@/components/HistoryPanel';
import RulesAnswer from '@/components/RulesAnswer';
import ModelLine from '@/components/ModelLine';
import { useSetting } from '@/lib/ai-settings';
import * as api from '@/lib/api';
import type { RulesThread, RulesThreadSummary } from '@/lib/db';
import { getProfile } from '@/lib/profile';
import type { Budget } from '@/lib/quota';
import { dollars } from '@/lib/spend';
import { dismissKeyboard, steady } from '@/lib/steady-tap';

// Starting points, by the kind of rule they turn on.
const EXAMPLES: Array<{ topic: string; question: string }> = [
  { topic: 'Triggers', question: 'Do "when a creature dies" abilities trigger when the whole board is wiped with Blasphemous Act?' },
  { topic: 'Copies', question: 'Does the legend rule apply to token copies?' },
  { topic: 'The stack', question: 'Can I respond to a spell that says it can\'t be countered?' },
  { topic: 'Combat', question: 'How does Blade of Selves interact with Kratos?' },
];

const input = 'w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-base outline-none focus:border-[var(--accent)]';
const button = 'min-h-10 rounded-full border border-[var(--border)] px-3 text-sm hover:bg-[var(--surface-hover)] disabled:opacity-50';
const primary = 'min-h-11 rounded-full btn-go px-5 font-semibold disabled:opacity-50';

const currentKey = () => `mtg-rules:${getProfile()}`;

export default function RulesPage() {
  const [threads, setThreads] = useState<RulesThreadSummary[]>([]);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [thread, setThread] = useState<RulesThread | null>(null);
  const [question, setQuestion] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Waiting on "which card did you mean?": the question, and the choices.
  const [choosing, setChoosing] = useState<{ question: string; choice: api.RulesChoice[]; picks: Record<string, string> } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  // Waiting on "before I answer...": the question, what was asked, and the answers so far.
  const [clarifying, setClarifying] = useState<{
    question: string; picks: Record<string, string>; items: api.RulesClarify[]; answers: Record<string, string>;
  } | null>(null);
  const [secondCheck, setSecondCheck] = useSetting('rules-second-check');

  const refresh = useCallback(() => api.rulesThreads().then((r) => { setThreads(r.threads); setBudget(r.budget); }).catch(() => {}), []);

  const open = useCallback(async (id: string | null) => {
    setError(null);
    setChoosing(null);
    setClarifying(null);
    try { if (id) localStorage.setItem(currentKey(), id); else localStorage.removeItem(currentKey()); } catch { /* not remembered */ }
    if (!id) { setThread(null); return; }
    try {
      setThread(await api.rulesThread(id));
      window.scrollTo(0, 0);
    } catch {
      setThread(null);
    }
  }, []);

  // On opening: the lists, and the conversation that was open.
  useEffect(() => {
    refresh();
    let id: string | null = null;
    try { id = localStorage.getItem(currentKey()); } catch { /* none */ }
    const timer = id ? setTimeout(() => open(id), 0) : undefined;
    return () => clearTimeout(timer);
  }, [refresh, open]);

  const ask = async (text: string, picks: Record<string, string> = {}, inThread = thread, clarifications: Array<{ question: string; answer: string }> = []) => {
    const q = text.trim();
    if (!q || busy) return;
    dismissKeyboard();
    setBusy(true);
    setError(null);
    try {
      // Never spin forever: the server gives up well before this.
      const r = await Promise.race([
        api.askRules(q, { threadId: inThread?.id, picks, secondCheck, clarifications }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('That took too long - try asking again')), 240_000)),
      ]);
      if (r.budget) setBudget(r.budget);
      if (r.choice) {
        setChoosing({ question: q, choice: r.choice, picks });
      } else if (r.clarify) {
        setChoosing(null);
        setClarifying({ question: q, picks, items: r.clarify, answers: {} });
      } else if (r.thread) {
        setChoosing(null);
        setClarifying(null);
        setThread(r.thread);
        setQuestion('');
        setFollowUp('');
        try { localStorage.setItem(currentKey(), r.thread.id); } catch { /* not remembered */ }
        refresh();
        // The new answer, at the bottom of the conversation.
        setTimeout(() => document.getElementById(`turn-${r.thread!.turns.length - 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not answer that');
    } finally {
      setBusy(false);
    }
  };

  const pick = (mention: string, name: string) => {
    if (!choosing) return;
    const picks = { ...choosing.picks, [mention]: name };
    const rest = choosing.choice.filter((c) => !picks[c.mention]);
    if (rest.length) setChoosing({ ...choosing, picks });
    else ask(choosing.question, picks);
  };

  const answerClarify = (assume = false) => {
    if (!clarifying) return;
    const clarifications = clarifying.items.map((c) => ({
      question: c.question,
      answer: assume || !clarifying.answers[c.question]?.trim() ? 'Not said - assume the usual case, and say so.' : clarifying.answers[c.question].trim(),
    }));
    ask(clarifying.question, clarifying.picks, thread, clarifications);
  };

  const star = async (t: RulesThread) => {
    const r = await api.updateRulesThread(t.id, { starred: !t.starred });
    setThread(r.thread);
    setThreads(r.threads);
  };
  const rename = async (t: RulesThread, title: string) => {
    const r = await api.updateRulesThread(t.id, { title });
    setThread(r.thread);
    setThreads(r.threads);
    setRenaming(null);
  };
  const forget = async (id: string) => {
    setThreads(await api.forgetRulesThread(id));
    if (thread?.id === id) open(null);
  };

  const left = budget?.remaining;

  // "Which card did you mean?" - shown where the question was asked: under the
  // question box, or above the follow-up box in a conversation.
  const choicePanel = choosing && !busy && (
        <section id="which-card" className="mt-5 flex scroll-mt-20 flex-col gap-5 rounded-2xl border border-[var(--accent)]/50 p-4" aria-label="Which card?">
          {choosing.choice.filter((c) => !choosing.picks[c.mention]).slice(0, 1).map((c) => (
            <div key={c.mention}>
              <h2 className="font-medium">Which {c.mention[0].toUpperCase() + c.mention.slice(1)} did you mean?</h2>
              <p className="text-sm text-[var(--muted)]">For: {choosing.question}</p>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {c.options.map((o) => (
                  <button key={o.name} {...steady(() => pick(c.mention, o.name))} className="flex flex-col gap-1 rounded-xl border border-[var(--border)] p-2 text-left text-sm hover:border-[var(--accent)]">
                    {o.image && <Image src={o.image} alt="" width={244} height={340} className="w-full rounded-lg" unoptimized />}
                    <span>{o.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <button onClick={() => setChoosing(null)} className={`${button} self-start`}>Cancel</button>
        </section>
        );
  // Bring it into view: it may appear far from where the Ask button was.
  useEffect(() => {
    if (choosing) setTimeout(() => document.getElementById('which-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  }, [choosing]);
  useEffect(() => {
    if (clarifying) setTimeout(() => document.getElementById('clarify')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  }, [clarifying]);

  // "Before I answer...": what the answer turns on that the question left open.
  const clarifyPanel = clarifying && !busy && (
    <section id="clarify" className="mt-5 flex scroll-mt-20 flex-col gap-4 rounded-2xl border border-[var(--accent)]/50 p-4" aria-label="Before I answer">
      <div>
        <h2 className="font-medium">Before I answer…</h2>
        <p className="text-sm text-[var(--muted)]">The answer depends on {clarifying.items.length === 1 ? 'this' : 'these'}. For: {clarifying.question}</p>
      </div>
      {clarifying.items.map((c) => {
        const value = clarifying.answers[c.question] ?? '';
        const set = (v: string) => setClarifying({ ...clarifying, answers: { ...clarifying.answers, [c.question]: v } });
        return (
          <div key={c.question} className="flex flex-col gap-2">
            <p className="text-sm">{c.question}</p>
            {c.options.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {c.options.map((o) => (
                  <button key={o} {...steady(() => set(o))} aria-pressed={value === o}
                    className={`rounded-lg border px-3 py-1.5 text-left text-sm ${value === o ? 'border-[var(--accent)] bg-[var(--surface)]' : 'border-[var(--border)] hover:border-[var(--accent)]'}`}>
                    {o}
                  </button>
                ))}
              </div>
            )}
            <input value={c.options.includes(value) ? '' : value} onChange={(e) => set(e.target.value)} placeholder="Or say it in your own words" aria-label={c.question} className={`${input} py-2 text-sm`} />
          </div>
        );
      })}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => answerClarify()} disabled={clarifying.items.some((c) => !clarifying.answers[c.question]?.trim())} className={primary}>Answer</button>
        <button onClick={() => answerClarify(true)} className={button}>Just assume the usual case</button>
        <button onClick={() => setClarifying(null)} className={button}>Cancel</button>
      </div>
    </section>
  );

  // What a question costs, under the box.
  const hint = budget?.spend
    ? `A few cents a question · ${dollars(budget.spend.left)} left for you today`
    : left !== undefined ? `${secondCheck ? 'Two AI requests' : 'One AI request'} a question · ${left} left today` : '';

  // The history panel: saved (starred) conversations, then recent ones.
  const history: HistoryEntry[] = threads.map((t) => ({
    id: t.id,
    title: t.title,
    meta: [t.questions > 1 ? `${t.questions} questions` : '', t.lastVerdict].filter(Boolean).join(' · '),
    at: t.updatedAt,
    saved: t.starred,
  }));
  const setStar = async (id: string, starred: boolean) => {
    const r = await api.updateRulesThread(id, { starred });
    setThreads(r.threads);
    if (thread?.id === id) setThread(r.thread);
  };
  const historyActions = {
    onOpen: (e: HistoryEntry) => { open(e.id); },
    onSave: (e: HistoryEntry) => { setStar(e.id, true).catch(() => {}); },
    onUnsave: (e: HistoryEntry) => { setStar(e.id, false).catch(() => {}); },
    onRename: (e: HistoryEntry, title: string) => {
      api.updateRulesThread(e.id, { title }).then((r) => { setThreads(r.threads); if (thread?.id === e.id) setThread(r.thread); }).catch(() => {});
    },
    onDelete: (e: HistoryEntry) => { forget(e.id).catch(() => {}); },
  };

  return (
    <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start lg:gap-8">
    <HistoryPanel label="Rules conversations" newLabel="New question" onNew={() => open(null)} entries={history} active={thread?.id ?? null} {...historyActions} />
    <div className="mx-auto w-full max-w-3xl">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="font-display text-3xl font-extrabold">Rules</h1>
        {thread && <button onClick={() => open(null)} className={`${button} lg:hidden`}>New question</button>}
      </div>
      {!thread && (
        <p className="mt-1 text-sm text-[var(--muted)]">
          Ask how cards interact. Every answer comes from the official rulings, the Comprehensive Rules and the MTG Wiki, and links its sources.
        </p>
      )}

      <details className="mt-3 rounded-xl border border-[var(--border)] px-4 py-2">
        <summary className="cursor-pointer text-sm text-[var(--muted)] hover:text-[var(--foreground)]">
          Settings{secondCheck ? ' · second check' : ''}
        </summary>
        <div className="mt-3 flex flex-col gap-4 pb-2">
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input type="checkbox" role="switch" checked={secondCheck} onChange={(e) => setSecondCheck(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[var(--accent)]" />
            <span>
              <span className="font-medium">Second check</span>
              <span className="block text-xs text-[var(--muted)]">
                A second request reviews each answer before you see it - for abilities it missed (token copies, creatures dying together), wrong counts and too much confidence - and corrects it. Slower, and two requests a question.
              </span>
            </span>
          </label>
          <ModelLine feature="rules" />
        </div>
      </details>

      {busy && (
        <p className="mt-4 text-center text-sm text-[var(--muted)]" role="status">
          Looking up what the question needs, then the cards, their rulings and the rules, then working it out step by step{secondCheck ? ', then checking it' : ''} - {secondCheck ? 'up to a minute or two' : 'about fifteen seconds, longer if the model is busy'}.
        </p>
      )}
      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

      {!thread && choicePanel}
      {!thread && clarifyPanel}

      {!thread && !choosing && !clarifying && !busy && (
        <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
          {EXAMPLES.map((x) => (
            <button
              key={x.question}
              onClick={() => { setQuestion(x.question); ask(x.question, {}, null); }}
              className="flex flex-col gap-1 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-left text-sm hover:border-[var(--accent)]/60 hover:bg-[var(--surface-hover)]"
            >
              <span className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--accent)]">{x.topic}</span>
              {x.question}
            </button>
          ))}
        </div>
      )}

      {!thread && (
        <Composer
          value={question}
          onChange={setQuestion}
          onSend={() => ask(question, {}, null)}
          busy={busy}
          placeholder="Ask about cards or a rule…"
          label="Rules question"
          hint={hint}
        />
      )}

      {thread && (
        <div className="mt-4 flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            {renaming === null ? (
              <>
                <h2 className="min-w-0 flex-1 text-lg font-medium">{thread.title}</h2>
                <button onClick={() => star(thread)} className={button} aria-pressed={thread.starred}>
                  <span aria-hidden className={thread.starred ? 'text-[var(--accent)]' : ''}>{thread.starred ? '★' : '☆'}</span> {thread.starred ? 'Saved' : 'Save'}
                </button>
                <button onClick={() => setRenaming(thread.title)} className={button} aria-label="Rename">✎</button>
              </>
            ) : (
              <form className="flex w-full gap-2" onSubmit={(e) => { e.preventDefault(); if (renaming.trim()) rename(thread, renaming.trim()); }}>
                <input value={renaming} onChange={(e) => setRenaming(e.target.value)} autoFocus maxLength={120} aria-label="Name" className={`${input} py-2`} />
                <button className={button}>Save</button>
                <button type="button" onClick={() => setRenaming(null)} className={button}>Cancel</button>
              </form>
            )}
          </div>

          {thread.turns.map((t, i) => (
            <section key={i} id={`turn-${i}`} className="scroll-mt-20">
              <p className="mb-2 ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-sm bg-[var(--surface-hover)] px-4 py-2 text-sm">{t.question}</p>
              {t.cards.length > 0 && (
                <p className="mb-2 text-xs text-[var(--muted)]">About: {t.cards.join(', ')}</p>
              )}
              <RulesAnswer turn={t} index={i} onAsk={(q) => ask(q)} />
            </section>
          ))}

          {choicePanel}
          {clarifyPanel}
          <Composer
            value={followUp}
            onChange={setFollowUp}
            onSend={() => ask(followUp)}
            busy={busy}
            placeholder="Follow up - the cards above stay in the conversation"
            label="Follow-up question"
            hint={hint}
          />
        </div>
      )}
    </div>
    </div>
  );
}

/**
 * The question box, docked at the bottom of the screen as a chat's is:
 * Enter sends, Shift+Enter starts a new line.
 */
function Composer({ value, onChange, onSend, busy, placeholder, label, hint }: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  busy: boolean;
  placeholder: string;
  label: string;
  hint: string;
}) {
  return (
    <form
      className="sticky bottom-[calc(var(--nav-h)+0.75rem)] z-10 mt-5 flex flex-col gap-1.5 bg-gradient-to-t from-[var(--background)] from-60% to-transparent pt-4 sm:bottom-4"
      onSubmit={(e) => { e.preventDefault(); onSend(); }}
    >
      <div className="flex items-end gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] py-2 pl-4 pr-2 shadow-lg focus-within:border-[var(--accent)]">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }}
          rows={1}
          maxLength={600}
          placeholder={placeholder}
          aria-label={label}
          enterKeyHint="send"
          className="max-h-40 min-h-[2.25rem] flex-1 resize-none bg-transparent py-1.5 text-base outline-none [field-sizing:content]"
        />
        <button
          disabled={busy || !value.trim()}
          aria-label={busy ? 'Reading the rules' : 'Ask'}
          className="btn-go grid h-9 w-9 shrink-0 place-items-center rounded-xl text-lg font-bold disabled:opacity-40"
        >
          {busy ? '…' : '↑'}
        </button>
      </div>
      {hint && <p className="text-center text-[11.5px] text-[var(--faint)]">{hint}</p>}
    </form>
  );
}

