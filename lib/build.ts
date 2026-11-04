/**
 * The Build tab, worked out from the cards without a model: what kind of
 * commander it is, the few things worth fixing - each said in plain words,
 * with why it matters and the cards behind it - every role against the
 * usual counts, and the mana against Karsten's numbers. Pure.
 *
 * What counts follows docs/deckbuilding-reference.md: the deck's size, the
 * skeleton of roles, a way to win, the lands and the colour sources.
 */

import type { RoleCount, RoleGroup } from './roles';
import type { ScryfallCard } from './scryfall';
import { detectStyles } from './styles';

export interface Gap {
  role: string;
  label: string;
  have: number;
  want: [number, number];
}

/** One thing worth looking at, most pressing first. */
export interface Issue {
  /** Stable for a deck, so it can be hidden: 'size', 'role:ramp', 'finisher', 'lands', 'colors', 'plan'. */
  id: string;
  /** 'fix': off the usual by a fair way. 'consider': worth a look, a guideline only. */
  level: 'fix' | 'consider';
  title: string;
  why: string;
  /** The cards behind it, when there are some to show. */
  cards: string[];
  /** What fixes it: find cards for a role, open the cut list, or go to the tags. */
  action: { kind: 'fill'; role: string; label: string } | { kind: 'cuts'; label: string } | { kind: 'tags'; label: string } | null;
}

export interface RoleRow {
  role: string;
  label: string;
  group: RoleGroup;
  have: number;
  want: [number, number] | null;
  cards: string[];
}

export interface BuildPlan {
  style: { label: string; note: string } | null;
  issues: Issue[];
  gaps: Gap[];
  /** Every role with a guideline, short ones first: what Fill can look for. */
  targets: Gap[];
  /** Every role the deck has cards in, or a guideline for. */
  roles: RoleRow[];
  /** Cards that end the game: finisher roles, and cards you tagged as a win condition. */
  finishers: string[];
  /** Lands: what the deck runs, the plan's range (from its flip turn), and Karsten's formula as a second opinion. */
  lands: { have: number; want: number; averageMv: number; cheap: number; range: [number, number]; flip: number | null };
  /** Each colour's sources against Karsten's table, from the Health analysis. */
  colors: Array<{ color: string; sources: number; needed: number | null; neededFor: string | null }>;
  size: number;
}

/** What a commander rewards, read from its text alone (styles.ts reads the deck's cards too). */
export function commanderStyle(commander: ScryfallCard | null): { label: string; note: string } | null {
  if (!commander) return null;
  const { primary } = detectStyles(commander, []);
  return { label: primary.label, note: primary.note };
}

/**
 * Karsten's land count for Commander, never below 37: 31.42 + 3.13 x the
 * average mana value of the spells - 0.28 x the cheap (MV 2 or less) draw
 * and ramp spells.
 */
export function karstenLands(averageMv: number, cheapDrawAndRamp: number): number {
  return Math.max(37, Math.round(31.42 + 3.13 * averageMv - 0.28 * cheapDrawAndRamp));
}

// Why each role with a guideline matters, for the issue that says it is short.
const WHY: Record<string, string> = {
  ramp: 'Ramp puts you a turn or two ahead of the table and gets the commander out early.',
  draw: 'Card advantage keeps your hand full after turn five, when a deck without it runs out of things to do.',
  removal: 'Spot removal answers the one creature or artifact that would otherwise beat you.',
  wipe: 'Board wipes reset a game the table is winning and you are not.',
};

/** Roles that close out a game. */
export const FINISHING = ['wincon', 'finisher', 'extra-turn', 'extra-combat', 'overrun', 'drain'];

export function buildPlan(input: {
  commander: ScryfallCard | null;
  cards: Array<{ card: ScryfallCard; quantity: number }>;
  roles: RoleCount[] | null;
  lands: number;
  averageMv: number;
  size: number;
  colors?: BuildPlan['colors'];
  brief: string;
  /** Cards the owner tagged as a win condition on the Tags tab. */
  wincons?: string[];
  /** The deck's plan: its style and the ranges it uses in place of the usual ones. */
  style?: { label: string; note: string } | null;
  targets?: Record<string, [number, number]>;
  /** The plan's land range and the flip turn it comes from. */
  landRange?: [number, number];
  flip?: number;
}): BuildPlan {
  const style = input.style !== undefined ? input.style : commanderStyle(input.commander);
  const roles = (input.roles ?? []).map((r) => (r.target && input.targets?.[r.id] ? { ...r, target: input.targets[r.id] } : r));
  const gaps: Gap[] = roles.filter((r) => r.target && r.count < r.target[0])
    .map((r) => ({ role: r.id, label: r.label, have: r.count, want: r.target! }));
  const finishers = [...new Set([...roles.filter((r) => FINISHING.includes(r.id)).flatMap((r) => r.cards), ...(input.wincons ?? [])])].sort();

  const cheapNames = new Set(roles.filter((r) => ['ramp', 'draw'].includes(r.id)).flatMap((r) => r.cards));
  const cheap = input.cards.filter((c) => cheapNames.has(c.card.name) && (c.card.cmc ?? 0) <= 2).reduce((n, c) => n + c.quantity, 0);
  const want = karstenLands(input.averageMv, cheap);
  const colors = input.colors ?? [];

  const issues: Issue[] = [];
  const over = input.size - 100;
  if (over > 0) {
    issues.push({
      id: 'size', level: 'fix', title: `${over} card${over === 1 ? '' : 's'} over 100`,
      why: 'A Commander deck is exactly 100 cards, the commander included. The cut list weighs every card and says why it could go.',
      cards: [], action: { kind: 'cuts', label: 'Open the cut list' },
    });
  } else if (over < 0) {
    issues.push({
      id: 'size', level: 'fix', title: `${-over} card${over === -1 ? '' : 's'} short of 100`,
      why: gaps.length ? `Start with what the deck is light on - ${gaps.map((g) => g.label.toLowerCase()).join(', ')} - then cards that fit the commander.` : 'Every role is at its usual count, so add cards that fit the commander, or lands.',
      cards: [], action: { kind: 'fill', role: gaps[0]?.role ?? 'ramp', label: 'Find cards' },
    });
  }
  if (input.roles) {
    for (const r of roles.filter((x) => x.target && x.count < x.target[0])) {
      const [lo, hi] = r.target!;
      issues.push({
        id: `role:${r.id}`, level: r.count < lo - 2 ? 'fix' : 'consider',
        title: `${r.label}: ${r.count}, the plan wants ${lo}-${hi}`,
        why: `${WHY[r.id] ?? ''} ${r.count ? `These ${r.count} count:` : 'Nothing in the deck counts yet.'}`.trim(),
        cards: r.cards, action: { kind: 'fill', role: r.id, label: `Find ${r.label.toLowerCase()}` },
      });
    }
    if (!finishers.length) {
      issues.push({
        id: 'finisher', level: 'consider', title: 'No clear way to win found',
        why: 'Nothing reads as a finisher - no overruns, extra turns, drain, or cards Scryfall marks as winning the game - and none of your tags are a win condition. If the deck wins by attacking with its creatures or the commander, tag those cards as a win condition on the Tags tab and this goes away.',
        cards: [], action: { kind: 'fill', role: 'finisher', label: 'Find finishers' },
      });
    }
  }
  const range = input.landRange ?? [want - 1, want + 1];
  const second = input.landRange ? ` Karsten's formula, a second opinion, says ${want} for this curve (average mana value ${input.averageMv.toFixed(2)}, ${cheap} cheap ramp and draw spells).` : '';
  if (input.lands < range[0]) {
    issues.push({
      id: 'lands', level: input.lands < range[0] - 2 ? 'fix' : 'consider', title: `${input.lands} lands, the plan wants ${range[0]}-${range[1]}`,
      why: `${input.flip ? `A deck that needs ${input.flip} mana to get going runs about ${range[0]}-${range[1]} lands.` : 'Too few lands means missed land drops.'} Play more lands, or more cheap ramp: a two-mana rock gets you ahead where a land only keeps up.${second}`,
      cards: [], action: { kind: 'fill', role: 'ramp', label: 'Find cheap ramp' },
    });
  } else if (input.lands > range[1]) {
    issues.push({
      id: 'lands', level: 'consider', title: `${input.lands} lands, the plan wants ${range[0]}-${range[1]}`,
      why: `A land or two could be a spell instead.${second}`,
      cards: [], action: null,
    });
  }
  const short = colors.filter((x) => x.needed !== null && x.sources < x.needed - 1);
  if (short.length) {
    const one = (n: number) => String(Math.round(n * 10) / 10);
    issues.push({
      id: 'colors', level: short.some((c) => c.needed! - c.sources > 4) ? 'fix' : 'consider',
      title: `Short of ${short.map((c) => `{${c.color}}`).join('')} sources for the hungriest spells`,
      why: `${short.map((c) => `{${c.color}} ${one(c.sources)} of ${c.needed}, set by ${c.neededFor}`).join('; ')}. Karsten's table says how many sources a spell's colours need to cast it on curve in most games. Swap basics or single-colour lands for ones that make more of these colours - or, if one spell sets a bar far above the rest, ask whether it is worth it.`,
      cards: [], action: null,
    });
  }
  issues.sort((a, b) => (a.level === b.level ? 0 : a.level === 'fix' ? -1 : 1));

  const targets = [...gaps, ...roles.filter((r) => r.target && r.count >= r.target[0])
    .map((r) => ({ role: r.id, label: r.label, have: r.count, want: r.target! }))];
  const rows: RoleRow[] = roles.filter((r) => r.target || r.count > 0)
    .map((r) => ({ role: r.id, label: r.label, group: r.group, have: r.count, want: r.target ?? null, cards: r.cards }));
  return { style, issues, gaps, targets, roles: rows, finishers, colors, lands: { have: input.lands, want, averageMv: input.averageMv, cheap, range, flip: input.flip ?? null }, size: input.size };
}
