'use client';

/**
 * Finish the deck from your cards (lib/finish.ts), as one conversation, the
 * way Trim runs: choose which of your cards may be used and how many to add,
 * watch Claude search your cards, then mark each pick Add, Rethink or Skip
 * and say something back. Review and apply adds the cards (and, on a full
 * fill, the app's lands) after a snapshot; Undo puts the deck back exactly.
 *
 * The UI rules: nothing on a row moves when its state changes, the count bar
 * is one sticky element, no box opens on a choice, and a row's columns open
 * by the row's own width (a container query). Choices are kept in the page
 * and saved in the background; Claude runs in the background, so leaving the
 * page loses nothing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import CardName from './CardName';
import ManaCost from './ManaCost';
import { C } from './PlanTab';
import SymbolText from './SymbolText';
import Tip from './Tip';
import { AI_READS } from '@/lib/ai-reads';
import * as api from '@/lib/api';
import { chosenAdds, completeCombos, COPIES, FINISH_GROUPS, FINISH_TITLE, SEARCH_LIMIT, SEARCH_LIMIT_LATER, type FinishChoice, type FinishItem, type FinishView } from '@/lib/finish-shared';
import { price } from '@/lib/price';
import type { ScryfallCard } from '@/lib/scryfall';

interface Props {
  listId: string;
  /** Changes when the deck does, to read Finish again. */
  version: string;
  /** After applying or undoing, the deck page reads the deck again. */
  onChanged: () => Promise<void> | void;
  onTab: (tab: string) => void;
  /** Open a card the way the card view does. */
  onCard?: (card: ScryfallCard) => void;
  /** The free picks from the deck's numbers, shown below by Tune. */
  showFree: boolean;
  onFree: (show: boolean) => void;
}

const CARD = 'rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4';
const H3 = 'text-[12px] font-semibold uppercase tracking-wide text-[var(--muted)]';
const LINK = 'min-h-11 px-0.5 text-[13px] text-[var(--muted)] underline underline-offset-[3px] hover:text-[var(--foreground)] disabled:opacity-50';
const POLL_MS = 2_000;
const SAVE_MS = 350;
const QUICK = [5, 10, 25];

const HINT: Record<FinishChoice, string> = { add: 'your reason, if you have one', ask: 'what should Claude weigh?', skip: 'you skipped it. why?' };
const LABEL: Record<FinishChoice, string> = { add: 'Add', ask: 'Rethink', skip: 'Skip' };
const LIT: Record<FinishChoice, string> = { add: 'bg-[#16301f] text-[#7fd6a0]', ask: 'bg-[#241d2e] text-[#c4a6f5]', skip: 'bg-[#3a211b] text-[#f0714f]' };

const groupKey = (i: Pick<FinishItem, 'group' | 'theme'>) => (i.group === 'theme' && i.theme ? `theme:${i.theme}` : i.group);
const groupTitle = (k: string) => (k.startsWith('theme:') ? `Theme: ${k.slice(6)}` : FINISH_TITLE[k as keyof typeof FINISH_TITLE] ?? k);
const groupOrder = (k: string) => FINISH_GROUPS.indexOf((k.startsWith('theme:') ? 'theme' : k) as (typeof FINISH_GROUPS)[number]);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function DeckFinish({ listId, version, onChanged, onTab, onCard, showFree, onFree }: Props) {
  const [view, setView] = useState<FinishView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<FinishView['choices']>({});
  const [message, setMessage] = useState('');
  const [review, setReview] = useState(false);
  const [wantText, setWantText] = useState('');
  const dirty = useRef(false);
  const runId = useRef<string | null>(null);

  const take = useCallback((v: FinishView) => {
    setView(v);
    setError(null);
    const fresh = runId.current !== (v.run?.id ?? null);
    if (fresh || !dirty.current) setChoices(v.choices);
    // A new list answered what was sent: the box starts empty again and the list is back.
    if (fresh) { setMessage(''); setReview(false); }
    runId.current = v.run?.id ?? null;
    setWantText(String(v.want ?? (v.howMany.nonland || 5)));
  }, []);

  useEffect(() => {
    let stop = false;
    api.finish(listId).then((v) => { if (!stop) take(v); }).catch((e) => { if (!stop) setError(e instanceof Error ? e.message : 'Couldn’t read the deck just now'); });
    return () => { stop = true; };
  }, [listId, version, take]);

  // Claude runs in the background: look until it finishes, with its searches as they come.
  const running = view?.job?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => { void api.finish(listId).then(take).catch(() => {}); }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, listId, take]);

  // Choices are saved a moment after the last change.
  useEffect(() => {
    if (!dirty.current) return;
    const timer = setTimeout(() => {
      dirty.current = false;
      void api.finishAct(listId, { action: 'choices', choices }).catch(() => { dirty.current = true; });
    }, SAVE_MS);
    return () => clearTimeout(timer);
  }, [choices, listId]);

  const act = async (action: api.FinishAction, after?: () => Promise<void> | void) => {
    setBusy(true);
    setError(null);
    try {
      if (dirty.current) { dirty.current = false; await api.finishAct(listId, { action: 'choices', choices }); }
      take(await api.finishAct(listId, action));
      await after?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not do that');
    } finally {
      setBusy(false);
    }
  };

  const items = useMemo(() => view?.run?.items ?? [], [view]);
  const adds = useMemo(() => chosenAdds(items, choices), [items, choices]);
  const open = (cardId: string) => { if (onCard) void api.finishCard(listId, cardId).then(onCard).catch(() => {}); };
  if (error && !view) return <p className="mt-4 text-sm text-red-400">{error}</p>;
  if (!view) return <p className="mt-4 text-sm text-[var(--muted)]">Reading your cards…</p>;

  const run = view.run;
  const stateOf = (name: string): FinishChoice => choices[name]?.choice ?? 'add';
  const choose = (item: FinishItem, change: Partial<{ choice: FinishChoice; text: string }>) => {
    dirty.current = true;
    setChoices((c) => {
      const next = { ...c, [item.name]: { choice: c[item.name]?.choice ?? 'add', text: c[item.name]?.text ?? '', ...change } };
      if (next[item.name].choice === 'add' && !next[item.name].text.trim()) delete next[item.name];
      return next;
    });
  };
  const nameOf = (i: { name: string; card: { id: string; image: string | null } }) => (
    <CardName name={i.name} card={{ id: i.card.id, name: i.name, image_uris: i.card.image ? { normal: i.card.image } : undefined } as unknown as ScryfallCard} onOpen={() => open(i.card.id)} className="font-bold" />
  );

  // --- done: what happened, and the way back ------------------------------------------------
  if (view.done) {
    const d = view.done;
    return (
      <section className={`${CARD} flex flex-col gap-3`} data-finish-done data-section="Finish">
        <h3 className="font-display text-2xl font-semibold">Added {plural(d.added + d.lands, 'card')}. The deck is at {d.size}.</h3>
        <p className="text-sm text-[var(--muted)]">{d.added} from your picks{d.lands ? ` and ${d.lands} lands chosen by the app` : ''}. A snapshot from before is in History.</p>
        {d.borrowed.length > 0 && <p className="text-sm text-amber-300">These stay in the decks they’re in, so you have no spare copy of them now: {d.borrowed.join('; ')}.</p>}
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        <div className="flex flex-wrap gap-2">
          {d.size > 100 ? <button className={C.go} onClick={() => onTab('tune')}>Next: Trim {d.size - 100}</button> : <button className={C.go} onClick={() => onTab('check')}>Check mana and curve</button>}
          <button className={C.btn} disabled={busy} onClick={() => act({ action: 'undo' }, onChanged)}>Undo</button>
          <button className={C.btn} disabled={busy} onClick={() => act({ action: 'reset' })}>Finish again</button>
        </div>
      </section>
    );
  }

  const counts = view.counts;
  const full = view.howMany.nonland;
  const wanted = Math.max(1, Math.round(Number(wantText)) || 0);
  const isFull = full > 0 && wanted === full;
  const setWant = (n: number | null) => { setWantText(String(n ?? full)); void act({ action: 'settings', want: n === null || n === full ? null : n }); };
  const cost = price(run ? view.cost.later : view.cost.first);
  const combosLine = view.combos.mode === 'first' ? 'Your plan says build around them: the app finds the combos you own every piece of and sends that list with the request.'
    : view.combos.mode === 'none' ? 'Your plan says none: the app sends the combos you own as “leave a piece of each out”, and checks the picks itself after every round.'
      : 'Your plan doesn’t say, so nothing about combos is sent.';

  // --- setup -------------------------------------------------------------------------------
  const setup = !run && !running && (
    <div className={`${CARD} flex flex-col gap-4`} data-finish-setup>
      <div className="flex flex-col gap-2">
        <h4 className={H3}>Which of your cards may be used</h4>
        <div role="radiogroup" aria-label="Which of your cards may be used" className="grid gap-2 sm:grid-cols-2">
          {COPIES.map((o) => {
            const on = view.copies === o.id;
            const n = counts ? (o.id === 'spare' ? counts.spare : counts.any) : null;
            return (
              <button key={o.id} type="button" role="radio" aria-checked={on} disabled={busy} onClick={() => act({ action: 'settings', copies: o.id })} data-copies={o.id}
                className={`flex flex-col gap-0.5 rounded-xl border px-3 py-2.5 text-left ${on ? 'border-[#d6aa2e] bg-[#d6aa2e]/[0.06]' : 'border-[var(--border)] hover:bg-[var(--surface-hover)]'}`}>
                <b className="text-sm">{o.label}</b>
                <span className="text-[13px] text-[var(--muted)]">{o.why}{n !== null ? ` ${n.toLocaleString()} cards on offer${o.id === 'any' && counts!.otherOnly ? ` (${counts!.otherOnly.toLocaleString()} more are only in other decks)` : ''}.` : ''}</span>
              </button>
            );
          })}
        </div>
        {counts && <p className="text-xs text-[var(--faint)]">{counts.held.toLocaleString()} different cards you own; {counts.fit.toLocaleString()} fit the commander’s colours and are Commander-legal. Lands, cards already in the deck, and anything past your budget, deck rule or bracket are left out. Claude only ever sees the cards on offer.</p>}
      </div>
      <div className="flex flex-col gap-1">
        <h4 className={H3}>Combos · from your plan</h4>
        <p className="text-[13px] text-[var(--muted)]">{combosLine} <button type="button" className="underline underline-offset-[3px] hover:text-[var(--foreground)]" onClick={() => onTab('plan')}>Change it on the Plan tab</button></p>
      </div>
      <div className="flex flex-col gap-2">
        <h4 className={H3}><label htmlFor="finish-howmany">How many cards</label></h4>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">Add</span>
          <input id="finish-howmany" type="number" min={1} inputMode="numeric" value={wantText} onChange={(e) => setWantText(e.target.value)}
            onBlur={() => { if (wanted !== (view.want ?? full)) setWant(wanted); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            className={`${C.input} w-20 text-center font-semibold tabular-nums`} />
          {QUICK.map((n) => <button key={n} type="button" aria-pressed={wanted === n && !isFull} className={`${C.pill} min-h-10 ${wanted === n && !isFull ? C.on : C.off}`} onClick={() => setWant(n)}>{n}</button>)}
          <button type="button" aria-pressed={isFull} disabled={!full} className={`${C.pill} min-h-10 disabled:opacity-40 ${isFull ? C.on : C.off}`} onClick={() => setWant(null)}>Fill to 100</button>
        </div>
        <p className="text-[13px] text-[var(--muted)]" data-finish-howmany-note>
          {isFull ? `Fills the deck from ${view.size} to 100: ${full} cards by Claude and ${view.howMany.lands} lands by the app.`
            : `Takes the deck from ${view.size} to ${view.size + wanted}${view.size + wanted > 100 ? `, ${view.size + wanted - 100} over: Trim them back after` : ''}. No lands: the app adds lands only on a fill to 100.`}
        </p>
      </div>
      <p className="text-sm text-[var(--muted)]"><b className="text-[#e8c558]">Your plan:</b> {view.plan.text ? <SymbolText text={view.plan.text} /> : 'not written yet. Claude goes by the commander and your settings.'}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button className={C.go} disabled={busy || view.noKey} onClick={() => act({ action: 'find' })} data-finish-go>
          ✦ {isFull ? 'Finish from my collection' : `Find ${plural(wanted, 'card')} in my collection`} · Claude Opus · {cost}
        </button>
        <button type="button" className={LINK} aria-pressed={showFree} onClick={() => onFree(!showFree)}>{showFree ? 'Hide the free picks' : 'Fill from the deck’s numbers · free'}</button>
        <Tip label="What Claude reads"><span className="flex flex-col gap-1">{AI_READS.finishPicks.map((r) => <span key={r}>• {r}</span>)}<span>At most {SEARCH_LIMIT} searches on the first list and {SEARCH_LIMIT_LATER} on each later one, counted by the app.</span></span></Tip>
      </div>
      {view.noKey && <p className="text-xs text-amber-300">No Claude key is set on the server. “Fill from the deck’s numbers” works without one.</p>}
    </div>
  );

  // --- the searches, as they run --------------------------------------------------------------
  const searchList = view.searches.length > 0 && (
    <ol className="flex max-h-64 flex-col overflow-auto font-mono text-[13px] leading-relaxed text-[var(--muted)]" aria-live="polite">
      {view.searches.map((x, k) => (
        <li key={k} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3"><span className="break-words text-[var(--foreground)]">{x.q}</span><span className={x.n ? '' : 'text-amber-300'}>{x.n ? `${x.n} of your cards` : 'nothing'}</span></li>
      ))}
    </ol>
  );
  // While Claude runs, the searches show as they come; once the picks are in, they fold away under one line.
  const searches = running ? (
    <div role="status" className={`${CARD} flex flex-col gap-2 border-[#c3a6e6]/60`} data-finish-running>
      <h4 className={H3}>{view.job?.detail || 'Claude is searching your cards'}</h4>
      {searchList || <p className="text-sm text-[var(--muted)]">Reading the plan…</p>}
      <span className="text-xs text-[var(--faint)]">It runs in the background: you can switch tabs, and the picks will be here when you come back.</span>
    </div>
  ) : run && view.searches.length > 0 ? (
    <details className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]" data-finish-searches>
      <summary className="cursor-pointer px-4 py-2.5 text-[13px] text-[var(--muted)]">Claude’s searches in round {run.round} · {plural(view.searches.length, 'search', 'searches')} over your cards</summary>
      <div className="border-t border-[var(--border)] px-4 py-3">{searchList}</div>
    </details>
  ) : null;

  if (!run) {
    return (
      <section className="flex flex-col gap-4" data-section="Finish" data-finish>
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        {view.job?.status === 'failed' && <p role="alert" className="text-sm text-red-400">Claude didn’t finish: {view.job.error}</p>}
        {setup}
        {searches}
      </section>
    );
  }

  // --- the picks --------------------------------------------------------------------------------
  const asks = items.filter((i) => stateOf(i.name) === 'ask');
  const skips = items.filter((i) => stateOf(i.name) === 'skip');
  const lands = run.full && run.lands ? run.lands.total : 0;
  const total = view.size + adds.length + lands;
  const borrowed = items.filter((i) => i.src === 'other' && adds.includes(i.name));
  const canSend = asks.length > 0 || skips.length > 0 || !!message.trim();
  const groups = [...new Set(items.map(groupKey))].sort((a, b) => groupOrder(a) - groupOrder(b));
  const complete = completeCombos(view.combos.found, [...view.combos.base, ...adds]);
  const sub = [
    `Round ${run.round}. ${plural(adds.length, 'pick')}${lands ? ` + ${lands} lands` : ''} takes the deck from ${view.size} to ${total}.`,
    borrowed.length ? `${borrowed.length} only in other decks.` : '',
    asks.length ? `${asks.length} to rethink.` : '',
    skips.length ? `${skips.length} skipped.` : '',
    adds.length > run.want ? `${adds.length - run.want} more than you asked for, which is fine.` : adds.length < run.want ? `${run.want - adds.length} short: send to have Claude fill them, or apply as is.` : '',
  ].filter(Boolean).join(' ');

  if (review) {
    const byGroup = groups.map((g) => ({ g, names: items.filter((i) => groupKey(i) === g && adds.includes(i.name)) })).filter((x) => x.names.length);
    return (
      <section className="flex flex-col gap-4" data-section="Finish" data-finish-review>
        <div className={`${CARD} flex flex-col gap-3`}>
          <h3 className="font-display text-xl font-semibold">Review and apply</h3>
          <p className="text-sm text-[var(--muted)]">Nothing has changed in the deck yet.</p>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm tabular-nums">
            <dt className="text-right font-mono font-semibold">{adds.length}</dt><dd>cards picked for the deck</dd>
            {lands > 0 && <><dt className="text-right font-mono font-semibold">{lands}</dt><dd>lands chosen by the app</dd></>}
            {skips.length > 0 && <><dt className="text-right font-mono font-semibold">{skips.length}</dt><dd>skipped, left out</dd></>}
            <dt className="text-right font-mono font-semibold">{view.size} → {total}</dt><dd>{total > 100 ? `deck size: ${total - 100} over, Trim next` : total < 100 ? `deck size: ${100 - total} still to go` : 'deck size: full'}</dd>
          </dl>
          {borrowed.length > 0 && (
            <p className="text-sm text-amber-300" data-finish-borrowed>You don’t have a spare copy of {borrowed.length === 1 ? 'this card' : 'these'}: {borrowed.map((i) => `${i.name} (in ${i.deck})`).join('; ')}. {borrowed.length === 1 ? 'It stays' : 'They stay'} in that deck; applying only lists {borrowed.length === 1 ? 'it' : 'them'} here too.</p>
          )}
          {asks.length > 0 && <p className="text-sm text-amber-300">{plural(asks.length, 'card is', 'cards are')} still on Rethink and will be left out: {asks.map((i) => i.name).join('; ')}. Go back and send to have Claude look again.</p>}
          <div className="flex flex-col gap-2.5">
            {byGroup.map(({ g, names }) => (
              <div key={g} className="flex flex-col gap-1">
                <h4 className={H3}>{groupTitle(g)} · {names.length}</h4>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">{names.map((i) => <span key={i.name}>{nameOf(i)}{i.src === 'other' && <span className="ml-1 text-xs text-amber-300">in {i.deck}</span>}</span>)}</div>
              </div>
            ))}
            {lands > 0 && run.lands && (
              <div className="flex flex-col gap-1"><h4 className={H3}>Lands · {lands}</h4>
                <p className="text-sm text-[var(--muted)]">{[...run.lands.names, ...run.lands.basics.map((b) => `${b.n} ${b.name}`)].join(', ')}</p></div>
            )}
            {skips.length > 0 && <p className="text-sm text-[var(--muted)]"><b className="text-[var(--foreground)]">Skipped:</b> {skips.map((i) => i.name).join('; ')}</p>}
          </div>
        </div>
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        <div className={`${CARD} flex flex-wrap items-center gap-3`}>
          <span className="min-w-0 flex-[1_1_16rem] text-[13px] text-[var(--muted)]">A snapshot is saved first. Undo puts every card back where it was, Maybeboard cards included.</span>
          <button className={C.btn} onClick={() => setReview(false)}>Back to the picks</button>
          <button className={C.go} disabled={busy || !adds.length} onClick={() => act({ action: 'apply' }, onChanged)} data-finish-apply>Apply · add {plural(adds.length + lands, 'card')}</button>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4" data-section="Finish" data-finish>
      {/* One sticky bar, the same element throughout: the count, the round, what the deck becomes. */}
      <div className="sticky top-[calc(env(safe-area-inset-top)+4rem)] z-10 flex flex-col gap-1.5 rounded-2xl border border-[#ef6a4c] bg-[var(--surface)] p-3 shadow-lg sm:p-3.5" data-finish-bar>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <b className="font-display text-xl tabular-nums" data-finish-count>{adds.length} of {run.want} to add</b>
          <span className="ml-auto flex flex-wrap gap-2">
            <button className={C.btn} disabled={busy || running} onClick={() => act({ action: 'reset' })}>Start over</button>
            <button className={C.go} disabled={busy || running || !adds.length} onClick={() => { setReview(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Review and apply</button>
          </span>
        </div>
        <span className="text-[13px] text-[var(--muted)]" data-finish-sub>{sub}</span>
      </div>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {view.job?.status === 'failed' && <p role="alert" className="text-sm text-red-400">Claude didn’t finish: {view.job.error}</p>}
      {searches}

      {/* Say what to change: above the list, as Trim's reply box sits above its list. */}
      <div className={`${CARD} flex flex-col gap-2`} data-finish-say>
        {run.reply && <p className="text-[13px] text-[var(--muted)]"><span className={`font-semibold ${C.ai}`}>✦ Claude{run.round > 1 ? `, list ${run.round}` : ''}:</span> <SymbolText text={run.reply} /></p>}
        {(run.short > 0 || run.dropped > 0) && <p className="text-[13px] text-amber-300">{run.short > 0 ? `${plural(run.short, 'pick')} short of what you asked for: Claude found no more it would put in. ` : ''}{run.dropped > 0 ? `${plural(run.dropped, 'name')} Claude gave ${run.dropped === 1 ? 'wasn’t' : 'weren’t'} among your cards on offer and ${run.dropped === 1 ? 'was' : 'were'} left out.` : ''}</p>}
        <label htmlFor="finish-say" className="flex flex-wrap items-baseline gap-x-2 font-bold">Say what to change <span className="text-[13px] font-normal text-[var(--muted)]">optional{run.round > 1 ? ' · the earlier rounds are part of the conversation' : ''}</span></label>
        <textarea id="finish-say" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1500}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSend && !busy && !running) { e.preventDefault(); void act({ action: 'find', rerun: true, message }); } }}
          placeholder="For example: fewer counterspells, more one-mana cantrips. Or mark cards Rethink or Skip below and say why on their line."
          className={`${C.input} w-full resize-y py-2.5`} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="min-w-0 flex-[1_1_14rem] text-[13px] text-[var(--muted)]">Add takes the card. Skip leaves it out for good. Rethink asks Claude again with your reason. Hover or focus a name to read the card.</p>
          <button className={C.aiBtn} disabled={busy || running || !canSend || view.noKey} onClick={() => act({ action: 'find', rerun: true, message })} title={canSend ? undefined : 'Mark a card Rethink or Skip, or type something, first'} data-finish-send>✦ Send · {cost}</button>
        </div>
      </div>

      {(view.combos.mode || complete.length > 0 || view.combos.failed) && (
        <div className={`${CARD} flex flex-col gap-1.5`} data-finish-combos>
          <h4 className={H3}>Combos in this build · {complete.length} complete{view.combos.owned !== null ? `, of the ${view.combos.owned} you own every piece of` : ''}</h4>
          <p className="text-[13px] text-[var(--muted)]">
            {view.combos.failed ? 'The combo lookup didn’t answer, so this round ran without the list. ' : ''}
            {view.combos.mode === 'first' ? 'Your plan says build around them, so the app gave Claude the list of combos you own.'
              : view.combos.mode === 'none' ? (complete.length ? 'Your plan says no combos. Skip one piece of each to break it.' : 'Your plan says no combos, and none is complete. The app checks this after every round.')
                : complete.length ? 'Your plan doesn’t mention combos and Claude wasn’t asked for any. These are complete anyway.' : 'None.'}
          </p>
          {complete.map((c) => (
            <p key={c.id} className="text-[13px]">{c.cards.join(' + ')} <span className="text-[var(--muted)]">→ {c.produces.slice(0, 2).join(', ')}</span>{view.combos.mode === 'none' && <span className="ml-1 text-amber-300">skip one piece to break it</span>}</p>
          ))}
        </div>
      )}

      <div className={`${CARD} flex flex-col gap-1`} data-finish-list>
        {groups.map((g) => {
          const rows = items.filter((i) => groupKey(i) === g);
          const more = run.more[g];
          return (
            <div key={g} className="flex flex-col" data-finish-group={g}>
              <div className="flex flex-wrap items-baseline gap-x-3 pb-1 pt-3"><h4 className="font-display text-lg font-semibold">{groupTitle(g)}</h4><span className="text-sm text-[var(--muted)]">{rows.length}</span></div>
              {rows.map((i) => <Row key={i.name} item={i} state={stateOf(i.name)} text={choices[i.name]?.text ?? ''} name={nameOf(i)} onSet={(c) => choose(i, { choice: c })} onText={(t) => choose(i, { text: t })} />)}
              {more && (
                <details className="mt-2 rounded-xl border border-[var(--border)] bg-[var(--background)]" data-finish-more>
                  <summary className="cursor-pointer px-3 py-2 text-[13px]">See what else this search found · “{more.q}” · {plural(more.n, 'of your cards', 'of your cards')}</summary>
                  <ul className="flex flex-wrap gap-1.5 border-t border-[var(--border)] p-2.5">
                    {more.cards.map((c) => (
                      <li key={c.name}>
                        <button type="button" disabled={busy || running} onClick={() => act({ action: 'take', name: c.name, group: g.startsWith('theme:') ? 'theme' : g })} aria-label={`Add ${c.name}`}
                          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-[13px] hover:bg-[var(--surface-hover)] disabled:opacity-50">
                          <span aria-hidden="true">+</span>{c.name}{c.manaCost && <ManaCost cost={c.manaCost} size={12} />}
                        </button>
                      </li>
                    ))}
                    <li className="self-center px-1 text-xs text-[var(--faint)]">first {more.cards.length} not already picked · no paid round</li>
                  </ul>
                </details>
              )}
            </div>
          );
        })}
      </div>

      {lands > 0 && run.lands && (
        <div className={`${CARD} flex flex-col gap-1.5`} data-finish-lands>
          <h4 className={H3}>Lands · {lands} · chosen by the app, not by Claude</h4>
          {run.lands.names.length > 0 && <p className="text-[13px] text-[var(--muted)]"><b className="text-[var(--foreground)]">{plural(run.lands.names.length, 'land')} you own that make two or more of your colours:</b> {run.lands.names.join(', ')}.</p>}
          {run.lands.basics.length > 0 && <p className="text-[13px] text-[var(--muted)]"><b className="text-[var(--foreground)]">{plural(run.lands.basics.reduce((n, b) => n + b.n, 0), 'basic')}, split by the colour symbols on your cards:</b> {run.lands.basics.map((b) => `${b.n} ${b.name}`).join(', ')}.</p>}
          <p className="text-xs text-[var(--faint)]">{run.lands.why} Lands are added only when the run fills the deck to 100.</p>
        </div>
      )}
    </section>
  );
}

/**
 * One pick: four columns on every row, so nothing moves when its state
 * changes. Add | Rethink | Skip; the name, its cost and where the copy comes
 * from; Claude's reason; the owner's reason line, always there. On a narrow
 * row: the name on its own line, then the three buttons, then the reasons.
 */
function Row({ item, state, text, name, onSet, onText }: {
  item: FinishItem; state: FinishChoice; text: string; name: React.ReactNode; onSet: (c: FinishChoice) => void; onText: (t: string) => void;
}) {
  const chip = item.src === 'other' ? <span className="max-w-full truncate rounded-full border border-amber-300/50 px-2 text-[11px] text-amber-300" title={`In ${item.deck}`}>in {item.deck}</span>
    : item.src === 'maybe' ? <span className="rounded-full border border-[var(--border)] px-2 text-[11px] text-[var(--muted)]">in your Maybeboard</span>
      : <span className="rounded-full border border-emerald-400/40 px-2 text-[11px] text-emerald-300">spare copy</span>;
  const mark = item.mark === 'new' ? <span className="rounded-full border border-[#c4a6f5]/50 px-2 text-[11px] text-[#c4a6f5]">new this round</span>
    : item.mark === 'yours' ? <span className="rounded-full border border-[#e8c558]/50 px-2 text-[11px] text-[#e8c558]">you added it</span> : null;
  const off = state === 'skip' ? 'line-through opacity-50' : '';
  return (
    <div className="@container border-t border-[var(--border)] py-2.5" data-finish-row={item.name} data-state={state}>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1.5 @[66rem]:grid-cols-[auto_17rem_minmax(0,1fr)_15rem]">
        <span role="group" aria-label={item.name} className="inline-flex overflow-hidden rounded-[10px] border border-[var(--border)]" data-col="choice">
          {(['add', 'ask', 'skip'] as const).map((v) => (
            <button key={v} type="button" aria-pressed={state === v} onClick={() => onSet(v)} aria-label={`${LABEL[v]} ${item.name}`}
              title={v === 'ask' ? 'Give your reason and Claude weighs it on the next round. It may come back with the same card and an argument.' : v === 'skip' ? 'Left out, and never offered again in this conversation.' : undefined}
              className={`min-h-10 min-w-[3.6rem] px-3 text-sm font-bold ${state === v ? LIT[v] : 'text-[var(--faint)] hover:text-[var(--foreground)]'}`}>{LABEL[v]}</button>
          ))}
        </span>
        <span className="order-first col-span-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 @[66rem]:order-none @[66rem]:col-span-1" data-col="name">
          <span className={`min-w-0 break-words ${off}`}>{name}</span>
          {item.card.manaCost && <ManaCost cost={item.card.manaCost} size={13} />}
          {chip}{mark}
        </span>
        <span className={`col-span-2 min-w-0 text-[13px] text-[var(--muted)] @[66rem]:col-span-1 ${off}`} data-col="why"><span className="font-semibold text-[#c3a6e6]">✦</span> <SymbolText text={item.why} /></span>
        <input value={text} onChange={(e) => onText(e.target.value)} maxLength={300} data-col="reason" title={text.trim() || undefined}
          onBlur={(e) => { e.currentTarget.scrollLeft = 0; }} placeholder={HINT[state]} aria-label={`Your reason for ${item.name}`}
          className={`col-span-2 min-h-9 w-full min-w-0 truncate border-0 border-b border-[var(--border)] bg-transparent px-0.5 text-[13px] text-[#e2b93b] outline-none focus:border-[#e2b93b] @[66rem]:col-span-1 ${state === 'add' ? 'placeholder:text-[var(--faint)]' : 'placeholder:text-[#e2b93b]'}`} />
      </div>
    </div>
  );
}
