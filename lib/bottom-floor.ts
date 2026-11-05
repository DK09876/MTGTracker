/**
 * How far down the screen a popup may reach: above any bar fixed along the
 * bottom - the phone's tab bar, or a deck's rail when it is one - less a
 * margin. The rail as a column beside the page (wide screens) is not a bar.
 */
export function bottomFloor(margin = 8): number {
  const bars = [...document.querySelectorAll('[data-bottom-nav], [data-deck-rail]')]
    .map((el) => el.getBoundingClientRect())
    .filter((b) => b.height > 0 && b.top > window.innerHeight / 2);
  return Math.min(window.innerHeight, ...bars.map((b) => b.top)) - margin;
}
