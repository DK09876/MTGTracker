'use client';

/**
 * Tune → Cut: the cut list, the rules behind it, and Claude's review.
 *
 * The list is the rules added up (lib/cut-rules.ts); every reason on a card
 * names its rule, and the Rules view switches, reweights or adds to them for
 * this deck. Claude's review reads the plan and says, for the top of the
 * list, whether it agrees - it never cuts anything itself. Cuts go to the
 * maybeboard, with undo.
 */

import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';

import AiModelPicker from './AiModelPicker';
import * as api from '@/lib/api';
import { CUT_RULES, describeCustom, type CustomRule, type CutSettings } from '@/lib/cut-rules';
import type { CutReview, ReviewItem } from '@/lib/cut-review';
import type { ListedCard } from '@/lib/db';
import type { Board } from '@/lib/decklist';
import type { Job } from '@/lib/jobs';

interface Props {
  listId: string;
  cards: ListedCard[];
  version: string;
  /** Tag names in this deck, for writing rules. */
  tagNames: string[];
  planConfirmed: boolean;
  onMove: (cardId: string, board: Board) => Promise<void> | void;
  onPlan: () => void;
}

type View = 'list' | 'rules' | 'claude';
const RULE_NAME = new Map(CUT_RULES.map((r) => [r.id, r.label]));
const POLL_MS = 2_500;

export default function TuneCut({ listId, cards, version, tagNames, planConfirmed, onMove, onPlan }: Props) {
  const [view, setView] = useState<View>('list');
  // Saving the rules changes the list, so it is part of what the list is read for.
  const [rulesVersion, setRulesVersion] = useState(0);
  const key = `${version}:${rulesVersion}`;
  const [plan, setPlan] = useState<{ key: string; plan: api.CutPlan | 'failed' } | null>(null);
  const [review, setReview] = useState<{ review: CutReview | null; job: Job | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.cutPlan(listId).then((p) => { if (!cancelled) setPlan({ key, plan: p }); }).catch(() => { if (!cancelled) setPlan({ key, plan: 'failed' }); });
    return () => { cancelled = true; };
  }, [listId, key]);

  const loadReview = useCallback(() => api.cutReview(listId).then(setReview).catch(() => {}), [listId]);
  useEffect(() => { void loadReview(); }, [loadReview]);
  const reviewing = review?.job?.status === 'running';
  useEffect(() => {
    if (!reviewing) return;
    const timer = setInterval(loadReview, POLL_MS);
    return () => clearInterval(timer);
  }, [reviewing, loadReview]);

  const current = plan?.key === key ? plan.plan : null;
  const verdicts = new Map((review?.review?.items ?? []).map((i) => [i.name, i]));

  return (
    <div className="flex flex-col gap-4">
      <div data-tour="cut-views" className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border border-[var(--border)] bg-[var(--surface)] p-1 text-sm" role="tablist" aria-label="Cut list">
        {([['list', 'Suggestions'], ['rules', 'Rules'], ['claude', 'Ask Claude']] as const).map(([v, label]) => (
          <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
            className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 ${view === v ? 'bg-[var(--surface-hover)] font-semibold' : 'text-[var(--muted)] hover:text-[var(--foreground)]'}`}>
            {label}{v === 'claude' && review?.review ? ' ·' : ''}
          </button>
        ))}
      </div>
      {!current ? <p className="text-sm text-[var(--muted)]">Weighing every card…</p>
        : current === 'failed' ? <p className="text-sm text-red-400">Couldn&apos;t weigh the cards just now.</p>
          : view === 'list' ? (
            <Workbench listId={listId} cards={cards} current={current} verdicts={verdicts} onMove={onMove} onRules={() => setView('rules')}
              onKept={(c) => setPlan({ key, plan: { ...current, candidates: current.candidates.filter((x) => x.cardId !== c.cardId), protectedCards: [...current.protectedCards, c.name] } })} />
          ) : view === 'rules' ? (
            <Rules listId={listId} settings={current.settings} tagNames={tagNames} onSaved={() => setRulesVersion((n) => n + 1)} />
          ) : (
            <Review listId={listId} state={review} planConfirmed={planConfirmed} onPlan={onPlan} onStarted={(job) => setReview((r) => ({ review: r?.review ?? null, job }))} />
          )}
    </div>
  );
}

// --- The list -----------------------------------------------------------------

function Workbench({ listId, cards, current, verdicts, onMove, onRules, onKept }: {
  listId: string; cards: ListedCard[]; current: api.CutPlan; verdicts: Map<string, ReviewItem>;
  onMove: Props['onMove']; onRules: () => void; onKept: (c: api.CutPlan['candidates'][number]) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState<string[] | null>(null);

  const over = current.size - 100;
  const chosen = current.candidates.filter((c) => picked.has(c.cardId));
  // Cuts should keep the curve where it is or lower it (3/3 Elk).
  const spellCount = Math.max(1, Math.round(current.size - 1 - 37));
  const mvAfter = chosen.length
    ? (current.averageMv * spellCount - chosen.reduce((n, c) => n + c.cmc, 0)) / Math.max(1, spellCount - chosen.length)
    : current.averageMv;
  const left = Math.max(0, over - chosen.length);
  const after = current.roles.map((r) => ({ ...r, now: r.count - chosen.filter((c) => c.roles.includes(r.id)).length })).filter((r) => r.now !== r.count);
  // A ★ keeps a card for good: it leaves the list at once.
  const star = async (c: api.CutPlan['candidates'][number]) => {
    const card = cards.find((x) => x.card.id === c.cardId)?.card;
    if (!card) return;
    await api.keepCard(listId, card.oracle_id ?? card.id, true);
    setPicked((p) => { const n = new Set(p); n.delete(c.cardId); return n; });
    onKept(c);
  };
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const move = async (ids: string[], board: Board) => {
    setBusy(true);
    try { for (const id of ids) await onMove(id, board); } finally { setBusy(false); }
  };

  return (
    <div data-tour="cut-workbench" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">The cut list</h3>
        <p className="text-sm">
          {over > 0
            ? <>{current.size} cards · <span className={left ? 'font-semibold text-amber-300' : 'font-semibold text-emerald-400'}>{left ? `pick ${left} more` : 'that gets it to 100'}</span></>
            : over === 0 ? <span className="text-emerald-400">100 cards - nothing has to go</span> : <span>{-over} short of 100</span>}
        </p>
      </div>
      {undo && (
        <p className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
          {undo.length} moved to the maybeboard.
          <button onClick={async () => { await move(undo, 'main'); setUndo(null); }} disabled={busy} className="text-[var(--accent)] hover:underline">Undo</button>
        </p>
      )}
      <div className="flex flex-col gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm">
        <p><span className="font-semibold">Type {current.type.type} deck.</span> <span className="text-[var(--muted)]">{current.type.why}</span></p>
        {current.curve && <p className="text-[var(--muted)]"><span className="text-[var(--foreground)]">Look here first:</span> {current.curve}.</p>}
        <p className="text-[var(--muted)]">
          Each reason names the rule behind it; <button onClick={onRules} className="text-[var(--accent)] hover:underline">change the rules</button> if one is wrong for this deck.
          Cuts go to the maybeboard, so nothing is lost.
          {current.protectedCards.length > 0 && <> {current.protectedCards.length} card{current.protectedCards.length === 1 ? ' is' : 's are'} kept out by your tags, your rules or a ★.</>}
        </p>
      </div>
      {(after.length > 0 || chosen.length > 0) && (
        <div className="flex flex-wrap gap-2 text-xs">
          {chosen.length > 0 && (
            <span className={`rounded-full border px-2.5 py-0.5 ${mvAfter > current.averageMv + 0.02 ? 'border-amber-400/60 text-amber-300' : 'border-[var(--border)] text-[var(--muted)]'}`}>
              Average mana value {current.averageMv.toFixed(2)} → {mvAfter.toFixed(2)}{mvAfter > current.averageMv + 0.02 ? ' (heavier)' : ''}
            </span>
          )}
          {after.map((r) => {
            const low = r.now < r.target[0];
            return <span key={r.id} className={`rounded-full border px-2.5 py-0.5 ${low ? 'border-amber-400/60 text-amber-300' : 'border-[var(--border)] text-[var(--muted)]'}`}>{r.label} {r.count} → {r.now}{low ? ` (below ${r.target[0]})` : ''}</span>;
          })}
        </div>
      )}
      {current.candidates.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">Nothing stands out - every card has a job here.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {current.candidates.slice(0, 30).map((c) => {
            const v = verdicts.get(c.name);
            return (
              <li key={c.cardId}>
                <div className={`flex items-start gap-3 rounded-2xl border p-2.5 ${picked.has(c.cardId) ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-hover)]'}`}>
                  <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                    <input type="checkbox" checked={picked.has(c.cardId)} onChange={() => toggle(c.cardId)} className="mt-1" />
                    {c.image ? <Image src={c.image} alt="" width={40} height={56} className="rounded" unoptimized /> : <span className="h-14 w-10 rounded bg-[var(--surface-hover)]" />}
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-sm font-medium">{c.name}</span>
                        <span className="text-xs tabular-nums text-[var(--muted)]">{c.score}</span>
                        {v && <Verdict item={v} />}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {c.why.map((w, i) => (
                          <span key={i} title={RULE_NAME.get(w.rule) ?? (w.rule === 'custom' ? 'Your rule' : '')}
                            className={`rounded-md bg-[var(--surface-hover)] px-1.5 py-0.5 text-xs ${w.delta > 0 ? 'text-[#ffb4a8]' : 'text-[#9fe0ad]'}`}>
                            {w.delta > 0 ? '+' : '−'} {w.text}
                          </span>
                        ))}
                      </span>
                      {v && <span className="mt-1 block text-xs text-[var(--muted)]">Claude: {v.why}</span>}
                    </span>
                  </label>
                  <button onClick={() => star(c)} aria-label={`Keep ${c.name}: never offer it as a cut`} title="Keep it: never offer it as a cut"
                    className="rounded-full px-2 py-1 text-base text-[var(--muted)] hover:text-[var(--accent)]">☆</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="sticky bottom-[calc(var(--nav-h,0px)+0.75rem)] flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/95 p-3 backdrop-blur sm:bottom-4">
        <button onClick={async () => { const ids = chosen.map((c) => c.cardId); await move(ids, 'maybe'); setUndo(ids); setPicked(new Set()); }}
          disabled={!chosen.length || busy} className="btn-go rounded-full px-4 py-1.5 text-sm font-semibold disabled:opacity-50">
          {busy ? 'Moving…' : `Cut ${chosen.length || ''} to the maybeboard`.replace('  ', ' ')}
        </button>
      </div>
    </div>
  );
}

function Verdict({ item }: { item: ReviewItem }) {
  const style = item.verdict === 'cut' ? 'bg-[#ffb4a8]/15 text-[#ffb4a8]' : item.verdict === 'keep' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-[var(--surface-hover)] text-[var(--muted)]';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${style}`}>Claude: {item.verdict === 'cut' ? 'agrees, cut' : item.verdict === 'keep' ? 'keep it' : 'unsure'}</span>;
}

// --- The rules ------------------------------------------------------------------

function Rules({ listId, settings, tagNames, onSaved }: { listId: string; settings: CutSettings; tagNames: string[]; onSaved: () => void }) {
  const [draft, setDraft] = useState<CutSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<CustomRule>({ when: 'tag', value: tagNames[0] ?? '', then: 'protect' });

  const save = async (next: CutSettings) => {
    setDraft(next);
    setSaving(true);
    setError(null);
    try {
      setDraft((await api.saveCutSettings(listId, next)).settings);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the rules');
    } finally {
      setSaving(false);
    }
  };
  const setRule = (id: string, change: { on?: boolean; weight?: number }) => save({ ...draft, rules: { ...draft.rules, [id]: { ...draft.rules[id], ...change } } });
  const sources = [...new Set(CUT_RULES.map((r) => r.source))];

  return (
    <div data-tour="cut-rules" className="flex flex-col gap-4">
      <p className="max-w-3xl text-sm text-[var(--muted)]">
        The cut list is these rules added up. Switch one off, change how much it counts, or write your own. Saved for this deck.
        {saving && <span className="ml-2">Saving…</span>}
      </p>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {sources.map((src) => (
        <section key={src} className="flex flex-col gap-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{src}</h4>
          {CUT_RULES.filter((r) => r.source === src).map((r) => {
            const mine = draft.rules[r.id] ?? {};
            const on = mine.on !== false;
            const weight = mine.weight ?? r.weight;
            return (
              <div key={r.id} className={`flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm ${on ? '' : 'opacity-60'}`}>
                <input type="checkbox" checked={on} onChange={(e) => setRule(r.id, { on: e.target.checked })} aria-label={`Use: ${r.label}`} />
                <span className="min-w-0 flex-[1_1_16rem]">
                  {r.label}
                  <span className={`ml-2 text-xs ${r.toward === 'cut' ? 'text-[#ffb4a8]' : 'text-[#9fe0ad]'}`}>{r.protects ? 'protects' : r.toward === 'cut' ? 'toward cutting' : 'toward keeping'}</span>
                </span>
                {!r.protects && (
                  <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
                    <input type="range" min={0} max={3} step={0.1} value={weight} disabled={!on} aria-label={`How much it counts: ${r.label}`}
                      onChange={(e) => setDraft({ ...draft, rules: { ...draft.rules, [r.id]: { ...mine, weight: Number(e.target.value) } } })}
                      onPointerUp={(e) => setRule(r.id, { weight: Number((e.target as HTMLInputElement).value) })}
                      onKeyUp={(e) => setRule(r.id, { weight: Number((e.target as HTMLInputElement).value) })} />
                    <span className="w-7 tabular-nums">{weight.toFixed(1)}</span>
                    {mine.weight !== undefined && mine.weight !== r.weight && <button onClick={() => setRule(r.id, { weight: r.weight })} className="text-[var(--accent)] hover:underline">reset</button>}
                  </label>
                )}
              </div>
            );
          })}
        </section>
      ))}

      <section className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Your rules</h4>
        {draft.custom.length === 0 && <p className="text-sm text-[var(--muted)]">None yet.</p>}
        {draft.custom.map((c, i) => (
          <div key={i} className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
            <span className="min-w-0 flex-1">{describeCustom(c).replace(/^Your rule: /, '')}</span>
            <button onClick={() => save({ ...draft, custom: draft.custom.filter((_, j) => j !== i) })} aria-label="Remove this rule" className="text-[var(--muted)] hover:text-red-400">×</button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-[var(--border)] px-3 py-2 text-sm">
          <span>When a card is</span>
          <select aria-label="Kind of rule" value={adding.when} onChange={(e) => setAdding({ ...adding, when: e.target.value as CustomRule['when'], value: e.target.value === 'tag' ? tagNames[0] ?? '' : '' })} className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1">
            <option value="tag">tagged</option><option value="role">in the role</option><option value="card">the card</option>
            <option value="mv-at-least">mana value at least</option><option value="mv-at-most">mana value at most</option>
          </select>
          {adding.when === 'tag' && tagNames.length ? (
            <select aria-label="Tag" value={adding.value} onChange={(e) => setAdding({ ...adding, value: e.target.value })} className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1">
              {tagNames.map((t) => <option key={t}>{t}</option>)}
            </select>
          ) : (
            <input aria-label="Value" value={adding.value} onChange={(e) => setAdding({ ...adding, value: e.target.value })}
              placeholder={adding.when === 'role' ? 'e.g. ramp' : adding.when === 'card' ? 'card name' : adding.when.startsWith('mv') ? '5' : 'tag name'}
              className="w-40 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1" />
          )}
          <span>→</span>
          <select aria-label="What happens" value={String(adding.then)} onChange={(e) => setAdding({ ...adding, then: e.target.value === 'protect' ? 'protect' : Number(e.target.value) })} className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1">
            <option value="protect">never cut it</option><option value="-1">much less likely to cut (−1)</option><option value="-0.5">less likely (−0.5)</option>
            <option value="0.5">more likely (+0.5)</option><option value="1">much more likely (+1)</option>
          </select>
          <button onClick={() => { if (adding.value.trim()) void save({ ...draft, custom: [...draft.custom, adding] }); }} disabled={!adding.value.trim()} className="rounded-full border border-[var(--border)] px-3 py-1 hover:bg-[var(--surface-hover)] disabled:opacity-50">Add</button>
        </div>
      </section>
      <div><button onClick={() => save({ rules: {}, custom: [] })} className="rounded-full border border-[var(--border)] px-4 py-1.5 text-sm hover:bg-[var(--surface-hover)]">Reset to defaults</button></div>
    </div>
  );
}

// --- Claude's review --------------------------------------------------------------

function Review({ listId, state, planConfirmed, onPlan, onStarted }: {
  listId: string; state: { review: CutReview | null; job: Job | null } | null; planConfirmed: boolean;
  onPlan: () => void; onStarted: (job: Job) => void;
}) {
  const [instructions, setInstructions] = useState('');
  const [error, setError] = useState<string | null>(null);
  const running = state?.job?.status === 'running';
  const failed = state?.job && state.job.status !== 'running' && state.job.status !== 'done' ? state.job : null;
  const review = state?.review;

  if (!planConfirmed) {
    return (
      <div className="flex max-w-2xl flex-col items-start gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
        <p><span className="font-semibold">Claude reviews the cuts against your plan,</span> so it waits for one. It&apos;s already drafted - read it and confirm.</p>
        <button onClick={onPlan} className="btn-go rounded-full px-4 py-1.5 font-semibold">Go to Plan</button>
      </div>
    );
  }
  const start = async () => {
    setError(null);
    try { onStarted((await api.startCutReview(listId, instructions)).job); } catch (e) { setError(e instanceof Error ? e.message : 'Could not start it'); }
  };

  return (
    <div data-tour="cut-review" className="flex flex-col gap-4">
      <p className="max-w-3xl text-sm text-[var(--muted)]">
        Claude reads the plan, the styles, your tags and the top 30 of the list - with each card&apos;s text and why it is there - and says for each whether it agrees.
        It never cuts anything; its notes appear next to each card in Suggestions.
      </p>
      <label className="flex max-w-3xl flex-col gap-1 text-sm">
        Your instructions <span className="text-xs text-[var(--muted)]">(optional, added to everything above)</span>
        <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2} maxLength={2000}
          placeholder="e.g. Keep anything that attacks alone. I'd rather cut ramp than draw. Nothing over $5 stays just for value."
          className="resize-y rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 outline-none focus:border-[var(--accent)]" />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={start} disabled={running} className="btn-go rounded-full px-4 py-1.5 text-sm font-semibold disabled:opacity-60">
          {running ? `${state?.job?.detail || 'Reviewing'}…` : review ? 'Review again' : 'Ask Claude to review'}
        </button>
        <AiModelPicker area="deck" />
      </div>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {failed && <p className="text-sm text-red-400">The review did not finish: {failed.error}</p>}
      {review && (
        <section className="flex flex-col gap-2">
          <p className="text-xs text-[var(--muted)]">
            {new Date(review.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            {review.instructions && <> · your instructions: &ldquo;{review.instructions}&rdquo;</>}
          </p>
          <ul className="flex flex-col gap-1.5">
            {review.items.map((i) => (
              <li key={i.name} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
                <span className="font-medium">{i.name}</span>
                <Verdict item={i} />
                <span className="w-full text-[var(--muted)]">{i.why}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
