'use client';

/**
 * A deck's Collection tab: which of its cards are physically in it, which
 * sit in a box ready to pull, which another deck is holding, and which are
 * still to buy - with the lists to go and fetch them.
 *
 * Pulling takes a copy out of its box and into the deck; returning puts it
 * back. A card can be marked as a proxy, filling its slot without a real
 * copy, or hold a proxy copy from a box. Basic lands are not tracked, so one
 * not found is not to buy. Sideboard and maybeboard cards show only for the
 * copies the deck keeps with it. Cutting a card from the deck returns its
 * copies by itself.
 */

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import Tip from '@/components/Tip';
import * as api from '@/lib/api';
import type { Holding, Status } from '@/lib/collection';
import { isProxy, variantBadges } from '@/lib/copy-variant';
import { steady } from '@/lib/steady-tap';

interface Props {
  listId: string;
  /** Changes when the deck does, to reload. */
  version: string;
  /** The deck's ownership, when the page already reads it (useDeckCopies): shown, and changed through onData, instead of read here. */
  data?: api.DeckOwnership | null;
  onData?: (data: api.DeckOwnership) => void;
  /** Show only these cards in the deck's card view: a filter word, is:inbox. */
  onFilter?: (words: string) => void;
}

const GROUPS: Array<{ status: Status; title: string; hint: string }> = [
  { status: 'in-box', title: 'In your boxes', hint: 'Owned and free: pull them into the deck.' },
  { status: 'in-other-deck', title: 'In other decks', hint: 'Every copy you own is in another deck.' },
  { status: 'missing', title: 'To buy', hint: 'Not in your collection.' },
  { status: 'basic', title: 'Basic lands', hint: 'Not tracked in your collection: take them from your land pile.' },
  { status: 'proxy', title: 'Proxies', hint: 'Filling a slot without a real copy.' },
  { status: 'in-deck', title: 'In the deck', hint: 'Pulled from your collection.' },
];

/** "JA", "LP": what sets a copy apart, after its printing. A proxy has its own badge by the name. */
const marks = (variant: string) => variantBadges(variant).filter((b) => b.text !== 'Proxy').map((b) => b.text).join(' ');
const copyLabel = (c: { set: string; number: string; finish: string; variant: string }) =>
  `${c.set.toUpperCase()} #${c.number}${c.finish !== 'nonfoil' ? ` · ${c.finish}` : ''}${marks(c.variant) ? ` · ${marks(c.variant)}` : ''}`;

const money = (n: number) => `$${n.toFixed(2)}`;
const box = (name: string) => name || 'Unsorted';
// Row actions stay quiet - a bordered button on each of 100 rows was the loudest thing on the tab.
const small = 'min-h-8 rounded-full px-2.5 text-xs text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)] disabled:opacity-50';
const primary = 'min-h-9 rounded-lg bg-[var(--accent)] px-3 text-xs font-medium text-[#221c08] hover:brightness-110 disabled:opacity-50';

export default function DeckCollection({ listId, version, data: shared, onData, onFilter }: Props) {
  const [own, setOwn] = useState<api.DeckOwnership | null>(null);
  const controlled = onData !== undefined;
  const data = controlled ? shared ?? null : own;
  const setData = onData ?? setOwn;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(() => api.deckOwnership(listId).then(setOwn).catch((e) => setError(e instanceof Error ? e.message : 'Could not load')), [listId]);
  useEffect(() => { if (!controlled) load(); }, [load, version, controlled]);

  const act = async (a: api.DeckCollectionAction) => {
    setBusy(true);
    setError(null);
    try {
      setData(await api.deckCollection(listId, a));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not do that');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError('Could not copy - select the text below instead');
    }
  };

  if (error && !data) return <p className="mt-8 text-center text-red-400">{error}</p>;
  if (!data) return <p className="mt-8 text-center text-[var(--muted)]">Checking your collection…</p>;
  const { summary } = data;
  const main = data.cards.filter((h) => h.board === 'main');
  const extras = data.cards.filter((h) => h.board !== 'main');

  return (
    <div data-tour="deck-collection" className="mt-5 flex flex-col gap-6">
      <section data-tour="collection-summary" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
        <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          Collection status
          <Tip label="What these numbers mean">
            <p><b>In this deck</b>: copies taken out of a box and kept with the deck.</p>
            <p className="mt-1.5"><b>Proxies</b>: stand-ins - marked on the deck, or proxy copies from a box.</p>
            <p className="mt-1.5"><b>In your boxes</b>: owned and free to pull. <b>In other decks</b>: every copy you own is in another deck.</p>
            <p className="mt-1.5"><b>To buy</b>: not in your collection. Basic lands are not tracked, so they are never to buy.</p>
          </Tip>
        </p>
        <p data-testid="collection-status" className="mt-1 text-base font-medium">{summary.inDeck} of {summary.need} cards owned and in this deck{summary.proxies ? `, plus ${summary.proxies} prox${summary.proxies === 1 ? 'y' : 'ies'}` : ''}</p>
        <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[var(--muted)] sm:grid-cols-4">
          <li><span className="text-[var(--foreground)]">{summary.inBoxes}</span> in your boxes</li>
          <li><span className="text-[var(--foreground)]">{summary.inOtherDecks}</span> in other decks</li>
          <li><span className="text-[var(--foreground)]">{summary.missing}</span> to buy</li>
          <li><span className="text-[var(--foreground)]">{money(summary.missingCost)}</span> to finish</li>
          {summary.basics > 0 && <li><span className="text-[var(--foreground)]">{summary.basics}</span> basic land{summary.basics === 1 ? '' : 's'} to add</li>}
        </ul>
        {onFilter && (
          <div data-testid="copy-filters" className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="flex items-center gap-1 text-[var(--muted)]">
              Show in the cards
              <Tip label="About these filters">Each one filters the cards above with a word you can type yourself: is:held, is:proxy, is:inbox, is:otherdeck, is:tobuy.</Tip>
            </span>
            {([['is:held', 'Yours', summary.inDeck], ['is:proxy', 'Proxies', summary.proxies], ['is:inbox', 'In your boxes', summary.inBoxes],
              ['is:otherdeck', 'In other decks', summary.inOtherDecks], ['is:tobuy', 'To buy', summary.missing]] as const).map(([word, label, n]) => (
              <button key={word} data-filter={word} {...steady(() => onFilter(word))} disabled={!n}
                className="min-h-8 rounded-full border border-[var(--border)] px-2.5 hover:bg-[var(--surface-hover)] disabled:opacity-40">
                {label} <span className="tabular-nums text-[var(--muted)]">{n}</span>
              </button>
            ))}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {summary.inBoxes > 0 && (
            <button disabled={busy} {...steady(() => act({ action: 'pullAll' }))} className={primary}>Pull all {summary.inBoxes} from your boxes</button>
          )}
          {summary.inDeck > 0 && (
            <button disabled={busy} {...steady(() => act({ action: 'return' }))} className={small}>Return every card to its box</button>
          )}
          {data.fetch && <button onClick={() => copy('fetch', data.fetch)} className={small}>{copied === 'fetch' ? 'Copied ✓' : 'Copy what to fetch'}</button>}
          {data.buy && <button onClick={() => copy('buy', data.buy)} className={small}>{copied === 'buy' ? 'Copied ✓' : 'Copy the buy list'}</button>}
        </div>
        {error && <p className="mt-2 text-red-400">{error}</p>}
      </section>

      {GROUPS.map((g) => {
        const cards = main.filter((h) => h.status === g.status);
        if (!cards.length) return null;
        return (
          <section key={g.status}>
            <h3 data-section={g.title} className="font-medium">{g.title} <span className="font-normal text-[var(--muted)]">({cards.reduce((n, h) => n + (g.status === 'in-deck' ? h.pulled : g.status === 'proxy' ? h.proxies : h.short), 0)})</span></h3>
            <p className="mb-2 text-sm text-[var(--muted)]">{g.hint}</p>
            <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)]">
              {cards.map((h) => <HoldingRow key={h.key} h={h} busy={busy} act={act} />)}
            </ul>
          </section>
        );
      })}
      {extras.length > 0 && (
        <section>
          <h3 data-section="Kept with the deck" className="font-medium">Kept with the deck <span className="font-normal text-[var(--muted)]">({extras.reduce((n, h) => n + h.pulled, 0)})</span></h3>
          <p className="mb-2 text-sm text-[var(--muted)]">Sideboard and maybeboard cards with a copy in the deck box. Not part of the 100.</p>
          <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)]">
            {extras.map((h) => <HoldingRow key={h.key} h={h} busy={busy} act={act} />)}
          </ul>
        </section>
      )}
      {!data.cards.length && <p className="text-center text-[var(--muted)]">This deck has no cards yet.</p>}
      <p className="text-xs text-[var(--muted)]">
        Cards come out of the boxes on your <Link href="/collection" className="underline">Collection</Link> page. Cutting a card from the deck puts its copies back where they came from.
      </p>
    </div>
  );
}

function HoldingRow({ h, busy, act }: { h: Holding; busy: boolean; act: (a: api.DeckCollectionAction) => void }) {
  const firstBox = h.inBoxes[0];
  const firstDeck = h.inDecks[0];
  const canProxy = !h.commander && h.cardIds.length > 0;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 text-sm">
      <span className="flex min-w-0 flex-1 items-center gap-3">
        {h.image ? <Image src={h.image} alt="" width={32} height={45} className="shrink-0 rounded" unoptimized /> : null}
        <span className="min-w-0">
          <span className="block truncate">
            {h.need > 1 ? `${h.need}× ` : ''}{h.name}{h.commander && <span className="text-[var(--muted)]"> · commander</span>}
            {h.board !== 'main' && <span className="text-[var(--muted)]"> · {h.board === 'side' ? 'sideboard' : 'maybeboard'}</span>}
            {h.pulledCopies.some((p) => isProxy(p.variant)) && <span className="ml-1 rounded bg-amber-400/20 px-1 text-[10px] font-semibold text-amber-300">Proxy</span>}
          </span>
          <span className="block truncate text-xs text-[var(--muted)]">
            {h.status === 'in-box' && firstBox && <>In {box(firstBox.location)} · {copyLabel(firstBox)}{firstBox.exact ? '' : ' (another printing)'}{h.inBoxes.length > 1 ? ` · +${h.inBoxes.slice(1).reduce((n, b) => n + b.quantity, 0)} more` : ''}</>}
            {h.status === 'in-other-deck' && <>In {h.inDecks.map((d) => d.listName).join(', ')}</>}
            {h.status === 'missing' && (h.price !== null ? `${money(h.price)} each` : 'No price')}
            {h.status === 'basic' && 'Basic land - not tracked'}
            {(h.status === 'proxy' || h.status === 'in-deck') && h.pulledCopies.length > 0 && h.pulledCopies.map((p) => `${copyLabel(p)} from ${box(p.fromLocation)}`).join(', ')}
            {h.status === 'proxy' && !h.pulledCopies.length && `${h.proxies} prox${h.proxies === 1 ? 'y' : 'ies'}`}
            {h.short > 0 && h.status !== 'missing' && h.pulled + h.proxies > 0 && ` · ${h.pulled + h.proxies} of ${h.need} in`}
          </span>
        </span>
      </span>
      <span className="flex shrink-0 gap-1.5">
        {h.status === 'in-box' && (
          <button disabled={busy} {...steady(() => act({ action: 'pull', key: h.key }))} className={primary}>Pull</button>
        )}
        {h.status === 'in-other-deck' && firstDeck && (
          <button disabled={busy} {...steady(() => act({ action: 'take', key: h.key, fromListId: firstDeck.listId }))} className={small}>Take from {firstDeck.listName}</button>
        )}
        {(h.status === 'missing' || h.status === 'in-other-deck') && canProxy && (
          <button disabled={busy} {...steady(() => act({ action: 'proxies', cardId: h.cardIds[0], proxies: h.proxies + h.short }))} className={small}>Proxy</button>
        )}
        {h.status === 'proxy' && canProxy && !h.pulled && (
          <button disabled={busy} {...steady(() => act({ action: 'proxies', cardId: h.cardIds[0], proxies: 0 }))} className={small}>Not a proxy</button>
        )}
        {(h.status === 'in-deck' || (h.status === 'proxy' && h.pulled > 0)) && (
          <button disabled={busy} {...steady(() => act({ action: 'return', key: h.key }))} className={small}>Return</button>
        )}
      </span>
    </li>
  );
}
