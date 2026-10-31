'use client';

/**
 * A card image that tilts toward the pointer and catches the light, as a
 * card in the hand does; a foil one shimmers. Only with a mouse - on a touch
 * screen it stays still - and not at all for reduced motion.
 */

import { useRef } from 'react';

export default function Tilt({ children, foil = false, className = '' }: {
  children: React.ReactNode;
  foil?: boolean;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);

  const move = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse' || !box.current) return;
    const el = box.current;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.style.transform = `perspective(700px) rotateY(${(x - 0.5) * 14}deg) rotateX(${(0.5 - y) * 14}deg) scale(1.03)`;
      el.style.boxShadow = '0 18px 32px rgba(0,0,0,.5)';
    }
    el.style.setProperty('--gx', `${x * 100}%`);
    el.style.setProperty('--gy', `${y * 100}%`);
    el.style.setProperty('--fx', `${x * 100}%`);
  };
  const leave = () => {
    if (!box.current) return;
    box.current.style.transform = '';
    box.current.style.boxShadow = '';
  };

  return (
    <div ref={box} onPointerMove={move} onPointerLeave={leave} className={`tilt relative overflow-hidden ${className}`}>
      {children}
      {foil && <span aria-hidden className="foil-sheen" />}
      <span aria-hidden className="tilt-glare" />
    </div>
  );
}
