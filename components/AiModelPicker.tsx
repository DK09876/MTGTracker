'use client';

/**
 * Which Claude model a page uses for you - Haiku, Sonnet, Opus, or Fable
 * (off for now) - remembered per profile and page.
 *
 * One small chip ("✦ Opus ▾") beside the action it powers; the choices, what
 * a request costs on each and what is left of today's budget open from it.
 * Four pills and a price line on every AI screen were the loudest thing on
 * them, for a choice made once in a while.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import * as api from '@/lib/api';
import type { AiState } from '@/lib/ai';
import { AREA_OF, costOf, FEATURES, TIER_INFO, TIER_MODEL, TIERS, TIERS_OFF, TYPICAL_TOKENS, type AiArea, type Feature, type Tier } from '@/lib/models';
import { dollars } from '@/lib/spend';

export default function AiModelPicker({ area, align = 'left', className = '' }: { area: AiArea; align?: 'left' | 'right'; className?: string }) {
  const [state, setState] = useState<AiState | null>(null);
  const [busy, setBusy] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number; above: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const read = () => { api.aiState().then(setState).catch(() => {}); };
    read();
    window.addEventListener(api.AI_CHANGED, read);
    window.addEventListener(api.AI_SPENT, read);
    return () => { window.removeEventListener(api.AI_CHANGED, read); window.removeEventListener(api.AI_SPENT, read); };
  }, []);

  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    const outside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!button.current?.contains(t) && !popup.current?.contains(t)) close();
    };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); button.current?.focus(); } };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [at]);

  // Kept on screen: flipped above the chip when there is no room below, and
  // pulled in from the screen's edges.
  useLayoutEffect(() => {
    if (!at || !popup.current) return;
    const r = popup.current.getBoundingClientRect();
    const floor = window.innerHeight - (document.querySelector('[data-bottom-nav]')?.getBoundingClientRect().height ?? 0) - 8;
    popup.current.style.top = `${at.top + r.height > floor && at.above - r.height >= 8 ? at.above - r.height : Math.max(8, Math.min(at.top, floor - r.height))}px`;
    popup.current.style.left = `${Math.max(8, Math.min(at.left, window.innerWidth - r.width - 8))}px`;
    popup.current.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  });

  const tier = state?.tiers[area] ?? null;
  // The page's main step stands for it: reading a deck, for a deck's Tags.
  const feature: Feature = FEATURES.find((f) => AREA_OF[f] === area)!;
  // What this page has really cost on the model, or else its price on a typical request.
  const each = (t: Tier) => state?.costByModel[feature]?.[TIER_MODEL[t]] ?? costOf(TIER_MODEL[t], TYPICAL_TOKENS[feature]);

  const toggle = () => {
    if (at) { setAt(null); return; }
    const r = button.current!.getBoundingClientRect();
    setAt({ top: r.bottom + 6, left: align === 'right' ? r.right - 272 : r.left, above: r.top - 6 });
  };

  const pick = async (t: Tier) => {
    if (!state || busy || TIERS_OFF.includes(t)) return;
    if (t === tier) { setAt(null); return; }
    setBusy(true);
    try {
      setState(await api.chooseTier(area, t));
      setAt(null);
    } finally {
      setBusy(false);
    }
  };

  // Arrow keys move between the choices, as in any menu.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(popup.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not([disabled])') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };

  return (
    <div className={`flex items-center ${align === 'right' ? 'justify-end' : ''} ${className}`} data-tour="ai-mode">
      <button
        ref={button}
        onClick={toggle}
        disabled={!state}
        aria-haspopup="menu"
        aria-expanded={!!at}
        aria-label={`AI model: ${tier ? TIER_INFO[tier].label : '…'}`}
        title="Which Claude model this page uses"
        className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--border)] px-3 text-xs font-medium text-[var(--muted)] transition-colors hover:border-[color-mix(in_srgb,var(--c1)_50%,var(--border))] hover:text-[var(--foreground)] aria-expanded:text-[var(--foreground)]"
      >
        <span aria-hidden className="id-text text-[13px] leading-none">✦</span>
        <span className="text-[var(--foreground)]">{tier ? TIER_INFO[tier].label : 'Model'}</span>
        {tier && <span className="tabular-nums">· ≈ {dollars(each(tier))}</span>}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className="opacity-60"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
      </button>
      {at && state && createPortal(
        <div
          ref={popup}
          role="menu"
          aria-label="AI model"
          onKeyDown={onKey}
          style={{ position: 'fixed', top: at.top, left: at.left }}
          className="z-[80] w-[17rem] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-2xl"
        >
          {TIERS.map((t) => {
            const off = TIERS_OFF.includes(t);
            const on = tier === t;
            return (
              <button
                key={t}
                role="menuitemradio"
                aria-checked={on}
                disabled={off || busy}
                onClick={() => pick(t)}
                className={`flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left outline-none ${off ? 'cursor-not-allowed opacity-45' : 'hover:bg-[var(--surface-hover)] focus-visible:bg-[var(--surface-hover)]'}`}
              >
                <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${on ? 'id-grad' : 'border border-[var(--faint)]'}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2 text-sm">
                    <span className={on ? 'font-semibold' : ''}>{TIER_INFO[t].label}</span>
                    <span className="text-xs tabular-nums text-[var(--muted)]">{off ? 'off for now' : `≈ ${dollars(each(t))}`}</span>
                  </span>
                  <span className="block text-xs text-[var(--muted)]">{TIER_INFO[t].note}</span>
                </span>
              </button>
            );
          })}
          <p className="mt-1 border-t border-[var(--border)] px-3 pb-1.5 pt-2 text-xs tabular-nums text-[var(--muted)]" aria-live="polite">
            Prices are about one request. {dollars(state.spend.left)} of today&apos;s budget left.
          </p>
        </div>,
        document.body,
      )}
    </div>
  );
}
