'use client';

/**
 * A deck's tabs and the current page's sections, always in reach: a sticky
 * column on the left of a wide screen, a bar along the bottom of a narrow
 * one (above the app's own nav). "On this page" lists every element the
 * page marks with data-section, so each tab names its own parts - on Cards,
 * every group with its count - and keeps up as they change.
 *
 * Add cards heads it, in reach as the page scrolls; the deck's name and
 * count are the header's (they were both, one above the other).
 *
 * On a phone it is the only bar along the bottom: the app's own tab bar
 * steps aside on a deck (Nav.tsx), and "‹" leads back to the decks.
 */

import { useEffect, useState } from 'react';

import { DECK_TABS, type DeckTab } from '@/lib/deck-tabs';

const TABS = DECK_TABS;
// A quiet line between changing the deck and checking it, and before Chat.
const BREAK_AFTER: DeckTab[] = ['tune', 'check'];

// 16px line icons, one per tab.
const ICON: Partial<Record<DeckTab, string>> = {
  cards: 'M4 5.5h6v9H4zM8.5 3.5l5.6 1.5-2.3 8.7',
  plan: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
  tune: 'M3 4.5h6M12 4.5h1M3 8h1M7 8h6M3 11.5h5M11 11.5h2M10.5 3v3M5.5 6.5v3M9.5 10v3',
  check: 'M2 8.5h2.5l1.5-4 3 7 1.5-3H14',
  // A tag: a label with a hole.
  tags: 'M2.5 2.5h5l6 6-5 5-6-6v-5ZM5.5 5.5h.01',
  chat: 'M3 3.5h10v7H7l-3 2.5v-2.5H3z',
};
const Icon = ({ tab }: { tab: DeckTab }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="shrink-0 max-lg:hidden" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d={ICON[tab] ?? ''} />
  </svg>
);

interface Section { id: string; label: string; count: string | null; state: string | null; tone: string | null }

interface Props {
  section: DeckTab;
  onSection: (tab: DeckTab) => void;
  planConfirmed: boolean;
  deck: { name: string; art: string | null; size: number; onAdd: () => void };
}

const smooth = (): ScrollBehavior => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

export default function DeckRail({ section, onSection, planConfirmed, deck }: Props) {
  const [parts, setParts] = useState<Section[]>([]);
  const [footer, setFooter] = useState<string | null>(null);

  // The page's sections, read from the page and read again when it changes.
  useEffect(() => {
    let frame = 0;
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const found = [...document.querySelectorAll<HTMLElement>('[data-section]')]
          .filter((el) => el.getClientRects().length)
          .map((el, i) => {
            if (!el.id) el.id = `section-${i}-${(el.dataset.section ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
            return { id: el.id, label: el.dataset.section ?? '', count: el.dataset.sectionCount ?? null, state: el.dataset.sectionState ?? null, tone: el.dataset.sectionTone ?? null };
          });
        setParts((prev) => (JSON.stringify(prev) === JSON.stringify(found) ? prev : found));
        // A page can put a line under its sections: the Plan tab says whether the plan is confirmed.
        const foot = document.querySelector<HTMLElement>('[data-rail-footer]');
        const next = foot ? (foot.dataset.confirmed ? 'yes' : 'no') : null;
        setFooter((prev) => (prev === next ? prev : next));
      });
    };
    read();
    const watch = new MutationObserver(read);
    const root = document.querySelector('main') ?? document.body;
    watch.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-section', 'data-section-count', 'data-section-state', 'data-confirmed'] });
    return () => { watch.disconnect(); cancelAnimationFrame(frame); };
  }, [section]);

  const go = (tab: DeckTab) => {
    onSection(tab);
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  return (
    <nav
      data-tour="deck-tabs"
      data-deck-rail
      aria-label="Deck"
      className="fixed inset-x-2 bottom-[calc(var(--nav-h)+max(0.5rem,env(safe-area-inset-bottom)))] z-30 flex items-center gap-1 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/95 p-1.5 text-sm shadow-[0_8px_30px_rgba(0,0,0,0.45)] backdrop-blur
        lg:sticky lg:inset-x-auto lg:bottom-auto lg:top-20 lg:z-0 lg:max-h-[calc(100vh-6rem)] lg:flex-col lg:items-stretch lg:gap-0.5 lg:overflow-y-auto lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none"
    >
      {/* Wide screens: Add cards heads the rail; the deck's name is in the header above. */}
      <div className="hidden pb-4 lg:block">
        <button data-tour="add-cards" onClick={deck.onAdd} className="btn-go w-full rounded-full px-3 py-1.5 text-sm font-semibold">＋ Add cards</button>
      </div>
      {/* Phones: Add cards leads the bar. */}
      {/* No ‹ back here: the deck header has "All decks", and the five tabs need the room. */}
      <button onClick={deck.onAdd} aria-label="Add cards" className="btn-go flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg font-semibold lg:hidden">＋</button>
      {/* Phones: ＋ stays put; the tabs and sections swipe, fading out at the edge. */}
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overscroll-contain [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)] [scrollbar-width:none] lg:flex-col lg:items-stretch lg:gap-0.5 lg:overflow-visible lg:[mask-image:none]">
      <div role="tablist" aria-label="Deck view" className="flex gap-1 lg:flex-col lg:gap-0.5">
        {TABS.map(([value, label]) => {
          const on = section === value;
          return (
            <div key={value} className="contents">
              <button
                role="tab"
                data-tour-tab={value}
                aria-selected={on}
                onClick={() => go(value)}
                className={`relative flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-2 py-1.5 text-left min-[430px]:px-2.5 lg:gap-2.5 transition-colors lg:rounded-lg lg:px-2.5 ${on
                  ? 'bg-[var(--surface-hover)] font-semibold text-[var(--foreground)] max-lg:bg-[color-mix(in_srgb,var(--c1)_22%,var(--surface))] lg:before:absolute lg:before:inset-y-1.5 lg:before:-left-2 lg:before:w-[3px] lg:before:rounded-full lg:before:bg-[linear-gradient(var(--c1),var(--c2),var(--c3))]'
                  : 'text-[var(--muted)] hover:bg-[var(--surface-hover)]/60 hover:text-[var(--foreground)]'}`}
              >
                {/* Narrow phones: words only, so all five tabs fit without scrolling. */}
                <span className={`max-[429px]:hidden ${on ? 'text-[var(--c1)]' : ''}`}><Icon tab={value} /></span>
                <span className="flex-1">{value === 'tune' && !planConfirmed ? <>Tune<span className="text-[var(--faint)]"> · locked</span></> : label}</span>
                {value === 'plan' && !planConfirmed && !on && (<>
                  <span className="rounded-full bg-amber-300/15 px-1.5 text-[11px] font-semibold text-amber-300 max-lg:hidden">start here</span>
                  {/* Phones: a dot, so all five tabs still fit the bar. */}
                  <span aria-label="start here" className="h-1.5 w-1.5 rounded-full bg-amber-300 lg:hidden" />
                </>)}
              </button>
              {BREAK_AFTER.includes(value) && <span aria-hidden className="mx-2.5 my-1.5 hidden h-px bg-[var(--border)] lg:block" />}
            </div>
          );
        })}
      </div>
      {parts.length > 0 && (
        <div className="flex shrink-0 gap-1 border-l border-[var(--border)] pl-1 lg:mt-4 lg:flex-col lg:gap-0 lg:border-l-0 lg:pl-0">
          <span className="hidden px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--faint)] lg:block">On this page</span>
          {parts.map((p) => (
            <button
              key={p.id}
              onClick={() => document.getElementById(p.id)?.scrollIntoView({ behavior: smooth(), block: 'start' })}
              className={`flex shrink-0 items-center justify-between gap-3 whitespace-nowrap rounded-lg px-2.5 py-1 text-left text-[var(--muted)] hover:text-[var(--foreground)] lg:text-[13px] ${p.state ? 'lg:flex-col lg:items-start lg:gap-0 lg:py-1.5' : ''}`}
            >
              <span className={`truncate ${p.state ? 'lg:font-semibold lg:text-[var(--foreground)]' : ''}`}>{p.label}</span>
              {p.count && <span className="tabular-nums text-[var(--faint)]">{p.count}</span>}
              {p.state && <span className={`hidden text-xs font-semibold lg:block ${p.tone ?? ''}`}>{p.state}</span>}
            </button>
          ))}
          {footer && (
            <div className="hidden flex-col gap-1.5 border-t border-[var(--border)] px-2.5 pt-2 lg:flex">
              <span className={`text-[13px] font-semibold ${footer === 'yes' ? 'text-emerald-300' : 'text-[#e8c558]'}`}>{footer === 'yes' ? 'Confirmed · Tune is open' : 'Not confirmed · Tune is locked'}</span>
              <span className="whitespace-normal text-xs text-[var(--muted)]"><span className="text-[#e8c558]">Gold</span> is yours · <span className="text-[#c3a6e6]">violet ✦</span> is AI · <span className="text-[#8cc0ee]">blue</span> is from the cards</span>
            </div>
          )}
          <button onClick={() => window.scrollTo({ top: 0, behavior: smooth() })} className="shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1 text-left text-[var(--faint)] hover:text-[var(--foreground)] lg:text-[13px]">↑ Back to top</button>
        </div>
      )}
      {/* Room to scroll the last item clear of the fade. */}
      <span aria-hidden className="w-4 shrink-0 lg:hidden" />
      </div>
    </nav>
  );
}
