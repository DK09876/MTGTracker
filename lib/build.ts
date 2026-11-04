/**
 * The Build tab's checklist, worked out from the cards without a model:
 * what kind of commander it is, whether the deck has a plan, which roles
 * are short of the usual counts, how many lands Karsten's formula wants,
 * and whether the deck is the right size. Pure.
 *
 * The steps follow docs/deckbuilding-reference.md: classify the commander
 * first, then the plan, the skeleton of roles, filling the gaps, the mana,
 * cuts down to 100, and a final check.
 */

import type { RoleCount } from './roles';
import type { ScryfallCard } from './scryfall';

export type StepId = 'style' | 'plan' | 'skeleton' | 'fill' | 'mana' | 'cuts' | 'check';
export type StepStatus = 'done' | 'todo' | 'warn';

export interface BuildStep {
  id: StepId;
  title: string;
  status: StepStatus;
  /** One line for the checklist. */
  summary: string;
}

export interface Gap {
  role: string;
  label: string;
  have: number;
  want: [number, number];
}

export interface BuildPlan {
  steps: BuildStep[];
  style: { label: string; note: string } | null;
  gaps: Gap[];
  /** Every role with a guideline, short ones first: what Fill the gaps can look for. */
  targets: Gap[];
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

export function buildPlan(input: {
  commander: ScryfallCard | null;
  cards: Array<{ card: ScryfallCard; quantity: number }>;
  roles: RoleCount[] | null;
  lands: number;
  averageMv: number;
  size: number;
  colors?: BuildPlan['colors'];
  brief: string;
  savedReads: number;
}): BuildPlan {
  const style = commanderStyle(input.commander);
  const roles = input.roles ?? [];
  const gaps: Gap[] = roles.filter((r) => r.target && r.count < r.target[0])
    .map((r) => ({ role: r.id, label: r.label, have: r.count, want: r.target! }));
  const finishers = roles.filter((r) => ['finisher', 'wincon'].includes(r.id)).reduce((n, r) => n + r.count, 0);
  if (input.roles && finishers === 0) gaps.push({ role: 'finisher', label: 'Finishers', have: 0, want: [2, 4] });

  const cheapNames = new Set(roles.filter((r) => ['ramp', 'draw'].includes(r.id)).flatMap((r) => r.cards));
  const cheap = input.cards.filter((c) => cheapNames.has(c.card.name) && (c.card.cmc ?? 0) <= 2).reduce((n, c) => n + c.quantity, 0);
  const want = karstenLands(input.averageMv, cheap);
  const landsOff = input.lands - want;

  const steps: BuildStep[] = [
    { id: 'style', title: 'Commander style', status: style ? 'done' : 'todo', summary: style ? style.label : 'Pick a commander' },
    {
      id: 'plan', title: 'Plan', status: input.brief.trim() ? 'done' : 'todo',
      summary: input.brief.trim() ? `Brief written${input.savedReads ? ` · ${input.savedReads} saved read${input.savedReads === 1 ? '' : 's'}` : ''}` : 'Write how it wins, or draft it',
    },
    {
      id: 'skeleton', title: 'Skeleton', status: !input.roles ? 'todo' : gaps.length ? 'warn' : 'done',
      summary: !input.roles ? 'Reading roles…' : gaps.length ? `${gaps.length} role${gaps.length === 1 ? '' : 's'} below the guideline` : 'Every role at its guideline',
    },
    { id: 'fill', title: 'Fill the gaps', status: gaps.length ? 'warn' : 'done', summary: gaps.length ? gaps.slice(0, 3).map((g) => g.label).join(', ') : 'Nothing short' },
    {
      id: 'mana', title: 'Mana', status: Math.abs(landsOff) <= 1 ? 'done' : 'warn',
      summary: `${input.lands} lands · formula says ${want}`,
    },
    {
      id: 'cuts', title: 'Cuts', status: input.size === 100 ? 'done' : 'warn',
      summary: input.size === 100 ? '100 cards' : input.size > 100 ? `${input.size - 100} over 100` : `${100 - input.size} short of 100`,
    },
    { id: 'check', title: 'Check', status: 'todo', summary: 'Bracket, combos, win read' },
  ];
  const targets = [...gaps, ...roles.filter((r) => r.target && r.count >= r.target[0])
    .map((r) => ({ role: r.id, label: r.label, have: r.count, want: r.target! }))];
  const colors = input.colors ?? [];
  const shortColors = colors.filter((c) => c.needed !== null && c.sources < c.needed - 1);
  const mana = steps.find((x) => x.id === 'mana')!;
  if (shortColors.length) {
    mana.status = 'warn';
    mana.summary += ` · short on ${shortColors.map((c) => c.color).join('')}`;
  }
  return { steps, style, gaps, targets, colors, lands: { have: input.lands, want, averageMv: input.averageMv, cheap }, size: input.size };
}
