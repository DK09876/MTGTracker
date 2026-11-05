'use client';

/**
 * Tune → Cut: the cut list, the rules behind it, and Claude's review.
 *
 * The list is the rules added up (lib/cut-rules.ts); every reason on a card
 * names its rule, and the Rules view switches, reweights or adds to them for
 * this deck. Claude's review reads the plan and says, for the top of the
 * list, whether it agrees - or rates the whole deck in tiers - and each of
 * its verdicts can be acted on (cut, ★ keep, discuss) or disputed. It never
 * cuts anything itself. Cuts go to the section for cards that came out
 * (the Sideboard unless the owner changed it), with undo. Cards the deck
 * can't have at all - flagged - come first.
 */

import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';

import AiModelPicker from './AiModelPicker';
import Tip from './Tip';
import { AI_READS } from '@/lib/ai-reads';
import * as api from '@/lib/api';
import { CUT_RULES, describeCustom, RULE_GROUPS, type CustomRule, type CutSettings } from '@/lib/cut-rules';
import { capCuts, reviewSize, TIERS, type CutReview, type ReviewItem, type ReviewMode, type Tier } from '@/lib/cut-review-shared';
import type { ListedCard } from '@/lib/db';
import type { Board } from '@/lib/decklist';
import type { Job } from '@/lib/jobs';
import FlaggedZone from './FlaggedZone';
import type { Flag } from '@/lib/health';

interface Props {
  listId: string;
  cards: ListedCard[];
  version: string;
  /** Tag names in this deck, for writing rules. */
  tagNames: string[];
  planConfirmed: boolean;
  onMove: (cardId: string, board: Board) => Promise<void> | void;
  onPlan: () => void;
  /** Discuss a verdict in the deck's Chat. */
  onAsk?: (question: string) => void;
  /** Where cuts go, and its name. */
  cutTo: Board;
  cutName: string;
  /** Cards the deck can't have as it stands: the first filter. */
  flags: Flag[];
  onFix: (flag: Flag) => Promise<void> | void;
  /** Cards in the deck now, the commanders included. */
  deckSize: number;
}

type View = 'list' | 'rules' | 'claude';
const RULE_NAME = new Map(CUT_RULES.map((r) => [r.id, r.label]));
const POLL_MS = 2_500;

export default function TuneCut({ listId, cards, version, tagNames, planConfirmed, onMove, onPlan, onAsk, cutTo, cutName, flags, onFix, deckSize }: Props) {
  const [view, setView] = useState<View>('list');
  // Saving the rules changes the list, so it is part of what the list is read for.
  const [rulesVersion, setRulesVersion] = useState(0);
  const key = `${version}:${rulesVersion}`;
  // What the list was last time, shown at once while it is weighed again.
  const [plan, setPlan] = useState<{ key: string; plan: api.CutPlan | 'failed' } | null>(() => { const p = api.peek<api.CutPlan>(api.paths.cuts(listId)); return p ? { key, plan: p } : null; });
  const [review, setReview] = useState<api.CutReviewState | null>(() => api.peek(api.paths.review(listId)) ?? null);

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

  // The last list stays on screen while a fresh one is weighed - an undo in it survives.
  const current = plan?.plan ?? null;
  const refreshing = !!plan && plan.key !== key;
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
      {refreshing && <p role="status" className="text-xs text-[var(--muted)]">Updating the list…</p>}
      {!current ? <p className="text-sm text-[var(--muted)]">Weighing every card…</p>
        : current === 'failed' ? <p className="text-sm text-red-400">Couldn&apos;t weigh the cards just now.</p>
          : view === 'list' ? (
            <Workbench listId={listId} cards={cards} current={current} verdicts={verdicts} onMove={onMove} onRules={() => setView('rules')}
              cutTo={cutTo} cutName={cutName} flags={flags} onFix={onFix}
              onKept={(c) => setPlan({ key, plan: { ...current, candidates: current.candidates.filter((x) => x.cardId !== c.cardId), protectedCards: [...current.protectedCards, c.name] } })} />
          ) : view === 'rules' ? (
            <Rules listId={listId} settings={current.settings} tagNames={tagNames} onSaved={() => setRulesVersion((n) => n + 1)} />
          ) : (
            <Review listId={listId} cards={cards} over={deckSize - 100} cutTo={cutTo} cutName={cutName} state={review} planConfirmed={planConfirmed} onPlan={onPlan}
              onMove={onMove} onAsk={onAsk} onChanged={() => { void loadReview(); setRulesVersion((n) => n + 1); }}
              onStarted={(job) => setReview((r) => ({ review: r?.review ?? null, settled: r?.settled, job }))} />
          )}
    </div>
  );
}

// --- The list -----------------------------------------------------------------

// A cut candidate is filed under the group of its strongest reason, so the list can be looked at a pile at a time.
const GROUP_OF = new Map(CUT_RULES.map((r) => [r.id, r.group]));
const leadGroup = (c: api.CutPlan['candidates'][number]) => {
  const top = [...c.why].filter((w) => w.delta > 0).sort((a, b) => b.delta - a.delta)[0];
  return top ? GROUP_OF.get(top.rule) ?? (top.rule === 'lands' ? 'Curve and mana' : 'Your rules') : 'Card quality';
};

function Workbench({ listId, cards, current, verdicts, onMove, onRules, onKept, cutTo, cutName, flags, onFix }: {
  listId: string; cards: ListedCard[]; current: api.CutPlan; verdicts: Map<string, ReviewItem>;
  onMove: Props['onMove']; onRules: () => void; onKept: (c: api.CutPlan['candidates'][number]) => void;
  cutTo: Board; cutName: string; flags: Flag[]; onFix: Props['onFix'];
}) {
  const [filter, setFilter] = useState<string>(() => (flags.length ? 'flagged' : 'all'));
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
        <h3 data-section="The cut list" data-section-count={String(current.candidates.length)} className="font-semibold">The cut list</h3>
        <p className="text-sm">
          {over > 0
            ? <>{current.size} cards · <span className={left ? 'font-semibold text-amber-300' : 'font-semibold text-emerald-400'}>{left ? `pick ${left} more` : 'that gets it to 100'}</span></>
            : over === 0 ? <span className="text-emerald-400">100 cards - nothing has to go</span> : <span>{-over} short of 100</span>}
        </p>
      </div>
      {undo && (
        <p className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
          {undo.length} moved to {cutName}.
          <button onClick={async () => { await move(undo, 'main'); setUndo(null); }} disabled={busy} className="text-[var(--accent)] hover:underline">Undo</button>
        </p>
      )}
      <div className="flex flex-col gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm">
        <p><span className="font-semibold">Type {current.type.type} deck.</span> <span className="text-[var(--muted)]">{current.type.why}</span></p>
        {current.curve && <p className="text-[var(--muted)]"><span className="text-[var(--foreground)]">Look here first:</span> {current.curve}.</p>}
        <p className="text-[var(--muted)]">
          Each reason names the rule behind it; <button onClick={onRules} className="text-[var(--accent)] hover:underline">change the rules</button> if one is wrong for this deck.
          Cuts go to {cutName}, so nothing is lost.
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
      <div role="group" aria-label="Look at" className="flex flex-wrap gap-1.5 text-sm">
        {[
          ...(flags.length ? [['flagged', 'Flagged', flags.length] as const] : []),
          ['all', 'Everything', current.candidates.length] as const,
          ...[...new Set(current.candidates.map(leadGroup))].map((g) => [g, g, current.candidates.filter((c) => leadGroup(c) === g).length] as const),
        ].map(([id, label, n]) => (
          <button key={id} onClick={() => setFilter(id)} aria-pressed={filter === id}
            className={`rounded-full border px-3 py-1 ${filter === id ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--foreground)]' : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]'} ${id === 'flagged' ? 'font-semibold' : ''}`}>
            {label} · <span className="tabular-nums">{n}</span>
          </button>
        ))}
        <Tip label="About these filters">
          Flagged cards can&apos;t be in the deck at all, so they go first. The rest are filed by the strongest reason to cut them: look at one pile at a time.
        </Tip>
      </div>
      {filter === 'flagged' && flags.length > 0 ? (
        <FlaggedZone flags={flags} cutName={cutName} onFix={onFix} bare />
      ) : current.candidates.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">Nothing stands out - every card has a job here.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {current.candidates.filter((c) => filter === 'all' || filter === 'flagged' || leadGroup(c) === filter).slice(0, 30).map((c) => {
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
      <div className="sticky bottom-[calc(var(--nav-h,0px)+5.5rem)] z-20 flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/95 p-3 backdrop-blur lg:bottom-4">
        <button onClick={async () => { const ids = chosen.map((c) => c.cardId); await move(ids, cutTo); setUndo(ids); setPicked(new Set()); }}
          disabled={!chosen.length || busy} className="btn-go rounded-full px-4 py-1.5 text-sm font-semibold disabled:opacity-50">
          {busy ? 'Moving…' : `Cut ${chosen.length || ''} to ${cutName}`.replace('  ', ' ')}
        </button>
      </div>
    </div>
  );
}

function Verdict({ item }: { item: ReviewItem }) {
  const style = item.verdict === 'cut' ? 'bg-[#ffb4a8]/15 text-[#ffb4a8]' : item.verdict === 'keep' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-[var(--surface-hover)] text-[var(--muted)]';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${style}`}>Claude: {item.tier ? `tier ${item.tier}` : item.verdict === 'cut' ? 'agrees, cut' : item.verdict === 'keep' ? 'keep it' : 'unsure'}</span>;
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

  return (
    <div data-tour="cut-rules" className="flex flex-col gap-4">
      <p className="max-w-3xl text-sm text-[var(--muted)]">
        The cut list is these rules added up. Switch one off, change how much it counts, or write your own. Saved for this deck.
        {saving && <span className="ml-2">Saving…</span>}
      </p>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {RULE_GROUPS.map((group) => (
        <section key={group} className="flex flex-col gap-1.5">
          <h4 data-section={group} className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{group}</h4>
          {CUT_RULES.filter((r) => r.group === group).map((r) => {
            const mine = draft.rules[r.id] ?? {};
            const on = mine.on ?? !r.offByDefault;
            const toggleOnly = r.protects || r.weight === 0;
            const weight = mine.weight ?? r.weight;
            return (
              <div key={r.id} className={`flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm ${on ? '' : 'opacity-60'}`}>
                <input type="checkbox" checked={on} onChange={(e) => setRule(r.id, { on: e.target.checked })} aria-label={`Use: ${r.label}`} />
                <span className="min-w-0 flex-[1_1_16rem]">
                  {r.label} <Tip label={`Why: ${r.label}`}>{r.why}</Tip>
                  <span className={`ml-2 text-xs ${r.toward === 'cut' && !toggleOnly ? 'text-[#ffb4a8]' : 'text-[#9fe0ad]'}`}>{r.protects ? 'never cut' : toggleOnly ? (on ? 'on' : 'off') : r.toward === 'cut' ? 'toward cutting' : 'toward keeping'}</span>
                </span>
                {!toggleOnly && (
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
        <h4 data-section="Your rules" className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Your rules</h4>
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

type Acted = Record<string, 'cut' | 'kept'>;
const TIER_TONE: Record<Tier, string> = { S: '#f2dfa0', A: '#6ee7b7', B: '#5aa8e6', C: '#ffb4a8' };

function Review({ listId, cards, over, cutTo, cutName, state, planConfirmed, onPlan, onStarted, onMove, onAsk, onChanged }: {
  listId: string; cards: ListedCard[]; over: number; cutTo: Board; cutName: string; state: api.CutReviewState | null; planConfirmed: boolean;
  onPlan: () => void; onStarted: (job: Job) => void; onMove: Props['onMove']; onAsk?: (question: string) => void;
  /** After a re-rate: read the review again. */
  onChanged: () => void;
}) {
  const [instructions, setInstructions] = useState('');
  const [mode, setMode] = useState<ReviewMode>(() => state?.review?.mode ?? 'top');
  const [error, setError] = useState<string | null>(null);
  // What was done from this screen, with undo; what was done before comes from the server (settled).
  const [acted, setActed] = useState<Acted>({});
  const [busy, setBusy] = useState(false);
  const running = state?.job?.status === 'running';
  const failed = state?.job && state.job.status !== 'running' && state.job.status !== 'done' ? state.job : null;
  const review = state?.review;
  const main = cards.filter((c) => (c.board ?? 'main') === 'main');
  const size = reviewSize(over);

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
    try { onStarted((await api.startCutReview(listId, instructions, mode)).job); setActed({}); } catch (e) { setError(e instanceof Error ? e.message : 'Could not start it'); }
  };

  // Where each reviewed card stands: still to decide, cut, or kept for good.
  const entryOf = (name: string) => main.find((c) => c.card.name === name);
  const stateOf = (name: string): 'open' | 'cut' | 'kept' => acted[name] ?? (state?.settled?.kept.includes(name) ? 'kept' : !entryOf(name) || state?.settled?.cut.includes(name) ? 'cut' : 'open');
  const act = async (name: string, what: 'cut' | 'keep' | 'undo') => {
    const entry = entryOf(name) ?? cards.find((c) => c.card.name === name);
    if (!entry) return;
    setBusy(true);
    try {
      if (what === 'cut') { await onMove(entry.card.id, cutTo); setActed((a) => ({ ...a, [name]: 'cut' })); }
      else if (what === 'keep') { await api.keepCard(listId, entry.card.oracle_id ?? entry.card.id, true); setActed((a) => ({ ...a, [name]: 'kept' })); }
      else {
        const was = stateOf(name);
        if (was === 'cut') await onMove(entry.card.id, 'main');
        if (was === 'kept') await api.keepCard(listId, entry.card.oracle_id ?? entry.card.id, false);
        setActed((a) => { const n = { ...a }; delete n[name]; return n; });
      }
    } finally { setBusy(false); }
  };
  const cutMany = async (names: string[]) => { for (const n of names) await act(n, 'cut'); };
  const discuss = onAsk ? (item: ReviewItem) => onAsk(`About ${item.name}: in the cut review you said ${item.tier ? `tier ${item.tier}` : `"${item.verdict}"`} - ${item.why} I'd like to talk it through.`) : undefined;
  const settledBefore = (state?.settled?.cut.length ?? 0) + (state?.settled?.kept.length ?? 0);

  return (
    <div data-tour="cut-review" className="flex flex-col gap-4">
      <div role="radiogroup" aria-label="What Claude reviews" className="grid max-w-3xl gap-2 sm:grid-cols-2">
        {([
          ['top', `The top of the cut list · ${size} cards`, `About twice what you're over${over > 0 ? ` (${over})` : ''}. Cards you've cut or ★ kept have left the list.`],
          ['whole', `The whole deck · ${main.length} cards, in tiers`, 'Every card S, A, B or C against your plan, with a way to disagree. A longer request: about four times a quick one, around a minute.'],
        ] as const).map(([m, title, note]) => (
          <button key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
            className={`rounded-2xl border px-3.5 py-2.5 text-left text-sm ${mode === m ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-hover)]'}`}>
            <b>{title}</b>
            <span className="mt-0.5 block text-xs text-[var(--muted)]">{note}</span>
          </button>
        ))}
      </div>
      {review && (
        <p className="max-w-3xl rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-sm">
          <b>Last time</b> <span className="text-[var(--muted)]">({new Date(review.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })})</span>{' '}
          {settledBefore
            ? <>you cut {state?.settled?.cut.length ?? 0} and kept {state?.settled?.kept.length ?? 0} of what Claude looked at. Those won&apos;t come up again, and the next review is told what it said before so it doesn&apos;t repeat itself.</>
            : <>nothing has been cut or ★ kept from it yet. Use the buttons below - the next review is told what it said and skips what you&apos;ve settled.</>}
        </p>
      )}
      <label className="flex max-w-3xl flex-col gap-1 text-sm">
        Your instructions <span className="text-xs text-[var(--muted)]">(optional, added to everything above)</span>
        <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2} maxLength={2000}
          placeholder="e.g. Keep anything that attacks alone. I'd rather cut ramp than draw. Nothing over $5 stays just for value."
          className="resize-y rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 outline-none focus:border-[var(--accent)]" />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={start} disabled={running} className="btn-go rounded-full px-4 py-1.5 text-sm font-semibold disabled:opacity-60">
          {running ? `${state?.job?.detail || 'Reviewing'}…` : mode === 'whole' ? 'Rate the whole deck' : review ? `Review the next ${size}` : `Review the top ${size}`}
        </button>
        <Tip label="What Claude reads"><span className="font-semibold">What Claude reads:</span><ul className="mt-1 list-disc pl-4">{AI_READS.cutReview.map((x) => <li key={x}>{x}</li>)}</ul></Tip>
        <AiModelPicker area="deck" />
      </div>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {failed && <p className="text-sm text-red-400">The review did not finish: {failed.error}</p>}
      {review && (review.mode === 'whole'
        ? <Tiers listId={listId} review={review} stateOf={stateOf} busy={busy} onAct={act} onCutMany={cutMany} onDiscuss={discuss} onChanged={onChanged} over={over} cutName={cutName} />
        : <Verdicts review={review} stateOf={stateOf} busy={busy} onAct={act} onCutMany={cutMany} onDiscuss={discuss} over={over} cutName={cutName} />)}
    </div>
  );
}

/**
 * "Cut them all", stopping at 100: it takes the best of them, as many as the
 * deck is over, and says so. At 100 or under there is nothing to cut without
 * adding something, so it says that instead.
 */
function BulkCut({ names, over, what, cutName, busy, onCutMany }: {
  names: string[]; over: number; what: string; cutName: string; busy: boolean; onCutMany: (names: string[]) => Promise<void>;
}) {
  if (!names.length) return null;
  if (over <= 0) return <span className="ml-auto text-xs text-[var(--muted)]">At {100 + over} cards: each cut now needs a card added.</span>;
  const take = capCuts(names, over);
  return (
    <button onClick={() => onCutMany(take)} disabled={busy} title={`Moves them to ${cutName}`}
      className="btn-go ml-auto rounded-full px-3.5 py-1.5 text-sm font-semibold disabled:opacity-60">
      {take.length < names.length ? `Cut ${take.length} of the ${names.length} ${what}, to reach 100` : `Cut the ${names.length} ${what}`}
    </button>
  );
}

type Act = (name: string, what: 'cut' | 'keep' | 'undo') => Promise<void>;

/** Where a reviewed card stands, with undo. */
function Done({ name, how, busy, onAct, cutName }: { name: string; how: 'cut' | 'kept'; busy: boolean; onAct: Act; cutName: string }) {
  return (
    <span className="flex shrink-0 items-center gap-2 text-xs">
      <span className={how === 'cut' ? 'font-semibold text-[#ffb4a8]' : 'font-semibold text-emerald-300'}>{how === 'cut' ? `Cut - in ${cutName}` : 'Kept ★ never cut'}</span>
      <button onClick={() => onAct(name, 'undo')} disabled={busy} className="text-[var(--muted)] underline hover:text-[var(--foreground)]">Undo</button>
    </span>
  );
}

function Verdicts({ review, stateOf, busy, onAct, onCutMany, onDiscuss, over, cutName }: {
  review: CutReview; stateOf: (name: string) => 'open' | 'cut' | 'kept'; busy: boolean; onAct: Act;
  onCutMany: (names: string[]) => Promise<void>; onDiscuss?: (item: ReviewItem) => void; over: number; cutName: string;
}) {
  const agreed = review.items.filter((i) => i.verdict === 'cut' && stateOf(i.name) === 'open').map((i) => i.name);
  const cutNow = review.items.filter((i) => stateOf(i.name) === 'cut').length;
  return (
    <section data-section="Claude's notes" data-section-count={String(review.items.length)} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-sm">
        <span>{review.items.length} cards reviewed · {cutNow ? `${cutNow} cut so far` : `Claude agrees on ${agreed.length} cut${agreed.length === 1 ? '' : 's'}`}{review.instructions && <span className="text-[var(--muted)]"> · your instructions: &ldquo;{review.instructions}&rdquo;</span>}</span>
        {agreed.length > 0 && (
          <BulkCut names={agreed} over={over} what="Claude agrees on" cutName={cutName} busy={busy} onCutMany={onCutMany} />
        )}
      </div>
      <ul className="flex flex-col gap-1.5">
        {review.items.map((i) => {
          const at = stateOf(i.name);
          return (
            <li key={i.name} className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm ${at !== 'open' ? 'opacity-60' : ''}`}>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-baseline gap-x-3"><span className="font-medium">{i.name}</span><Verdict item={i} /></span>
                <span className="text-[var(--muted)]">{i.why}</span>
              </span>
              {at === 'open' ? (
                <span className="flex shrink-0 gap-1.5">
                  <button onClick={() => onAct(i.name, 'cut')} disabled={busy} className={`rounded-full px-3 py-1 text-xs font-semibold disabled:opacity-50 ${i.verdict === 'cut' ? 'bg-[#ffb4a8] text-[#1c0d06]' : 'border border-[var(--border)]'}`}>Cut it</button>
                  <button onClick={() => onAct(i.name, 'keep')} disabled={busy} className={`rounded-full px-3 py-1 text-xs font-semibold disabled:opacity-50 ${i.verdict === 'keep' ? 'bg-emerald-300 text-[#04170d]' : 'border border-[var(--border)]'}`}>Keep ★</button>
                  {onDiscuss && <button onClick={() => onDiscuss(i)} className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--muted)] hover:text-[var(--foreground)]">Discuss</button>}
                </span>
              ) : <Done name={i.name} how={at} busy={busy} onAct={onAct} cutName={cutName} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Tiers({ listId, review, stateOf, busy, onAct, onCutMany, onDiscuss, onChanged, over, cutName }: {
  listId: string; review: CutReview; stateOf: (name: string) => 'open' | 'cut' | 'kept'; busy: boolean; onAct: Act;
  onCutMany: (names: string[]) => Promise<void>; onDiscuss?: (item: ReviewItem) => void; onChanged: () => void; over: number; cutName: string;
}) {
  const [tab, setTab] = useState<Tier | 'all'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [want, setWant] = useState<Tier | null>(null);
  const [reason, setReason] = useState('');
  const [rerating, setRerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = review.items.filter((i) => i.tier);
  const count = (t: Tier) => items.filter((i) => i.tier === t).length;
  const shown = TIERS.flatMap((t) => (tab === 'all' || tab === t ? items.filter((i) => i.tier === t) : []));
  const cTier = items.filter((i) => i.tier === 'C' && stateOf(i.name) === 'open').map((i) => i.name);
  const rerate = async (item: ReviewItem) => {
    setRerating(true);
    setError(null);
    try { await api.rerateCut(listId, item.name, want, reason); setOpen(null); setReason(''); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not re-rate it'); }
    finally { setRerating(false); }
  };
  return (
    <section data-section="Tiers" data-section-count={String(items.length)} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {(['all', ...TIERS] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} aria-pressed={tab === t}
            style={t !== 'all' ? { color: TIER_TONE[t], borderColor: tab === t ? TIER_TONE[t] : undefined } : undefined}
            className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold ${tab === t ? 'bg-[var(--surface-hover)]' : 'border-[var(--border)]'} ${t === 'all' && tab === t ? 'border-[var(--accent)]' : ''}`}>
            {t === 'all' ? 'All' : t} <span className="opacity-70">{t === 'all' ? items.length : count(t)}</span>
          </button>
        ))}
        {review.instructions && <span className="text-xs text-[var(--muted)]">your instructions: &ldquo;{review.instructions}&rdquo;</span>}
        {cTier.length > 0 && (
          <BulkCut names={cTier} over={over} what="C-tier" cutName={cutName} busy={busy} onCutMany={onCutMany} />
        )}
      </div>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <ul className="grid gap-2 lg:grid-cols-2">
        {shown.map((i) => {
          const at = stateOf(i.name);
          const isOpen = open === i.name;
          return (
            <li key={i.name} className={`flex flex-col rounded-xl border bg-[var(--surface)] px-3 py-2.5 text-sm ${isOpen ? 'border-[var(--accent)]' : 'border-[var(--border)]'} ${at !== 'open' ? 'opacity-60' : ''}`}>
              <div className="flex items-start gap-2.5">
                <span aria-label={`Tier ${i.tier}`} style={{ background: TIER_TONE[i.tier!] }} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm font-extrabold text-[#15110a]">{i.tier}</span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-medium">{i.name}</span>
                  <span className="text-[var(--muted)]">{i.why}</span>
                  {i.disputed && <span className="text-xs text-emerald-300">Re-rated{i.disputed.from ? ` from ${i.disputed.from}` : ''} with your reason{i.tier === 'S' || i.tier === 'A' ? ' - now ★ kept, so it is never offered as a cut' : ''}.</span>}
                </span>
                {at === 'open'
                  ? <button onClick={() => { setOpen(isOpen ? null : i.name); setWant(null); setReason(''); }} className="shrink-0 rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--muted)] hover:text-[var(--foreground)]">{isOpen ? 'Close' : 'Disagree'}</button>
                  : <Done name={i.name} how={at} busy={busy} onAct={onAct} cutName={cutName} />}
              </div>
              {isOpen && (
                <div className="mt-2.5 flex flex-col gap-2 border-t border-dashed border-[var(--border)] pt-2.5">
                  <span className="flex items-center gap-1.5 text-xs text-[var(--muted)]">It should be
                    {TIERS.map((t) => (
                      <button key={t} onClick={() => setWant(t)} aria-pressed={want === t} style={{ color: TIER_TONE[t], borderColor: want === t ? TIER_TONE[t] : undefined }}
                        className={`h-7 w-8 rounded-md border text-xs font-extrabold ${want === t ? 'bg-[var(--surface-hover)]' : 'border-[var(--border)]'}`}>{t}</button>
                    ))}
                  </span>
                  <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} aria-label="Why"
                    placeholder="Why? e.g. it's my only way to recast wheels"
                    className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 outline-none focus:border-[var(--accent)]" />
                  <span className="flex flex-wrap gap-2">
                    <button onClick={() => rerate(i)} disabled={rerating || (!want && !reason.trim())} className="rounded-full bg-[var(--accent)] px-3 py-1 text-xs font-semibold text-[#221c08] disabled:opacity-50">
                      {rerating ? 'Re-rating…' : 'Re-rate with my reason'}
                    </button>
                    {i.tier === 'C' && <button onClick={() => onAct(i.name, 'cut')} disabled={busy} className="rounded-full border border-[var(--border)] px-3 py-1 text-xs">Cut it</button>}
                    {onDiscuss && <button onClick={() => onDiscuss(i)} className="rounded-full border border-[var(--border)] px-3 py-1 text-xs">Discuss in Chat</button>}
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
