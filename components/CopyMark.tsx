'use client';

/**
 * A deck card's collection mark: ✓ yours, P a proxy, ↓ free in a box, ⇄ in
 * another deck, $ to buy (basic lands have none). Hovering says what it
 * means; a tap opens what can be done about it - pull it from a box, take it
 * from the other deck, return it, mark it as a proxy - and a link to every
 * copy on the Collection page. The words come from lib/copy-status.ts.
 */

import Link from 'next/link';

import Popover from './Popover';
import type * as api from '@/lib/api';
import type { Holding, Status } from '@/lib/collection';
import { markOf } from '@/lib/copy-status';
import { variantBadges } from '@/lib/copy-variant';
import { steady } from '@/lib/steady-tap';

/** Do a move on the deck's copies; `done` is what the toast says after. */
export type CollectionAct = (act: api.DeckCollectionAction, holding: Holding, done: string) => void;

const TONE: Record<Status, string> = {
  'in-deck': 'bg-emerald-400 text-[#06210f]',
  proxy: 'bg-amber-300 text-[#221c08]',
  'in-box': 'bg-sky-400 text-[#04202c]',
  'in-other-deck': 'bg-violet-400 text-[#1a0a2c]',
  missing: 'bg-rose-400 text-[#2c0610]',
  basic: '',
};

const box = (name: string) => name || 'Unsorted';
const action = 'flex min-h-9 w-full items-center justify-between gap-2 rounded-lg px-2.5 text-left text-sm hover:bg-[var(--surface-hover)] disabled:opacity-50';

export default function CopyMark({ holding: h, busy, onAct, className = '' }: {
  holding: Holding | undefined;
  busy: boolean;
  onAct: CollectionAct;
  className?: string;
}) {
  const mark = markOf(h);
  if (!h || !mark) return null;
  const canProxy = !h.commander && h.cardIds.length > 0;
  // One button per box (the best copy in each), and per deck: a few at most.
  const boxes = [...new Map(h.inBoxes.map((b) => [b.location, b])).values()].slice(0, 3);
  const returnTo = [...new Set(h.pulledCopies.map((p) => box(p.fromLocation)))].join(', ');
  const copyNote = (b: Holding['inBoxes'][number]) =>
    [`${b.set.toUpperCase()} #${b.number}`, b.finish !== 'nonfoil' ? b.finish : '', ...variantBadges(b.variant).map((v) => v.text), b.exact ? '' : 'another printing'].filter(Boolean).join(' · ');
  return (
    <Popover
      aria-label={`${mark.label}: ${h.name}`}
      align="right"
      panelClassName="w-[min(18rem,calc(100vw-1rem))]"
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold leading-none [@media(hover:none)]:h-7 [@media(hover:none)]:w-7 [@media(hover:none)]:text-[13px] shadow-[0_0_0_1.5px_rgba(0,0,0,0.55)] ${TONE[mark.status]} ${className}`}
      label={<span data-mark={mark.status} title={`${mark.label} - ${mark.tip}`} aria-hidden>{mark.symbol}</span>}
    >
      <p className="flex items-center gap-2 text-sm font-semibold">
        <span aria-hidden className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-extrabold ${TONE[mark.status]}`}>{mark.symbol}</span>
        {mark.label}
      </p>
      <p className="mt-1 text-sm text-[var(--muted)]"><span className="text-[var(--foreground)]">{h.name}</span>: {mark.tip}</p>
      <div className="mt-2 flex flex-col">
        {h.status === 'in-box' && boxes.map((b) => (
          <button key={b.location} disabled={busy} className={action}
            {...steady(() => onAct({ action: 'pull', key: h.key, quantity: 1, from: { cardId: b.cardId, finish: b.finish, location: b.location, variant: b.variant } }, h, `Pulled ${h.name} from ${box(b.location)}.`))}>
            <span>Pull from {box(b.location)}</span><span className="truncate text-xs text-[var(--muted)]">{copyNote(b)}</span>
          </button>
        ))}
        {h.status === 'in-other-deck' && h.inDecks.slice(0, 3).map((d) => (
          <button key={d.listId} disabled={busy} className={action}
            {...steady(() => onAct({ action: 'take', fromListId: d.listId, key: h.key }, h, `Took ${h.name} from ${d.listName}.`))}>
            <span className="truncate">Take from {d.listName}</span>
          </button>
        ))}
        {h.pulled > 0 && (
          <button disabled={busy} className={action} {...steady(() => onAct({ action: 'return', key: h.key }, h, `Returned ${h.name} to ${returnTo}.`))}>
            <span className="truncate">Return to {returnTo}</span>
          </button>
        )}
        {(h.status === 'missing' || h.status === 'in-other-deck' || h.status === 'in-box') && canProxy && (
          <button disabled={busy} className={action}
            {...steady(() => onAct({ action: 'proxies', cardId: h.cardIds[0], proxies: h.proxies + h.short }, h, `Marked ${h.name} as a proxy.`))}>
            <span>Mark as proxy</span>
          </button>
        )}
        {h.status === 'proxy' && canProxy && !h.pulled && (
          <button disabled={busy} className={action} {...steady(() => onAct({ action: 'proxies', cardId: h.cardIds[0], proxies: 0 }, h, `${h.name} is no longer a proxy.`))}>
            <span>Not a proxy</span>
          </button>
        )}
      </div>
      <Link href={`/collection?q=${encodeURIComponent(`"${h.name}"`)}`} className="mt-2 block border-t border-[var(--border)] pt-2 text-xs text-[var(--muted)] underline hover:text-[var(--foreground)]">
        See every copy of {h.name}
      </Link>
    </Popover>
  );
}
