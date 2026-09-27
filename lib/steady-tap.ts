/**
 * Taps that cannot land on the wrong thing.
 *
 * On an iPhone, a tap that closes the keyboard also resizes the page, and a
 * dialog centred in it jumps; the click then goes to whatever is under the
 * finger by then. On 2026-09-26 that put 13 cards meant for one list into
 * two decks: each tap landed one or two rows above the list tapped.
 *
 * `steady(handler)` gives a button a click that only counts when the press
 * began on that same button. A click that arrives without a press on it -
 * the page moved under the finger - is dropped, and the user taps again.
 * Clicks from the keyboard (Enter, Space) have no press and always count.
 */

import type React from 'react';

const pressedAt = new WeakMap<Element, number>();
// Longer than this and it is a press-and-hold that wandered, not a tap.
const MAX_TAP_MS = 2000;

export function steady<E extends HTMLElement>(handler: (e: React.MouseEvent<E>) => void) {
  return {
    onPointerDown: (e: React.PointerEvent<E>) => {
      pressedAt.set(e.currentTarget, e.timeStamp);
    },
    onClick: (e: React.MouseEvent<E>) => {
      if (e.detail === 0) {
        handler(e);
        return;
      }
      const at = pressedAt.get(e.currentTarget);
      pressedAt.delete(e.currentTarget);
      if (at === undefined || e.timeStamp - at > MAX_TAP_MS) return;
      handler(e);
    },
  };
}

/** Close the on-screen keyboard, so nothing moves while the next thing is tapped. */
export function dismissKeyboard(): void {
  if (typeof document === 'undefined') return;
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.matches('input, textarea, select, [contenteditable]')) active.blur();
}
