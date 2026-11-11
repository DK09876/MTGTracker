/**
 * The plan read's shared words and shapes, safe for the browser (the read
 * itself, lib/plan-pass.ts, is server only).
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
  { id: 'unsure', label: 'Unsure', tip: 'Not sure yet? Pick this and the plan will suggest an answer once you have confirmed it and the deck has 50 or more non-land cards. You can accept it or pick yourself.' },
] as const;
export type CommanderRole = (typeof COMMANDER_ROLES)[number]['id'];
export const isCommanderRole = (x: unknown): x is CommanderRole => COMMANDER_ROLES.some((r) => r.id === x);

/** The commander suggestion shows only at this many non-land cards (and only for Unsure, after confirming). */
export const SUGGEST_COMMANDER_AT = 50;

/** One role per non-land card. */
export const CARD_ROLES = [
  { id: 'win', label: 'Win', tip: 'Ends the game, or is part of a game-winning combo.' },
  { id: 'engine', label: 'Engine', tip: 'Repeatable advantage that is central to the plan.' },
  { id: 'payoff', label: 'Payoff', tip: 'Rewards the deck for doing its thing.' },
  { id: 'enabler', label: 'Enabler', tip: 'Makes the plan work: fuel, setup, the pieces payoffs need.' },
  { id: 'support', label: 'Support', tip: 'A job every deck needs (ramp, draw, removal, protection), not specific to this plan.' },
  { id: 'filler', label: 'Filler', tip: 'Neither on plan nor doing a needed job well here.' },
] as const;
export type CardRole = (typeof CARD_ROLES)[number]['id'];
export const isCardRole = (x: unknown): x is CardRole => CARD_ROLES.some((r) => r.id === x);

export type DeckState = 'focused' | 'unfocused' | 'no_plan';

export interface Route { name: string; cards: string[] }
export interface Theme { name: string; cards: string[] }

/** What a read says about a deck. */
export interface PassOutput {
  state: DeckState;
  plan: string;
  winRoutes: Route[];
  keyCards: string[];
  themes: Theme[];
  /** One per non-land card, by name. */
  cards: Record<string, { role: CardRole; note: string }>;
  /** Up to three, written for this deck; none when the plan is clear. */
  questions: string[];
  summary: string;
  /** Always made; shown only when the owner picked Unsure (see SUGGEST_COMMANDER_AT). */
  commander: { roles: CommanderRole[]; why: string };
}

/** The owner's edits: each part given is theirs, kept exactly on every later read. */
export interface OwnerEdits {
  plan?: string;
  winRoutes?: Route[];
  keyCards?: string[];
  themes?: Theme[];
  /** Card roles the owner corrected, by card name. */
  roles?: Record<string, CardRole>;
}

/**
 * When a read is out of date: this many cards changed since (added plus
 * removed, counting copies; about five swaps), or the commander changed, or a
 * key card left the deck. The owner's call, 2026-11-10.
 */
export const STALE_CARDS = 10;

/** What a read is expected to cost before any have been made: the flow plan's token estimate for Opus on a 100-card deck (about 8k in, 4-5k out), shown as an estimate. */
export const READ_COST_GUESS = 0.2;

/** The Plan tab's view of the read. */
export interface PlanView {
  commanderRoles: CommanderRole[];
  nonland: number;
  /** Cards in the deck, the commander included (a Commander deck is 100). */
  size: number;
  /** What plan reads have cost lately (the AI usage trail), or null when there's nothing to go by. */
  cost: { usd: number; reads: number } | null;
  /** Answers and a note typed but not yet sent, for the latest read. */
  drafts: { answers: Record<string, string>; skipped: string[]; note: string } | null;
  /** The read running now, if any. */
  job: { id: string; status: string; progress?: string | null; error?: string | null } | null;
  /** The last read that finished, and the plan as shown: its answer with the owner's edits on top. */
  pass: {
    id: string; at: string; model: string; state: DeckState;
    plan: string; winRoutes: Route[]; keyCards: string[]; themes: Theme[];
    cards: Record<string, { role: CardRole; note: string; yours: boolean }>;
    summary: string;
    /** The parts the owner set, and their items not in the read's own answer ("yours"). */
    yours: { plan: boolean; routes: string[]; routeCards: string[]; keyCards: string[]; themes: string[] };
    /** Shown until answered, skipped or confirmed. */
    questions: string[];
    /** Combos one card away, from the combo list (not the AI): route cards that complete one. */
    oneAway: Array<{ cards: string[]; missing: string }>;
    /** Shown when the owner picked Unsure, the plan is confirmed and the deck is big enough. */
    commander: { roles: CommanderRole[]; why: string } | null;
    /** The plan was written by the owner, not read. */
    ownPlan: boolean;
    /** What the owner said the commander does when this was read, to flag a change since. */
    commanderRolesRead: CommanderRole[];
  } | null;
  edits: number;
  confirmed: { at: string } | null;
  stale: { changed: number; commander: boolean; keyCardsGone: string[]; usingAnyway: boolean } | null;
  /** What the next read will read, for the Plan tab's list. */
  reads: { notes: number; commanderRoles: number };
}
