'use client';

/**
 * Upgrades (lib/upgrades.ts): "the deck is at 100; what would make it
 * better, from my boxes or to buy, and what does each replace?" One
 * conversation per deck, the way Finish runs: choose how many and where from,
 * watch Claude search your cards, then mark each suggestion Swap in, Rethink
 * or Not for me and say something back. Review and apply swaps the cards
 * after a snapshot; Undo puts the deck back exactly.
 *
 * The page rules, as Finish: one sticky bar that stays the same element,
 * nothing on a row moves when its state changes, a row's columns open by the
 * row's own width (container query), and no box opens on a choice.
 */

import { UPDATING_TITLE, useUpdating } from '@/lib/use-reach';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import CardName from './CardName';
import ListControls, { GroupHead, sortRows, useFilterFallback, useListView, useShown, type ListSort } from './ListControls';
import ManaCost from './ManaCost';
import { C } from './PlanTab';
import SymbolText from './SymbolText';
import Tip from './Tip';
import { AI_READS } from '@/lib/ai-reads';
import * as api from '@/lib/api';
import { roundPrice } from '@/lib/finish-shared';
import { price } from '@/lib/price';
import type { ScryfallCard } from '@/lib/scryfall';
import {
  buyListText, buyTotal, chosenIn, isBuy, ownLabel, UPGRADE_COUNTS, UPGRADE_SEARCHES, UPGRADE_SEARCHES_LATER, UPGRADE_SOURCES,
  type UpgradeChoice, type UpgradeItem, type UpgradesView, type UpgradeWhere,
} from '@/lib/upgrades-shared';

interface Props {
  listId: string;
  version: string;
  onChanged: () => Promise<void> | void;
  onTab: (tab: string) => void;
  onCard?: (card: ScryfallCard) => void;
  /** The free list from the deck's numbers, shown below by Tune (Part B). */
  showFree?: boolean;
  onFree?: (show: boolean) => void;
}

const CARD = 'rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4';
const H3 = 'text-[12px] font-semibold uppercase tracking-wide text-[var(--muted)]';
const LINK = 'min-h-11 px-0.5 text-[13px] text-[var(--muted)] underline underline-offset-[3px] hover:text-[var(--foreground)] disabled:opacity-50';
const POLL_MS = 2_000;
const SAVE_MS = 350;
const SORTS: Array<[ListSort, string]> = [['claude', 'Claude’s order'], ['price', 'By price'], ['mv', 'By mana value'], ['name', 'By name']];

const HINT: Record<UpgradeChoice, string> = { in: 'your reason, if you have one', ask: 'what should Claude weigh?', skip: 'not for you. why?' };
const LABEL: Record<UpgradeChoice, string> = { in: 'Swap in', ask: 'Rethink', skip: 'Not for me' };
const LIT: Record<UpgradeChoice, string> = { in: 'bg-[#16301f] text-[#7fd6a0]', ask: 'bg-[#241d2e] text-[#c4a6f5]', skip: 'bg-[#3a211b] text-[#f0714f]' };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const money = (n: number) => `$${n.toFixed(2)}`;

export default function DeckUpgrades({ listId, version, onChanged, onTab, onCard, showFree, onFree }: Props) {
  const updating = useUpdating();
  const [view, setView] = useState<UpgradesView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<UpgradesView['choices']>({});
  const [message, setMessage] = useState('');
  const [review, setReview] = useState(false);
  const [copied, setCopied] = useState(false);
  const dirty = useRef(false);
  const runId = useRef<string | null>(null);
  const [lv, setLv] = useListView(`mtg-upgrades-list:${listId}`);

  const take = useCallback((v: UpgradesView) => {
    setView(v);
    setError(null);
    const fresh = runId.current !== (v.run?.id ?? null);
    if (fresh || !dirty.current) setChoices(v.choices);
    if (fresh) { setMessage(''); setReview(false); if (runId.current !== null && v.run && v.run.round > 1) setLv({ filter: 'changed' }); }
    runId.current = v.run?.id ?? null;
  }, [setLv]);

  useEffect(() => {
    let stop = false;
    api.upgrades(listId).then((v) => { if (!stop) take(v); }).catch((e) => { if (!stop) setError(e instanceof Error ? e.message : 'Couldn’t read the deck just now'); });
    return () => { stop = true; };
  }, [listId, version, take]);

  const running = view?.job?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => { void api.upgrades(listId).then(take).catch(() => {}); }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, listId, take]);

  useEffect(() => {
    if (!dirty.current) return;
    const timer = setTimeout(() => {
      dirty.current = false;
      void api.upgradesAct(listId, { action: 'choices', choices }).catch(() => { dirty.current = true; });
    }, SAVE_MS);
    return () => clearTimeout(timer);
  }, [choices, listId]);

  const act = async (action: api.UpgradesAction, after?: () => Promise<void> | void) => {
    setBusy(true);
    setError(null);
    try {
      if (dirty.current) { dirty.current = false; await api.upgradesAct(listId, { action: 'choices', choices }); }
      take(await api.upgradesAct(listId, action));
      await after?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not do that');
    } finally {
      setBusy(false);
    }
  };

  const items = useMemo(() => view?.run?.items ?? [], [view]);
  const ins = useMemo(() => chosenIn(items, choices), [items, choices]);
  const stateOf = (name: string): UpgradeChoice => choices[name]?.choice ?? 'in';
  const whereOf = (name: string): UpgradeWhere => choices[name]?.where ?? 'swap';
  const passes = (i: UpgradeItem) => {
    const c = stateOf(i.name);
    return lv.filter === 'all' ? true : lv.filter === 'changed' ? i.mark === 'new' || i.mark === 'back' : lv.filter === 'buy' ? isBuy(i.own) : c === lv.filter;
  };
  const shown = useShown(items, (i) => i.name, passes, `${lv.filter}:${lv.press ?? 0}:${view?.run?.id ?? ''}:${items.length}`);
  useFilterFallback(view?.run?.id ?? '', lv.filter !== 'all' && !items.some(passes), () => setLv({ filter: 'all' }));
  const open = (cardId: string, name: string) => { if (onCard) void api.finishCard(listId, cardId, name).then(onCard).catch(() => {}); };
  if (error && !view) return <p className="mt-4 text-sm text-red-400">{error}</p>;
  if (!view) return <p className="mt-4 text-sm text-[var(--muted)]">Reading the deck…</p>;

  const run = view.run;
  const choose = (item: UpgradeItem, change: Partial<{ choice: UpgradeChoice; text: string; where: UpgradeWhere }>) => {
    dirty.current = true;
    setChoices((c) => {
      const was = c[item.name] ?? { choice: 'in' as UpgradeChoice, text: '' };
      const next = { ...c, [item.name]: { ...was, ...change } };
      const x = next[item.name];
      if (x.where === 'swap') delete x.where;
      if (x.choice === 'in' && !x.text.trim() && !x.where) delete next[item.name];
      return next;
    });
  };
  const nameOf = (name: string, id: string, image: string | null | undefined, cls = 'font-bold') => (
    <CardName name={name} card={{ id, name, image_uris: image ? { normal: image } : undefined } as unknown as ScryfallCard} onOpen={() => open(id, name)} className={cls} />
  );
  const cost = price(run ? roundPrice(view.cost.later, Math.max(1, run.want - ins.length)) : roundPrice(view.cost.first, view.count));
  const freeLink = onFree && (
    <button type="button" className={LINK} aria-pressed={!!showFree} onClick={() => onFree(!showFree)} data-upgrades-free>{showFree ? 'Hide the free list' : 'Free list from the deck’s numbers'}</button>
  );

  const copy = (rows: Array<{ name: string; price: number | null }>) => {
    void navigator.clipboard?.writeText(buyListText(rows)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  };

  // --- done ------------------------------------------------------------------------------
  if (view.done) {
    const d = view.done;
    const t = buyTotal(d.buy);
    return (
      <section className={`${CARD} flex flex-col gap-3`} data-upgrades-done>
        <h3 className="font-display text-2xl font-semibold">{d.swapped ? `Swapped in ${plural(d.swapped, 'card')}.` : ''}{d.maybe ? ` ${plural(d.maybe, 'card')} put in the Maybeboard.` : ''} The deck is at {d.size}.</h3>
        <p className="text-sm text-[var(--muted)]">{d.swapped ? `The cards they replaced are in ${d.cutsTo}, so you can bring one back. ` : ''}A snapshot from before is in History.</p>
        {(d.skipped?.length ?? 0) > 0 && <p className="text-sm text-amber-300" data-upgrades-skipped>Not applied, because the deck changed since the list: {d.skipped!.map((x) => `${x.name} (${x.why})`).join('; ')}.</p>}
        {d.buy.length > 0 && <BuyList rows={d.buy} copied={copied} onCopy={() => copy(d.buy)} />}
        {d.buy.length > 0 && <p className="text-[13px] text-[var(--muted)]">{plural(d.buy.length, 'card')} to buy went into the deck: {money(t.total)}{t.unpriced ? `, and ${t.unpriced} with no price` : ''}. The Cards tab marks the ones you don’t have.</p>}
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        <div className="flex flex-wrap gap-2">
          {d.size > 100 ? <button className={C.go} onClick={() => onTab('tune')}>Next: Trim {d.size - 100}</button> : <button className={C.go} onClick={() => onTab('check')}>Check mana and curve</button>}
          <button className={C.btn} disabled={busy} onClick={() => act({ action: 'undo' }, onChanged)} data-upgrades-undo>Undo</button>
          <button className={C.btn} disabled={busy} onClick={() => act({ action: 'reset' })}>Look again</button>
        </div>
      </section>
    );
  }

  // --- setup -----------------------------------------------------------------------------
  const setup = !run && !running && (
    <div className={`${CARD} flex flex-col gap-4`} data-upgrades-setup>
      <div className="flex flex-col gap-2">
        <h4 className={H3}>How many suggestions</h4>
        <div role="radiogroup" aria-label="How many suggestions" className="flex flex-wrap gap-2">
          {UPGRADE_COUNTS.map((n) => <button key={n} type="button" role="radio" aria-checked={view.count === n} disabled={busy} className={`${C.pill} min-h-10 ${view.count === n ? C.on : C.off}`} onClick={() => act({ action: 'settings', count: n })} data-upgrades-count={n}>{n}</button>)}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <h4 className={H3}>Where from</h4>
        <div role="radiogroup" aria-label="Where from" className="flex flex-wrap gap-2">
          {UPGRADE_SOURCES.map((o) => {
            const off = view.ownOnly && o.id !== 'mine';
            return <button key={o.id} type="button" role="radio" aria-checked={view.sources === o.id} disabled={busy || off} className={`${C.pill} min-h-10 disabled:opacity-40 ${view.sources === o.id ? C.on : C.off}`} onClick={() => act({ action: 'settings', sources: o.id })} data-upgrades-sources={o.id}>{o.label}</button>;
          })}
        </div>
        <p className="text-[13px] text-[var(--muted)]" data-upgrades-sources-note>
          {view.ownOnly ? <>Your plan says only cards you own, so cards to buy are off. <button type="button" className="underline underline-offset-[3px] hover:text-[var(--foreground)]" onClick={() => onTab('plan')}>Change it on the Plan tab</button></>
            : view.sources === 'mine' ? 'Claude searches your cards that can go in this deck.'
              : view.sources === 'buy' ? 'Claude names well-known cards you don’t have. The app checks every name and prices it.'
                : 'Claude searches your cards and names well-known cards you don’t have. The app checks every name, says where each copy is and prices the ones to buy.'}
          {view.plan.budget !== null && !view.ownOnly ? ` Cards to buy stay within your $${view.plan.budget} a card.` : ''}
        </p>
      </div>
      <p className="text-sm text-[var(--muted)]"><b className="text-[#e8c558]">Your plan:</b> {view.plan.text ? <SymbolText text={view.plan.text} /> : 'not written yet. Claude goes by the commander and the deck.'}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button className={C.go} disabled={busy || view.noKey || updating || view.size !== 100} title={updating ? UPDATING_TITLE : undefined} onClick={() => act({ action: 'find' })} data-upgrades-go>
          ✦ Find {view.count} upgrades · Claude Opus · {cost}
        </button>
        {freeLink}
        <Tip label="What Claude reads"><span className="flex flex-col gap-1">{AI_READS.upgrades.map((r) => <span key={r}>• {r}</span>)}<span>At most {UPGRADE_SEARCHES} searches on the first list and {UPGRADE_SEARCHES_LATER} on each later one, counted by the app.</span></span></Tip>
      </div>
      {view.noKey && <p className="text-xs text-amber-300">No Claude key is set on the server. The free list works without one.</p>}
      {view.size !== 100 && <p className="text-[13px] text-amber-300" data-upgrades-not100>Upgrades swaps cards in a deck at 100, and this one has {view.size}. {view.size < 100 ? <button type="button" className="underline underline-offset-[3px]" onClick={() => onTab('finish')}>Finish the deck first</button> : <button type="button" className="underline underline-offset-[3px]" onClick={() => onTab('tune')}>Trim it to 100 first</button>}.</p>}
    </div>
  );

  const offerLine = view.offer && (view.offer.searched
    ? <p className="text-[13px] text-[var(--muted)]" data-upgrades-offer>Searching the {view.offer.n.toLocaleString()} cards you own that can go in this deck ({view.offer.colours}, Commander-legal).</p>
    : <p className="text-[13px] text-[var(--muted)]" data-upgrades-offer>Naming cards to buy ({view.offer.colours}, Commander-legal): no search over your cards this time.</p>);
  const notForMe = view.notForMe.length > 0 && (
    <details className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]" data-upgrades-notforme>
      <summary className="cursor-pointer px-4 py-2.5 text-[13px] text-[var(--muted)]">Not for me before on this deck · {plural(view.notForMe.length, 'card')} Claude won’t suggest again</summary>
      <ul className="flex flex-col gap-1 border-t border-[var(--border)] px-4 py-3 text-[13px]">
        {view.notForMe.map((x) => (
          <li key={x.name} className="flex flex-wrap items-baseline gap-x-2">
            <b>{x.name}</b>{x.why && <span className="text-[#e2b93b]">“{x.why}”</span>}
            <button type="button" disabled={busy || running} onClick={() => act({ action: 'unskip', name: x.name })} className={LINK}>Offer it again</button>
          </li>
        ))}
        <li className="text-xs text-[var(--faint)]">Kept apart from Finish’s skipped list. Your reasons go with every request on this deck.</li>
      </ul>
    </details>
  );
  const searchList = view.searches.length > 0 && (
    <ol className="flex max-h-64 flex-col overflow-auto font-mono text-[13px] leading-relaxed text-[var(--muted)]" aria-live="polite">
      {view.searches.map((x, k) => <li key={k} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3"><span className="break-words text-[var(--foreground)]">{x.q}</span><span className={x.n ? '' : 'text-amber-300'}>{x.n ? `${x.n} of your cards` : 'nothing'}</span></li>)}
    </ol>
  );
  const searches = running ? (
    <div role="status" className={`${CARD} flex flex-col gap-2 border-[#c3a6e6]/60`} data-upgrades-running>
      <h4 className={H3}>{view.job?.detail || 'Claude is reading the deck'}</h4>
      {offerLine}
      {searchList || <p className="text-sm text-[var(--muted)]">Reading the plan and the deck…</p>}
      <span className="text-xs text-[var(--faint)]">It runs in the background: you can switch tabs, and the list will be here when you come back.</span>
    </div>
  ) : run && view.searches.length > 0 ? (
    <details className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]" data-upgrades-searches>
      <summary className="cursor-pointer px-4 py-2.5 text-[13px] text-[var(--muted)]">Claude’s searches in round {run.round} · {plural(view.searches.length, 'search', 'searches')} over your cards</summary>
      <div className="flex flex-col gap-2 border-t border-[var(--border)] px-4 py-3">{offerLine}{searchList}</div>
    </details>
  ) : null;

  if (!run) {
    return (
      <section className="flex flex-col gap-4" data-upgrades>
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        {view.job?.status === 'failed' && <p role="alert" className="text-sm text-red-400">Claude didn’t finish: {view.job.error}</p>}
        {setup}
        {searches}
        {!running && notForMe}
      </section>
    );
  }

  // --- the list ----------------------------------------------------------------------------
  const chosen = items.filter((i) => ins.includes(i.name));
  const swaps = chosen.filter((i) => whereOf(i.name) === 'swap');
  const maybes = chosen.filter((i) => whereOf(i.name) === 'maybe');
  const mine = swaps.filter((i) => !isBuy(i.own));
  const buys = swaps.filter((i) => isBuy(i.own));
  const buyRows = buys.map((i) => ({ name: i.name, price: isBuy(i.own) ? i.own.price : null }));
  const bt = buyTotal(buyRows);
  const adds = swaps.filter((i) => !i.out).length;
  const after = view.size + adds;
  const asks = items.filter((i) => stateOf(i.name) === 'ask');
  const skips = items.filter((i) => stateOf(i.name) === 'skip');
  const canSend = asks.length > 0 || skips.length > 0 || !!message.trim();
  const barLine = `${plural(swaps.length, 'swap')} · ${mine.length} from your cards · ${buys.length} to buy${buys.length ? `, ${money(bt.total)}${bt.unpriced ? ` + ${bt.unpriced} with no price` : ''}` : ''}${maybes.length ? ` · ${maybes.length} to the Maybeboard` : ''}`;

  if (review) {
    return (
      <section className="flex flex-col gap-4" data-upgrades-review>
        <div className="sticky top-[calc(env(safe-area-inset-top)+4rem)] z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-[#ef6a4c] bg-[var(--surface)] p-3 shadow-lg sm:p-3.5" data-upgrades-apply-bar>
          <span className="min-w-0 flex-[1_1_16rem] text-[13px] text-[var(--muted)]"><b className="tabular-nums text-[var(--foreground)]">{view.size} → {after}</b> · A snapshot is saved first. Undo puts every card back where it was.</span>
          <button className={C.btn} onClick={() => setReview(false)}>Back to the list</button>
          <button className={C.go} disabled={busy || !chosen.length} onClick={() => act({ action: 'apply' }, onChanged)} data-upgrades-apply>Apply · {plural(swaps.length + maybes.length, 'change')}</button>
        </div>
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        <div className={`${CARD} flex flex-col gap-3`}>
          <h3 className="font-display text-xl font-semibold">Review and apply</h3>
          <p className="text-sm text-[var(--muted)]">Nothing has changed in the deck yet. Each card goes into the main deck and the card it replaces goes to the cuts section.</p>
          {swaps.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm" data-upgrades-review-swaps>
              {swaps.map((i) => (
                <li key={i.name} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-emerald-300">+</span>{nameOf(i.name, i.card.id, i.card.image)}
                  {i.out ? <><span className="text-[var(--muted)]">for</span><span className="text-[#ffb4a8]">−</span>{nameOf(i.out.name, i.out.id, i.out.image, '')}</> : <span className="text-xs text-amber-300">added; you choose what comes out</span>}
                  <span className="text-xs text-[var(--muted)]">{ownLabel(i.own)}</span>
                </li>
              ))}
            </ul>
          )}
          {maybes.length > 0 && <p className="text-sm"><b>To the Maybeboard, nothing comes out:</b> {maybes.map((i) => i.name).join('; ')}</p>}
          {adds > 0 && <p className="text-sm text-amber-300">{plural(adds, 'card has', 'cards have')} no card to replace, so the deck goes to {after}: Trim it back after.</p>}
          {asks.length > 0 && <p className="text-sm text-amber-300">{plural(asks.length, 'card is', 'cards are')} still on Rethink and will be left out: {asks.map((i) => i.name).join('; ')}.</p>}
          {buyRows.length > 0 && <BuyList rows={buyRows} copied={copied} onCopy={() => copy(buyRows)} />}
        </div>
      </section>
    );
  }

  const sub = [
    after === view.size ? `Round ${run.round}. The deck stays at ${after}.` : `Round ${run.round}. The deck goes from ${view.size} to ${after}: ${plural(after - view.size, 'card has', 'cards have')} no card to replace (Trim after, or choose one to take out yourself).`,
    asks.length ? `${asks.length} to rethink.` : '',
    skips.length ? `${skips.length} not for you.` : '',
  ].filter(Boolean).join(' ');
  const groups: Array<{ key: string; title: string; rows: UpgradeItem[] }> = [
    { key: 'mine', title: 'From your cards', rows: items.filter((i) => !isBuy(i.own)) },
    { key: 'buy', title: 'To buy', rows: items.filter((i) => isBuy(i.own)) },
  ];

  return (
    <section className="flex flex-col gap-4" data-upgrades>
      <div className="sticky top-[calc(env(safe-area-inset-top)+4rem)] z-10 flex flex-col gap-1.5 rounded-2xl border border-[#ef6a4c] bg-[var(--surface)] p-3 shadow-lg sm:p-3.5" data-upgrades-bar>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <b className="min-h-[2.5em] font-display text-lg leading-[1.25] tabular-nums sm:min-h-0" data-upgrades-count-line>{barLine}</b>
          <span className="ml-auto flex flex-wrap gap-2">
            <button className={C.btn} disabled={busy || running} onClick={() => act({ action: 'reset' })}>Start over</button>
            <button className={C.go} disabled={busy || running || !chosen.length} onClick={() => { setReview(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Review and apply</button>
          </span>
        </div>
        <span className="line-clamp-2 min-h-[2.6em] text-[13px] leading-[1.3] text-[var(--muted)]" title={sub} data-upgrades-sub>{sub}</span>
      </div>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {view.job?.status === 'failed' && <p role="alert" className="text-sm text-red-400">Claude didn’t finish: {view.job.error}</p>}
      {searches}

      <div className={`${CARD} flex flex-col gap-2`} data-upgrades-say>
        {run.read && <p className="text-[13px] text-[var(--muted)]" data-upgrades-read><span className={`font-semibold ${C.ai}`}>✦ Claude{run.round > 1 ? `, list ${run.round}` : ''}:</span> <SymbolText text={run.read} /></p>}
        {run.dropped.length > 0 && (
          <p className="text-[13px] text-amber-300" data-upgrades-dropped title={run.dropped.map((d) => `${d.name}: ${d.why}`).join('\n')}>
            {plural(run.dropped.length, 'name')} {run.dropped.length === 1 ? 'wasn’t' : 'weren’t'} usable and {run.dropped.length === 1 ? 'was' : 'were'} left out: {run.dropped.slice(0, 4).map((d) => `${d.name} (${d.why})`).join('; ')}{run.dropped.length > 4 ? '…' : ''}.
          </p>
        )}
        {items.length < run.want && <p className="text-[13px] text-[var(--muted)]">{plural(run.want - items.length, 'suggestion')} short of the {run.want} asked for: nothing is padded.</p>}
        <label htmlFor="upgrades-say" className="flex flex-wrap items-baseline gap-x-2 font-bold">Say what to change <span className="text-[13px] font-normal text-[var(--muted)]">optional{run.round > 1 ? ' · the earlier rounds are part of the conversation' : ''}</span></label>
        <textarea id="upgrades-say" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1500}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSend && !busy && !running && !updating) { e.preventDefault(); void act({ action: 'find', rerun: true, message }); } }}
          placeholder="For example: cheaper cards, nothing over $10. More ways to end the game. Or mark cards Rethink or Not for me below and say why on their line."
          className={`${C.input} w-full resize-y py-2.5`} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="min-w-0 flex-[1_1_14rem] text-[13px] text-[var(--muted)]">Swap in takes the card for the one it replaces. Not for me leaves it out on this deck for good. Rethink asks Claude again with your reason.</p>
          <button className={C.aiBtn} disabled={busy || running || !canSend || view.noKey || updating} onClick={() => act({ action: 'find', rerun: true, message })} title={updating ? UPDATING_TITLE : canSend ? undefined : 'Mark a card Rethink or Not for me, or type something, first'} data-upgrades-send>✦ Send · {cost}</button>
        </div>
      </div>

      {run.changes && <Changes changes={run.changes} />}

      <div className={`${CARD} flex flex-col gap-1`} data-upgrades-list>
        <ListControls filter={lv.filter} onFilter={(f) => setLv({ filter: f })} sort={lv.sort === 'choice' ? 'claude' : lv.sort} onSort={(x) => setLv({ sort: x })} sorts={SORTS} filters={[
          { id: 'all', label: 'All', count: items.length },
          { id: 'in', label: 'Swap in', count: items.filter((i) => stateOf(i.name) === 'in').length },
          { id: 'ask', label: 'Rethink', count: asks.length },
          { id: 'skip', label: 'Not for me', count: skips.length },
          ...(items.some((i) => isBuy(i.own)) ? [{ id: 'buy', label: 'To buy', count: items.filter((i) => isBuy(i.own)).length }] : []),
          ...(run.round > 1 ? [{ id: 'changed', label: 'Changed this round', count: items.filter((i) => i.mark === 'new' || i.mark === 'back').length }] : []),
        ]} />
        {groups.map((g) => {
          if (!g.rows.length) return null;
          const rows = sortRows(g.rows.filter((i) => shown.has(i.name)), lv.sort, { choice: (i) => ['in', 'ask', 'skip'].indexOf(stateOf(i.name)), mv: (i) => i.card.cmc, name: (i) => i.name, price: (i) => (isBuy(i.own) ? i.own.price : null) });
          const folded = lv.folded.includes(g.key);
          if (!rows.length && lv.filter !== 'all') return null;
          return (
            <div key={g.key} className="flex flex-col" data-upgrades-group={g.key}>
              <GroupHead title={g.title} count={g.rows.length} extra={lv.filter !== 'all' ? `${rows.length} shown` : ''} folded={folded} onToggle={() => setLv({ folded: folded ? lv.folded.filter((x) => x !== g.key) : [...lv.folded, g.key] })} />
              {!folded && rows.map((i) => (
                <Row key={i.name} item={i} state={stateOf(i.name)} where={whereOf(i.name)} text={choices[i.name]?.text ?? ''}
                  name={nameOf(i.name, i.card.id, i.card.image)} outName={i.out ? nameOf(i.out.name, i.out.id, i.out.image, '') : null}
                  onSet={(c) => choose(i, { choice: c })} onText={(t) => choose(i, { text: t })} onWhere={(w) => choose(i, { where: w })} />
              ))}
            </div>
          );
        })}
        {lv.filter !== 'all' && items.every((i) => !shown.has(i.name)) && <p className="py-3 text-sm text-[var(--muted)]">Nothing here. <button type="button" className={LINK} onClick={() => setLv({ filter: 'all' })}>Show all</button></p>}
      </div>
      {notForMe}
      {freeLink && (showFree ? <p className="text-[13px] text-[var(--muted)]">The free list, worked out by the app with no Claude, is below. {freeLink}</p>
        : <p className="text-[13px] text-[var(--muted)]">Or browse the {freeLink}: no Claude, worked out by the app.</p>)}
    </section>
  );
}

export function BuyList({ rows, copied, onCopy }: { rows: Array<{ name: string; price: number | null }>; copied: boolean; onCopy: () => void }) {
  const t = buyTotal(rows);
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--background)] p-3" data-upgrades-buylist>
      <div className="flex flex-wrap items-center gap-2">
        <h4 className={H3}>To buy · {rows.length}</h4>
        <span className="text-sm font-semibold tabular-nums">{money(t.total)}{t.unpriced ? <span className="font-normal text-[var(--muted)]"> + {t.unpriced} with no price</span> : null}</span>
        <button type="button" className={`${C.btn} ml-auto min-h-9 px-3`} onClick={onCopy} data-upgrades-copy>{copied ? 'Copied' : 'Copy as a buy list'}</button>
      </div>
      <ul className="grid gap-x-4 text-[13px] sm:grid-cols-2">
        {rows.map((r) => <li key={r.name} className="flex justify-between gap-2"><span className="min-w-0 truncate">{r.name}</span><span className="tabular-nums text-[var(--muted)]">{r.price === null ? 'no price' : money(r.price)}</span></li>)}
      </ul>
    </div>
  );
}

const BECAUSE: Record<'skipped' | 'rethink' | 'message' | 'gone', string> = { skipped: 'not for you', rethink: 'you asked for a rethink', message: 'your message', gone: 'no longer fits' };

function Changes({ changes }: { changes: NonNullable<NonNullable<UpgradesView['run']>['changes']> }) {
  if (!changes.out.length && !changes.in.length && !changes.back.length) return <p className={`${CARD} text-[13px] text-[var(--muted)]`} data-upgrades-changes>Nothing changed in round {changes.round}: the list is the one you sent.</p>;
  return (
    <div className={`${CARD} flex flex-col gap-1.5 text-[13px]`} data-upgrades-changes>
      <h4 className={H3}>What changed in round {changes.round}</h4>
      {changes.out.length > 0 && <p><b className="text-[#f0714f]">Out · {changes.out.length}:</b> <span className="text-[var(--muted)]">{changes.out.map((x) => `${x.name} (${BECAUSE[x.because]})`).join('; ')}</span></p>}
      {changes.in.length > 0 && <p><b className="text-[#c4a6f5]">In · {changes.in.length}:</b> <span className="text-[var(--muted)]">{changes.in.join('; ')}</span></p>}
      {changes.back.length > 0 && <p><b className="text-[#e8c558]">Came back after a rethink, with a new reason · {changes.back.length}:</b> <span className="text-[var(--muted)]">{changes.back.join('; ')}</span></p>}
    </div>
  );
}

/**
 * One suggestion, four columns on every row so nothing moves when its state changes: Swap in | Rethink | Not for
 * me; the card, its cost, where the copy is and what it replaces (with the row's menu: into the deck, or the
 * Maybeboard instead); Claude's reason with what the swap does to the job counts; the owner's reason line.
 */
function Row({ item, state, where, text, name, outName, onSet, onText, onWhere }: {
  item: UpgradeItem; state: UpgradeChoice; where: UpgradeWhere; text: string; name: React.ReactNode; outName: React.ReactNode | null;
  onSet: (c: UpgradeChoice) => void; onText: (t: string) => void; onWhere: (w: UpgradeWhere) => void;
}) {
  const buy = isBuy(item.own);
  const chip = <span className={`max-w-full truncate rounded-full border px-2 text-[11px] ${buy ? 'border-[#8cc0ee]/50 text-[#8cc0ee]' : item.own.kind === 'deck' ? 'border-amber-300/50 text-amber-300' : 'border-emerald-400/40 text-emerald-300'}`} data-own={item.own.kind}>{ownLabel(item.own)}</span>;
  const mark = item.mark === 'new' ? <span className="rounded-full border border-[#c4a6f5]/50 px-2 text-[11px] text-[#c4a6f5]">new this round</span>
    : item.mark === 'back' ? <span className="rounded-full border border-[#e8c558]/50 px-2 text-[11px] text-[#e8c558]">came back, new reason</span> : null;
  const off = state === 'skip' ? 'line-through opacity-50' : '';
  return (
    <div className="@container scroll-mt-48 border-t border-[var(--border)] py-2.5" data-upgrades-row={item.name} data-state={state}>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-1.5 @[44rem]:grid-cols-[auto_minmax(0,1fr)_minmax(0,15rem)] @[66rem]:grid-cols-[auto_19rem_minmax(0,1fr)_15rem]">
        <span role="group" aria-label={item.name} className="inline-flex overflow-hidden rounded-[10px] border border-[var(--border)]" data-col="choice">
          {(['in', 'ask', 'skip'] as const).map((v) => (
            <button key={v} type="button" aria-pressed={state === v} onClick={() => onSet(v)} aria-label={`${LABEL[v]} ${item.name}`}
              title={v === 'ask' ? 'Give your reason and Claude weighs it on the next round.' : v === 'skip' ? 'Left out, and never suggested again on this deck.' : undefined}
              className={`min-h-10 whitespace-nowrap px-2.5 text-[13px] font-bold ${state === v ? LIT[v] : 'text-[var(--faint)] hover:text-[var(--foreground)]'}`}>{LABEL[v]}</button>
          ))}
        </span>
        <span className="order-first col-span-2 flex min-w-0 flex-col gap-1 @[44rem]:order-none @[44rem]:col-span-2 @[66rem]:col-span-1" data-col="name">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`min-w-0 break-words ${off}`}>{name}</span>
            {item.card.manaCost && <ManaCost cost={item.card.manaCost} size={13} />}
            {chip}{mark}
          </span>
          <span className={`flex min-w-0 flex-wrap items-center gap-x-1.5 text-[13px] text-[var(--muted)] ${off}`} data-col="replaces">
            {outName ? <span className="min-w-0">replaces {outName}{item.out?.why ? <span className="text-[var(--faint)]">: {item.out.why}</span> : null}</span>
              : <span className="text-amber-300" title={item.outNote}>you choose what comes out{item.outNote ? ` · ${item.outNote}` : ''}</span>}
            {/* The row's menu: the second choice, same shape on every row, never a box that opens. */}
            <select value={where} onChange={(e) => onWhere(e.target.value as UpgradeWhere)} aria-label={`Where ${item.name} goes`} disabled={state !== 'in'}
              className="ml-auto h-7 w-[10.5rem] shrink-0 rounded-md border border-[var(--border)] bg-[var(--background)] px-1 text-[12px] text-[var(--foreground)] disabled:opacity-40" data-upgrades-where>
              <option value="swap">{item.out ? 'Into the deck' : 'Into the deck (adds one)'}</option>
              <option value="maybe">Maybeboard instead</option>
            </select>
          </span>
        </span>
        <span className={`col-span-2 flex min-w-0 flex-col gap-0.5 text-[13px] @[44rem]:col-span-2 @[66rem]:col-span-1 ${off}`} data-col="why">
          <span className={item.mark === 'back' ? 'rounded bg-[#e8c558]/[0.08] text-[var(--foreground)] ring-1 ring-[#e8c558]/30' : 'text-[var(--muted)]'}><span className="font-semibold text-[#c3a6e6]">✦</span> <b className="font-semibold text-[var(--foreground)]">{item.job}.</b> <SymbolText text={item.why} /></span>
          {item.wasBuy && <span className="text-[12px] text-emerald-300">Claude called it one to buy; you have it.</span>}
          {item.warn.map((w) => <span key={w} className="text-[12px] text-amber-300">{w}</span>)}
        </span>
        <span className="relative col-span-2 min-w-0 @[44rem]:col-span-1">
          <input value={text} onChange={(e) => onText(e.target.value)} maxLength={300} data-col="reason" title={text.trim() || undefined}
            onBlur={(e) => { e.currentTarget.scrollLeft = 0; }} placeholder={HINT[state]} aria-label={`Your reason for ${item.name}`}
            className={`min-h-9 w-full min-w-0 truncate border-0 border-b border-[var(--border)] bg-transparent px-0.5 text-[13px] text-[#e2b93b] outline-none focus:border-[#e2b93b] ${state === 'in' ? 'placeholder:text-[var(--faint)]' : 'placeholder:text-[#e2b93b]'}`} />
        </span>
      </div>
    </div>
  );
}
