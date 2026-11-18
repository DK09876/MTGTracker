/**
 * A hover effect for a real mouse only. iPhone Safari sends a pretend
 * mouseenter (and mousemove) on the first tap; when the handler changes the
 * page - a row highlighted, a card preview shown, a tip opened - Safari treats
 * the tap as a hover and never sends the click, so nothing seems to happen.
 * Pointer events say what the pointer is, so a touch goes straight to the click.
 *
 *   <button onPointerEnter={mouseOnly(() => setActive(i))} onClick={...}>
 */
import type { PointerEvent } from 'react';

/** For a handler that must stay inline (one reading refs): `if (!isMouse(e)) return;`. */
export const isMouse = (e: { pointerType: string }) => e.pointerType === 'mouse';

export const mouseOnly = <T extends Element>(handler: (e: PointerEvent<T>) => void) =>
  (e: PointerEvent<T>) => { if (e.pointerType === 'mouse') handler(e); };
