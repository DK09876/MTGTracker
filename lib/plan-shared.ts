/**
 * What the commander does for a deck, safe for the browser: the Plan tab's
 * first step (lib/plan-help.ts).
 */

/** What the commander does for the deck: the owner picks any, or Unsure. */
export const COMMANDER_ROLES = [
  { id: 'voltron', label: 'Voltron', tip: 'The commander is the main threat: you suit it up and win with commander damage. Protection for it matters more than usual.' },
  { id: 'draw-engine', label: 'Card draw engine', tip: 'The commander keeps your hand full on its own. The 99 can run less draw while it is out, but needs a backup when it is removed.' },
  { id: 'counter-weight', label: 'Counter weight', tip: 'The commander covers what the deck is weak at (removal, ramp, a missing colour’s job), so the 99 can lean the other way.' },
  { id: 'enabler', label: 'Enabler', tip: 'The commander makes the plan possible: it lets the deck do something it otherwise couldn’t (cast from the graveyard, play extra lands).' },
  { id: 'multiplier', label: 'Multiplier / intensifier', tip: 'The commander doubles what the deck already does: copies spells, doubles triggers or tokens. The deck works without it, just smaller.' },
  { id: 'lynchpin', label: 'Lynchpin', tip: 'The deck falls apart without it. Cards are chosen around it, so recasting and protecting it come first.' },
  { id: 'color-identity', label: 'Color identity', tip: 'Chosen mostly for its colours; its own ability matters little. The 99 carries the plan.' },
  { id: 'unsure', label: 'Unsure', tip: 'Leave this on Not sure and AI can suggest one in step 4, for you to accept or skip.' },
] as const;
export type CommanderRole = (typeof COMMANDER_ROLES)[number]['id'];
export const isCommanderRole = (x: unknown): x is CommanderRole => COMMANDER_ROLES.some((r) => r.id === x);

export type DeckState = 'focused' | 'unfocused' | 'no_plan';
