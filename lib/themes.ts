/**
 * The app's looks, chosen per profile. Every theme sets the same colour
 * tokens globals.css defines; "My commander's colours" takes the accent
 * stops from the profile's favourite commander. Plains is the light one.
 */

import { identityStops } from './identity';

export type ThemeId = 'commander' | 'gold' | 'island' | 'swamp' | 'mountain' | 'forest' | 'plains';

export interface Theme {
  label: string;
  hint: string;
  tokens: Record<'background' | 'surface' | 'surface-hover' | 'border' | 'foreground' | 'muted' | 'faint' | 'accent', string>;
  /** The accent stops; commander fills them from the commander's colours. */
  stops: [string, string, string];
  light?: boolean;
}

const DARK = { background: '#100f0e', surface: '#191714', 'surface-hover': '#221f1b', border: '#2c2822', foreground: '#f0e9dd', muted: '#9b9285', faint: '#6c655b' };

export const THEMES: Record<ThemeId, Theme> = {
  commander: { label: "My commander's colours", hint: 'From your favourite commander', tokens: { ...DARK, accent: '#d6aa2e' }, stops: ['#d6aa2e', '#d6aa2e', '#d6aa2e'] },
  gold: { label: 'Gold', hint: 'The original look', tokens: { ...DARK, accent: '#d6aa2e' }, stops: ['#d6aa2e', '#d6aa2e', '#d6aa2e'] },
  island: {
    label: 'Island', hint: 'Deep sea blues',
    tokens: { background: '#0b1218', surface: '#121c25', 'surface-hover': '#182633', border: '#223241', foreground: '#e6eef5', muted: '#93a7b8', faint: '#5f7385', accent: '#5fb3e8' },
    stops: ['#5aa8e6', '#7cc4f0', '#3d86c4'],
  },
  swamp: {
    label: 'Swamp', hint: 'Bruised purple and bone',
    tokens: { background: '#110e14', surface: '#1a1520', 'surface-hover': '#231c2b', border: '#2e2636', foreground: '#ede6f2', muted: '#a397ad', faint: '#6c6175', accent: '#b58be8' },
    stops: ['#a98bd0', '#c9a8f0', '#7d5fa8'],
  },
  mountain: {
    label: 'Mountain', hint: 'Ember and ash',
    tokens: { background: '#130e0c', surface: '#1e1512', 'surface-hover': '#291d18', border: '#36261f', foreground: '#f4e7e0', muted: '#b39b8f', faint: '#7a665c', accent: '#ef6d4f' },
    stops: ['#ef6d4f', '#f59a5b', '#c2462a'],
  },
  forest: {
    label: 'Forest', hint: 'Moss and canopy',
    tokens: { background: '#0d120e', surface: '#151d16', 'surface-hover': '#1c271e', border: '#253427', foreground: '#e5f0e6', muted: '#97ab99', faint: '#627565', accent: '#4fbf7a' },
    stops: ['#4fbf7a', '#8fd17a', '#2f8f55'],
  },
  plains: {
    label: 'Plains', hint: 'Light: parchment and sun', light: true,
    tokens: { background: '#f6f1e6', surface: '#fffaf0', 'surface-hover': '#efe6d3', border: '#ddd2bc', foreground: '#2a241a', muted: '#62584a', faint: '#8a7f6c', accent: '#9a7010' },
    stops: ['#b8860b', '#d9a62e', '#8a6410'],
  },
};

export const THEME_IDS = Object.keys(THEMES) as ThemeId[];

/** The CSS variables a theme sets, the commander's colours filled in. */
export function themeVars(id: ThemeId, identity: string[] | null): Record<string, string> {
  const theme = THEMES[id] ?? THEMES.gold;
  const stops = id === 'commander' && identity ? identityStops(identity) : theme.stops;
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(theme.tokens)) vars[`--${k}`] = v;
  if (id === 'commander' && identity) vars['--accent'] = stops[0];
  vars['--c1'] = stops[0];
  vars['--c2'] = stops[1];
  vars['--c3'] = stops[2];
  return vars;
}
