/**
 * Colour identity as the app's accent: inside a deck or a commander search,
 * the commander's colours take over from the app's gold - the title, the main
 * button, the active tab, the bars. Pure: shared by the server and the pages.
 *
 * Three stops, --c1 to --c3, always set, so a gradient over them works for
 * one colour (a lighter and darker shade of it), two or three (each colour),
 * and four or five (the first three in WUBRG order, which still reads as
 * "many colours"). Colourless is silver.
 */

import type { CSSProperties } from 'react';

/** Bright enough to read on the dark background, close to the mana symbols' own colours. */
export const MANA: Record<string, string> = {
  W: '#f2dfa0',
  U: '#5aa8e6',
  B: '#a98bd0',
  R: '#ef6d4f',
  G: '#4fbf7a',
  C: '#b9b4ac',
};

/** A second shade for a one-colour identity, so its gradient still has depth. */
const SHADE: Record<string, string> = {
  W: '#c9a76a',
  U: '#3b6fb8',
  B: '#6d4f9c',
  R: '#c2412e',
  G: '#2f8a52',
  C: '#7d7870',
};

const ORDER = 'WUBRG';

/** The colours of an identity in WUBRG order: "RG" -> ["R","G"]; "" -> ["C"]. */
export function identityColours(identity: string | string[] | null | undefined): string[] {
  const letters = new Set((Array.isArray(identity) ? identity.join('') : identity ?? '').toUpperCase().split(''));
  const colours = ORDER.split('').filter((c) => letters.has(c));
  return colours.length ? colours : ['C'];
}

/** The three accent stops for an identity. */
export function identityStops(identity: string | string[] | null | undefined): [string, string, string] {
  const c = identityColours(identity);
  if (c.length === 1) return [MANA[c[0]], SHADE[c[0]], MANA[c[0]]];
  if (c.length === 2) return [MANA[c[0]], MANA[c[1]], MANA[c[1]]];
  return [MANA[c[0]], MANA[c[1]], MANA[c[2]]];
}

/** Style that sets --c1..--c3 on an element, for everything inside it. */
export function identityStyle(identity: string | string[] | null | undefined): CSSProperties {
  const [c1, c2, c3] = identityStops(identity);
  return { '--c1': c1, '--c2': c2, '--c3': c3 } as CSSProperties;
}
