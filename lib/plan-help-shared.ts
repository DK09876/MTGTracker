/**
 * The Plan tab's words and shapes, safe for the browser (the server side is
 * lib/plan-help.ts). The Plan tab is what the owner wants the deck to be:
 * they set what they know, leave the rest on Not sure, and can ask AI to
 * suggest what is missing. Nothing AI returns is part of the plan until the
 * owner accepts it.
 */

import type { Category } from './categories-shared';
import type { CommanderRole, DeckState } from './plan-shared';

export { COMMANDER_ROLES, type CommanderRole, type DeckState } from './plan-shared';

/** Commander role tips as the Plan tab shows them (Not sure says what it leaves open). */
export const NOT_SURE_TIP = 'Leave this on Not sure and AI can suggest one in step 4, for you to accept or skip.';

export const BRACKET_CHIPS: Array<[number | null, string]> = [[null, 'Not sure'], [1, '1 Exhibition'], [2, '2 Core'], [3, '3 Upgraded'], [4, '4 Optimized'], [5, '5 cEDH']];

/** At most this many key cards are suggested, however many the owner listed. */
export const MAX_KEY_SUGGESTIONS = 5;
export const MAX_QUESTIONS = 3;

export interface HelpAnswer {
  state: DeckState;
  fill: { commander?: { roles: CommanderRole[]; why: string }; bracket?: { level: number; why: string }; plan?: string };
  fuller?: string;
  winRoutes: Array<{ name: string; how: string; cards: string[] }>;
  keyCards: string[];
  /** Why each suggested key card, by name (plan-help-3 on). */
  keyWhy?: Record<string, string>;
  questions: Array<{ text: string; about: boolean }>;
  directions: Array<{ name: string; plan: string; cards: string[] }>;
  summary: string;
}

export type Who = 'owner' | 'ai';

export interface PlanQuestion { id: string; text: string; about: boolean; answer: string; skipped: boolean }

/** What the Plan tab shows. */
export interface PlanState {
  commanderNames: string;
  commander: { roles: CommanderRole[]; by: Who };
  bracket: { value: number | null; by: Who };
  goal: { chips: string[]; text: string };
  goals: string[];
  /** The commander(s), always protected, then the cards the owner marked. */
  neverCut: { commanders: string[]; cards: Array<{ key: string; name: string }> };
  notes: Array<{ id: string; text: string }>;
  plan: { text: string; by: Who; direction: string | null };
  wins: Category[];
  key: Category | null;
  /** The deck's card names, for pickers. */
  cardNames: string[];
  /** The last AI run's suggestions that are still open, beside the fields they are for. */
  help: {
    id: string; at: string; state: DeckState; summary: string;
    directions: Array<{ name: string; plan: string; cards: string[] }>;
    commander: { roles: CommanderRole[]; why: string } | null;
    bracket: { level: number; why: string } | null;
    plan: string | null;
    fuller: string | null;
    wins: Array<{ name: string; how: string; cards: string[] }>;
    keys: Array<{ key: string; name: string; why: string }>;
    questions: PlanQuestion[];
    /** Suggestions skipped from this run: shown folded, each can be brought back (the `skip` action with on: false). */
    skipped: Array<{ what: string; label: string; text: string }>;
  } | null;
  /** Suggestions and questions still waiting, which block confirming. */
  open: { suggestions: number; questions: number };
  /** What "Accept all" would take: never the fuller version, never answers. */
  bulk: number;
  confirmed: { at: string } | null;
  /** The commander changed since confirming: "Look again". */
  commanderChanged: boolean;
  job: { id: string; status: string; progress: string | null; error: string | null } | null;
  hasKey: boolean;
  /** What a run has cost lately, or null when nothing to go by. */
  cost: { usd: number; measured: boolean };
  /** How many categories the deck has, for the line under the tabs. */
  categoryCount: number;
  /** The jobs counted on this deck, for Tune's summary before confirming. */
  jobs: string[];
  /** Whether any generated tag has been accepted (Tune's nudge to the Tags tab). */
  generatedAccepted: boolean;
}

export type PlanAction =
  | { action: 'commander'; roles: string[] }
  | { action: 'acceptCommander' } | { action: 'skip'; what: string; on?: boolean }
  | { action: 'goal'; chips: string[]; text: string }
  | { action: 'bracket'; value: number | null }
  | { action: 'acceptBracket' }
  | { action: 'neverCut'; add?: string; remove?: string }
  | { action: 'note'; add?: string; remove?: string; edit?: { id: string; text: string } }
  | { action: 'planText'; text: string }
  | { action: 'acceptPlan' } | { action: 'acceptFuller' }
  | { action: 'direction'; name: string }
  | { action: 'addWin'; name: string }
  | { action: 'acceptWin'; name: string } | { action: 'acceptAllWins' }
  | { action: 'acceptKey'; name: string } | { action: 'acceptAllKeys' }
  | { action: 'addKey'; name: string }
  | { action: 'acceptAll' } | { action: 'skipAll' }
  | { action: 'answer'; id: string; text?: string; skip?: boolean }
  | { action: 'run' }
  | { action: 'answerToNotes'; id: string; text: string }
  | { action: 'confirm' };
