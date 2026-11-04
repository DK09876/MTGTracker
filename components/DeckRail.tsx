'use client';

/**
 * A deck's tabs and the current page's sections, always in reach: a sticky
 * column on the left of a wide screen, a bar along the bottom of a narrow
 * one (above the app's own nav). "On this page" lists every element the
 * page marks with data-section, so each tab names its own parts - on Cards,
 * every group with its count - and keeps up as they change.
 */

import { useEffect, useState } from 'react';

import type { DeckTab } from './DeckBuild';

const TABS: Array<[DeckTab, string]> = [
  ['cards', 'Cards'], ['plan', 'Plan'], ['tune', 'Tune'], ['tags', 'Tags'],
  ['health', 'Health'], ['playtest', 'Playtest'], ['chat', 'Chat'], ['collection', 'Collection'],
];

interface Section { id: string; label: string; count: string | null }

interface Props {
  section: DeckTab;
  onSection: (tab: DeckTab) => void;
  planConfirmed: boolean;
}

const smooth = (): ScrollBehavior => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

export default function DeckRail({ section, onSection, planConfirmed }: Props) {
  const [parts, setParts] = useState<Section[]>([]);

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
            return { id: el.id, label: el.dataset.section ?? '', count: el.dataset.sectionCount ?? null };
          });
        setParts((prev) => (JSON.stringify(prev) === JSON.stringify(found) ? prev : found));
      });
    };
    read();
    const watch = new MutationObserver(read);
    const root = document.querySelector('main') ?? document.body;
    watch.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-section', 'data-section-count'] });
    return () => { watch.disconnect(); cancelAnimationFrame(frame); };
  }, [section]);

  const go = (tab: DeckTab) => {
    onSection(tab);
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  return (
    <nav
      data-tour="deck-tabs"
      aria-label="Deck"
      className="fixed inset-x-2 bottom-[calc(var(--nav-h)+0.5rem)] z-30 flex gap-1 overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)]/95 p-1.5 text-sm shadow-lg backdrop-blur
        lg:sticky lg:inset-x-auto lg:bottom-auto lg:top-20 lg:z-0 lg:max-h-[calc(100vh-6rem)] lg:flex-col lg:overflow-y-auto lg:p-2 lg:shadow-none"
    >
      <span className="hidden px-3 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)] lg:block">Deck</span>
      <div role="tablist" aria-label="Deck view" className="flex gap-1 lg:flex-col">
        {TABS.map(([value, label]) => (
          <button
            key={value}
            role="tab"
            data-tour-tab={value}
            aria-selected={section === value}
            onClick={() => go(value)}
            className={`flex shrink-0 items-center justify-between gap-2 whitespace-nowrap rounded-xl px-3 py-1.5 text-left ${section === value ? 'id-grad font-semibold text-[#15110a]' : 'text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]'}`}
          >
            <span>{value === 'chat' && !planConfirmed && <span aria-hidden>🔒 </span>}{label}</span>
            {value === 'plan' && !planConfirmed && section !== 'plan' && <span className="rounded-full bg-amber-300/15 px-1.5 text-xs font-semibold text-amber-300">start here</span>}
          </button>
        ))}
      </div>
      <div className="flex shrink-0 gap-1 border-l border-[var(--border)] pl-1 lg:mt-2 lg:flex-col lg:border-l-0 lg:border-t lg:pl-0 lg:pt-2">
        <span className="hidden px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)] lg:block">On this page</span>
        <button onClick={() => window.scrollTo({ top: 0, behavior: smooth() })} className="shrink-0 whitespace-nowrap rounded-xl px-3 py-1 text-left text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]">↑ Top</button>
        {parts.map((p) => (
          <button
            key={p.id}
            onClick={() => document.getElementById(p.id)?.scrollIntoView({ behavior: smooth(), block: 'start' })}
            className="flex shrink-0 items-center justify-between gap-3 whitespace-nowrap rounded-xl px-3 py-1 text-left text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)] lg:text-[13px]"
          >
            <span className="truncate">{p.label}</span>
            {p.count && <span className="tabular-nums">{p.count}</span>}
          </button>
        ))}
      </div>
    </nav>
  );
}
