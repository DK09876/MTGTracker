import { describe, expect, it, vi } from 'vitest';

import { steady } from './steady-tap';

const el = () => ({}) as HTMLElement;
const down = (target: HTMLElement, t: number) => ({ currentTarget: target, timeStamp: t }) as unknown as React.PointerEvent<HTMLElement>;
const click = (target: HTMLElement, t: number, detail = 1) => ({ currentTarget: target, timeStamp: t, detail }) as unknown as React.MouseEvent<HTMLElement>;

describe('steady', () => {
  it('counts a tap that began and ended on the same button', () => {
    const handler = vi.fn();
    const button = el();
    const tap = steady(handler);
    tap.onPointerDown(down(button, 100));
    tap.onClick(click(button, 180));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('drops a click that arrives on a button the finger never pressed - the page moved', () => {
    const intended = vi.fn();
    const neighbour = vi.fn();
    const denzilore = el();
    const vorthos = el();
    steady(intended).onPointerDown(down(denzilore, 100));
    // The keyboard closed, the dialog jumped, and the click landed a row up.
    steady(neighbour).onClick(click(vorthos, 180));
    expect(neighbour).not.toHaveBeenCalled();
  });

  it('drops a press held too long, and counts each press once', () => {
    const handler = vi.fn();
    const button = el();
    const tap = steady(handler);
    tap.onPointerDown(down(button, 0));
    tap.onClick(click(button, 5000));
    tap.onClick(click(button, 5001));
    expect(handler).not.toHaveBeenCalled();
  });

  it('always counts the keyboard (Enter or Space: no press, detail 0)', () => {
    const handler = vi.fn();
    steady(handler).onClick(click(el(), 10, 0));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
