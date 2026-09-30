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

import RulesAnswer from '@/components/RulesAnswer';
import ModelLine from '@/components/ModelLine';
import { useSetting } from '@/lib/ai-settings';
import * as api from '@/lib/api';
import type { RulesThread, RulesThreadSummary } from '@/lib/db';
import { getProfile } from '@/lib/profile';
import type { Budget } from '@/lib/quota';
import { dismissKeyboard, steady } from '@/lib/steady-tap';

const EXAMPLES = [
  'How does Blade of Selves interact with Kratos?',
  'Do "when a creature dies" abilities trigger when the whole board is wiped with Blasphemous Act?',
  'Does the legend rule apply to token copies?',
  'Can I respond to a spell that says it can\'t be countered?',
];

const input = 'w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-base outline-none focus:border-[var(--accent)]';
const button = 'min-h-10 rounded-lg border border-[var(--border)] px-3 text-sm hover:bg-[var(--surface-hover)] disabled:opacity-50';
const primary = 'min-h-11 rounded-xl bg-[var(--accent)] px-5 font-medium text-[#221c08] hover:brightness-110 disabled:opacity-50';

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
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('That took too long - try asking again')), 150_000)),
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

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold">Rules</h1>
        {thread && <button onClick={() => open(null)} className={button}>New question</button>}
      </div>
      <p className="mt-1 text-sm text-[var(--muted)]">
        How cards interact, or how a rule works. Answers come from the cards&apos; official rulings, the Comprehensive Rules and the MTG Wiki, with every claim linked to its source.
        {left !== undefined && <> {' '}{secondCheck ? 'Two AI requests' : 'One AI request'} per question · {left} left today.</>}
      </p>

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
          <ModelLine />
        </div>
      </details>

      {!thread && (
        <form className="mt-4 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); ask(question, {}, null); }}>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(question, {}, null); } }}
            rows={3}
            maxLength={600}
            placeholder="How does Blade of Selves interact with Kratos?"
            aria-label="Rules question"
            enterKeyHint="send"
            className={input}
          />
          <button disabled={busy || !question.trim()} className={`${primary} self-end`}>{busy ? 'Reading the rules…' : 'Ask'}</button>
        </form>
      )}

      {busy && (
        <p className="mt-4 text-center text-sm text-[var(--muted)]" role="status">
          Looking up what the question needs, then the cards, their rulings and the rules, then working it out step by step{secondCheck ? ', then checking it' : ''} - {secondCheck ? 'up to a minute or two' : 'about fifteen seconds, longer if the model is busy'}.
        </p>
      )}
      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

      {!thread && choicePanel}
      {!thread && clarifyPanel}

      {!thread && !choosing && !clarifying && !busy && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
            <span>Try:</span>
            {EXAMPLES.map((q) => (
              <button key={q} onClick={() => { setQuestion(q); ask(q, {}, null); }} className="rounded-lg border border-[var(--border)] px-2 py-1 text-left text-xs hover:bg-[var(--surface)]">{q}</button>
            ))}
          </div>
          <ThreadList title="Saved" threads={threads.filter((t) => t.starred)} onOpen={open} onForget={forget} />
          <ThreadList title="Recent" threads={threads.filter((t) => !t.starred)} onOpen={open} onForget={forget} />
        </>
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
          <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); ask(followUp); }}>
            <textarea
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(followUp); } }}
              rows={2}
              maxLength={600}
              placeholder="Ask a follow-up - the cards above stay in the conversation"
              aria-label="Follow-up question"
              enterKeyHint="send"
              className={input}
            />
            <button disabled={busy || !followUp.trim()} className={`${primary} self-end`}>{busy ? 'Reading the rules…' : 'Ask'}</button>
          </form>
        </div>
      )}
    </div>
  );
}

function ThreadList({ title, threads, onOpen, onForget }: {
  title: string;
  threads: RulesThreadSummary[];
  onOpen: (id: string) => void;
  onForget: (id: string) => void;
}) {
  if (!threads.length) return null;
  return (
    <section className="mt-5" aria-label={`${title} rules questions`}>
      <h2 className="text-xs uppercase tracking-wide text-[var(--muted)]">{title}</h2>
      <ul className="mt-1 divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)]">
        {threads.slice(0, 12).map((t) => (
          <li key={t.id} className="flex items-center">
            <button {...steady(() => onOpen(t.id))} className="flex min-h-12 min-w-0 flex-1 flex-col px-3 py-2 text-left hover:bg-[var(--surface)]">
              <span className="truncate text-sm">
                {t.starred && <span aria-hidden className="mr-1 text-[var(--accent)]">★</span>}{t.title}
              </span>
              <span className="truncate text-xs text-[var(--muted)]">
                {t.questions > 1 ? `${t.questions} questions · ` : ''}{t.lastVerdict}
              </span>
            </button>
            <button onClick={() => onForget(t.id)} aria-label={`Forget "${t.title}"`} className="flex min-h-11 min-w-11 items-center justify-center text-[var(--muted)] hover:text-[var(--foreground)]">✕</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
