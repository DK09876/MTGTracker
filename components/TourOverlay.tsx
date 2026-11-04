'use client';

/**
 * The guided tour on screen: a banner saying it is the sample, a spotlight
 * on the part of the page each step is about, and a card with what it does
 * and Back / Next. Each step first goes to its page and clicks what it needs
 * (a tab, a saved item), then waits for its part to appear.
 */

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { guideById } from '@/lib/tour-guides';
import { endTour, getTour, goToStep, useTour } from '@/lib/tour-state';

const WAIT_MS = 6_000;
const PAD = 8;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The first visible element a selector finds, waiting for it to appear. A
 * selector starting "?" is optional: it is only looked for briefly (a
 * button that exists on phones alone).
 */
async function waitFor(selector: string, ms = WAIT_MS): Promise<HTMLElement | null> {
  const optional = selector.startsWith('?');
  const css = optional ? selector.slice(1) : selector;
  const until = Date.now() + (optional ? 1_200 : ms);
  while (Date.now() < until) {
    const el = [...document.querySelectorAll<HTMLElement>(css)].find((x) => x.getClientRects().length);
    if (el) return el;
    await sleep(120);
  }
  return null;
}

/** "history|history-button": the first of those parts that is on screen. */
const targetSelector = (target: string) => target.split('|').map((t) => `[data-tour="${t}"]`).join(', ');

/** On to the next step, or the end after the last. */
function advance() {
  const t = getTour();
  const g = t && guideById(t.guide);
  if (!t || !g) return;
  if (t.step >= g.steps.length - 1) endTour();
  else goToStep(t.step + 1);
}

export default function TourOverlay() {
  const tour = useTour();
  const router = useRouter();
  const path = usePathname();
  const [box, setBox] = useState<DOMRect | null>(null);
  const [ready, setReady] = useState(false);
  const target = useRef<HTMLElement | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const [cardSize, setCardSize] = useState({ w: 360, h: 200 });

  const guide = tour ? guideById(tour.guide) : null;
  const step = guide?.steps[tour!.step] ?? null;

  // Get to the step: its page, its clicks, its part of the page.
  useEffect(() => {
    if (!tour || !step) return;
    let cancelled = false;
    target.current = null;
    void (async () => {
      setReady(false);
      const want = step.path?.(tour.deckId);
      if (want && path !== want) { router.push(want); return; }
      for (const selector of step.click ?? []) {
        const el = await waitFor(selector);
        if (cancelled) return;
        if (el && el.getAttribute('aria-selected') !== 'true' && el.getAttribute('aria-current') !== 'true') {
          el.click();
          await sleep(350);
        }
      }
      const el = step.target ? await waitFor(targetSelector(step.target)) : null;
      if (cancelled) return;
      target.current = el;
      // At once rather than smoothly, so the card is placed where the part ends up.
      // A part taller than most of the screen is shown from its top; so is
      // every part on a phone, where the card covers the bottom of the screen.
      const tall = el && el.getBoundingClientRect().height > window.innerHeight * 0.6;
      el?.scrollIntoView({ block: tall || window.innerWidth < 640 ? 'start' : 'center', behavior: 'instant' });
      await sleep(el ? 200 : 0);
      if (cancelled) return;
      setBox(el ? el.getBoundingClientRect() : null);
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, [tour, step, path, router]);

  // Follow the part of the page as it scrolls or resizes.
  useEffect(() => {
    if (!ready) return;
    let frame = 0;
    const follow = () => {
      if (target.current) setBox(target.current.getBoundingClientRect());
      frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, [ready]);

  // The card's size, to place it beside the spotlight.
  useEffect(() => {
    const el = card.current;
    if (!el) return;
    const watch = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setCardSize({ w: r.width, h: r.height });
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, [tour?.guide]);

  useEffect(() => {
    if (!tour) return;
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') endTour();
      if (e.key === 'ArrowRight') advance();
      if (e.key === 'ArrowLeft' && tour.step > 0) goToStep(tour.step - 1);
    };
    document.addEventListener('keydown', keys);
    return () => document.removeEventListener('keydown', keys);
  });

  if (!tour || !guide) return null;
  const last = tour.step >= guide.steps.length - 1;
  const next = advance;

  // The card sits below the spotlight if it fits, else above, else centred.
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  const phone = vw < 640;
  let style: React.CSSProperties;
  if (phone || !box) {
    // On a phone the card docks at the bottom - or at the top, when the part
    // it is about sits low on the screen and would be covered.
    // Whichever end hides less of the part.
    const bottomEdge = vh - 90 - cardSize.h;
    const topEdge = 104 + cardSize.h;
    const low = !!box && Math.max(0, box.bottom - bottomEdge) > Math.max(0, topEdge - box.top);
    style = phone
      ? (low ? { left: 12, right: 12, top: 'calc(env(safe-area-inset-top) + 6.5rem)' } : { left: 12, right: 12, bottom: 'calc(var(--nav-h, 0px) + 12px)' })
      : { left: (vw - cardSize.w) / 2, top: (vh - cardSize.h) / 2 };
  } else {
    const left = Math.min(Math.max(12, box.left), vw - cardSize.w - 12);
    const below = box.bottom + PAD + 12;
    const above = box.top - PAD - 12 - cardSize.h;
    const top = below + cardSize.h < vh - 12 ? below : above > 12 ? above : vh - cardSize.h - 12;
    // Always on screen, whatever the spotlight does.
    style = { left, top: Math.min(Math.max(12, top), Math.max(12, vh - cardSize.h - 12)) };
  }

  // The list of steps sits on the left; when the part being shown is over
  // there too, it shrinks to its numbers and opens on hover.
  const railCovers = !!box && box.left < 16 + 256 + 12;

  return (
    <>
      <nav
        aria-label="Tour steps"
        className={`group fixed left-4 top-[calc(env(safe-area-inset-top)+6.5rem)] z-[85] hidden max-h-[calc(100vh-9rem)] flex-col overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)]/95 p-2 shadow-2xl backdrop-blur transition-[width] lg:flex ${railCovers ? 'w-12 hover:w-64 focus-within:w-64' : 'w-64'}`}
      >
        <p className={`px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)] ${railCovers ? 'hidden group-hover:block group-focus-within:block' : ''}`}>
          {guide.title} tour
        </p>
        <ol className="flex flex-col gap-0.5">
          {guide.steps.map((s, i) => {
            const now = i === tour.step;
            const done = i < tour.step;
            return (
              <li key={i}>
                <button
                  onClick={() => goToStep(i)}
                  aria-current={now ? 'step' : undefined}
                  className={`flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-xs ${now ? 'bg-[var(--accent)]/15 text-[var(--foreground)]' : 'text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]'}`}
                >
                  <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${now ? 'btn-go' : done ? 'bg-[var(--surface-hover)] text-emerald-400' : 'border border-[var(--border)]'}`}>
                    {done ? '✓' : i + 1}
                  </span>
                  <span className={`truncate ${railCovers ? 'hidden group-hover:inline group-focus-within:inline' : ''}`}>{s.title}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
      <div className="fixed inset-x-0 top-[calc(env(safe-area-inset-top)+3.6rem)] z-[70] flex justify-center px-3 pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-[var(--accent)]/60 bg-[var(--surface)] px-4 py-1.5 text-xs shadow-lg">
          <span><span className="font-semibold text-[var(--accent)]">Guided tour</span> · sample data, nothing here changes</span>
          <button onClick={endTour} className="font-semibold underline">End tour</button>
        </div>
      </div>
      {ready && box && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[75] rounded-xl transition-all duration-300"
          style={{
            left: box.left - PAD, top: box.top - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2,
            boxShadow: '0 0 0 2px var(--accent), 0 0 0 9999px rgba(0, 0, 0, 0.55)',
          }}
        />
      )}
      {ready && !box && <div aria-hidden className="pointer-events-none fixed inset-0 z-[75] bg-black/55" />}
      <div
        ref={card}
        role="dialog"
        aria-live="polite"
        aria-label={`Tour step ${tour.step + 1} of ${guide.steps.length}`}
        style={{ position: 'fixed', ...style, width: phone ? undefined : 360 }}
        className={`z-[90] flex flex-col gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xl transition-opacity ${ready ? 'opacity-100' : 'opacity-0'}`}
      >
        {/* On narrow screens the step count jumps to any step; wide ones have the list on the left. */}
        <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
          <span>{guide.title} ·</span>
          <label className="sr-only" htmlFor="tour-step">Go to step</label>
          <select
            id="tour-step"
            value={tour.step}
            onChange={(e) => goToStep(Number(e.target.value))}
            className="rounded-md border border-[var(--border)] bg-[var(--background)] px-1.5 py-0.5 text-xs lg:hidden"
          >
            {guide.steps.map((s, i) => <option key={i} value={i}>{i + 1} of {guide.steps.length} · {s.title}</option>)}
          </select>
          <span className="max-lg:hidden">{tour.step + 1} of {guide.steps.length}</span>
        </div>
        <h2 className="font-display text-lg font-semibold">{step?.title}</h2>
        <p className="text-sm leading-relaxed text-[var(--muted)]">{step?.body}</p>
        <div className="mt-1 flex items-center gap-2">
          <button onClick={endTour} className="text-sm text-[var(--muted)] hover:text-[var(--foreground)]">Skip</button>
          <span className="flex-1" />
          {tour.step > 0 && (
            <button onClick={() => goToStep(tour.step - 1)} className="rounded-full border border-[var(--border)] px-3.5 py-1.5 text-sm hover:bg-[var(--surface-hover)]">Back</button>
          )}
          <button onClick={next} className="btn-go rounded-full px-4 py-1.5 text-sm font-semibold">{last ? 'Finish' : 'Next'}</button>
        </div>
      </div>
    </>
  );
}
