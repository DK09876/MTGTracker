'use client';

/**
 * A row of controls that stays under the app's top bar as the page scrolls.
 * It is the same row at rest and pinned - never a second bar that appears -
 * and only once pinned does it take a backdrop and a bottom border, so at the
 * top of the page it sits on the page like anything else.
 */

import { useEffect, useState } from 'react';

import { useNavBottom } from '@/lib/use-nav-bottom';

interface Props {
  children: React.ReactNode;
  className?: string;
  /** Layout of the row itself (flex, gaps, wrapping). */
  rowClassName?: string;
  'data-tour'?: string;
  ref?: React.Ref<HTMLDivElement>;
}

export default function StickyBar({ children, className = '', rowClassName = '', ref, ...rest }: Props) {
  const top = useNavBottom();
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (!el) return;
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setStuck(window.scrollY > 0 && el.getBoundingClientRect().top <= top + 1));
    };
    check();
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', check); window.removeEventListener('resize', check); };
  }, [el, top]);

  return (
    <div
      ref={(node) => {
        setEl(node);
        if (typeof ref === 'function') ref(node);
        else if (ref) (ref as React.RefObject<HTMLDivElement | null>).current = node;
      }}
      data-tour={rest['data-tour']}
      data-stuck={stuck || undefined}
      style={{ top }}
      // Full width on phones (edge to edge under the bar), the content's width on wider screens.
      className={`sticky z-20 -mx-4 border-b px-4 transition-[background-color,border-color] duration-150 sm:-mx-3 sm:rounded-b-2xl sm:px-3 ${
        stuck ? 'border-[var(--border)] bg-[var(--background)]/92 backdrop-blur' : 'border-transparent'} ${className}`}
    >
      <div className={rowClassName}>{children}</div>
    </div>
  );
}
