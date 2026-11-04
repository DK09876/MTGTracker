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
  lands: { have: number; want: number; averageMv: number; cheap: number };
  /** Each colour's sources against Karsten's table, from the Health analysis. */
  colors: Array<{ color: string; sources: number; needed: number | null; neededFor: string | null }>;
  size: number;
}

// What a commander rewards, read from its text: the first that fits names
// its style (reference: "classify the commander's style first").
const STYLES: Array<{ label: string; note: string; test: RegExp }> = [
  { label: 'Spells engine', note: 'Rewards casting instants and sorceries: cheap spells, rituals and copy effects are the deck.', test: /whenever you cast (an? )?(instant|sorcery|noncreature)|copy (that|target) (instant|sorcery|spell)|magecraft/i },
  { label: 'Aristocrats', note: 'Rewards creatures dying or being sacrificed: fodder, sac outlets and death payoffs.', test: /whenever (a|another) (creature|nontoken creature)[^.]* dies|sacrifice (a|another) creature/i },
  { label: 'Go wide', note: 'Makes or rewards many creatures: token makers, anthems and overruns.', test: /create[^.]* (creature )?tokens?|for each creature you control/i },
  { label: 'Voltron', note: 'Wins with commander damage: equipment, auras and protection for one creature.', test: /equipped|enchanted creature|attach|aura/i },
  { label: 'Combat', note: 'Rewards attacking: evasion, extra combats and ways to push damage through.', test: /whenever [^.]* attacks|combat damage to a player|extra combat/i },
  { label: '+1/+1 counters', note: 'Spreads and multiplies counters: counter makers, doublers and payoffs.', test: /\+1\/\+1 counter/i },
  { label: 'Graveyard', note: 'Uses the graveyard: self-mill, reanimation and recursion.', test: /from your graveyard|mill|return target creature card/i },
  { label: 'Lands', note: 'Rewards land drops: extra lands, fetches and landfall payoffs.', test: /landfall|whenever a land enters|play an additional land/i },
  { label: 'Artifacts', note: 'Rewards artifacts: rocks, treasures and artifact payoffs.', test: /artifact/i },
  { label: 'Card draw', note: 'Rewards drawing cards: wheels, draw engines and draw payoffs.', test: /whenever you draw/i },
  { label: 'Lifegain', note: 'Rewards gaining life: lifelink, gain-life triggers and payoffs.', test: /whenever you gain life/i },
];

export function commanderStyle(commander: ScryfallCard | null): { label: string; note: string } | null {
  if (!commander) return null;
  const text = [commander.oracle_text, ...(commander.card_faces ?? []).map((f) => f.oracle_text)].filter(Boolean).join('\n');
  const found = STYLES.find((s) => s.test.test(text));
  return found ? { label: found.label, note: found.note } : { label: 'Value', note: 'No single thing it rewards: a deck of strong cards built around what it does.' };
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
}): BuildPlan {
  const style = commanderStyle(input.commander);
  const roles = input.roles ?? [];
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
        title: `${r.label}: ${r.count}, most decks run ${lo}-${hi}`,
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
  if (input.lands < want - 1) {
    issues.push({
      id: 'lands', level: input.lands < want - 3 ? 'fix' : 'consider', title: `${input.lands} lands, the formula suggests ${want}`,
      why: `Karsten's formula, from the spells' average mana value (${input.averageMv.toFixed(2)}) and the ${cheap} cheap ramp and draw spells. Play more lands, or more ramp and draw at two mana or less: every four of those is worth about one land.`,
      cards: [], action: { kind: 'fill', role: 'ramp', label: 'Find cheap ramp' },
    });
  } else if (input.lands > want + 2) {
    issues.push({
      id: 'lands', level: 'consider', title: `${input.lands} lands, the formula suggests ${want}`,
      why: `For a curve this low (average mana value ${input.averageMv.toFixed(2)}), a land or two could be a spell instead.`,
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
  if (!input.brief.trim()) {
    issues.push({
      id: 'plan', level: 'consider', title: 'No plan written down',
      why: 'Optional: a sentence on how the deck wins helps the AI on the Tags and Chat tabs, and the cut list protects the cards you tag as the plan.',
      cards: [], action: { kind: 'tags', label: 'Write the brief' },
    });
  }
  issues.sort((a, b) => (a.level === b.level ? 0 : a.level === 'fix' ? -1 : 1));

  const targets = [...gaps, ...roles.filter((r) => r.target && r.count >= r.target[0])
    .map((r) => ({ role: r.id, label: r.label, have: r.count, want: r.target! }))];
  const rows: RoleRow[] = roles.filter((r) => r.target || r.count > 0)
    .map((r) => ({ role: r.id, label: r.label, group: r.group, have: r.count, want: r.target ?? null, cards: r.cards }));
  return { style, issues, gaps, targets, roles: rows, finishers, colors, lands: { have: input.lands, want, averageMv: input.averageMv, cheap }, size: input.size };
}
