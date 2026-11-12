/**
 * Trim, as both the page and the server read it: the cut flow for a deck over
 * 100 cards. An approach (a few lines on what to trim and protect), then a
 * ranked list from Claude - its first N are the cuts, the rest are closer
 * calls - then the owner's choices, each with an optional reason, and apply.
 * Pure.
 */

import type { ImpactRow } from './tune-shared';

/**
 * Who ranks the cuts: Claude Opus, always. Haiku was an option and is gone:
 * a confirmed plan, with or without card-data tags, did not improve its cuts
 * (15.2% and 15.5% of owners' real cuts against 15.4% alone; FINDINGS,
 * Session 3), so the deck pages run on Opus only.
 */
export type TrimModel = 'opus';
export const TRIM_MODELS: Record<TrimModel, { id: string; label: string; note: string }> = {
  opus: { id: 'claude-opus-5-5', label: 'Claude Opus', note: 'best ranking' },
};

/** What a call is expected to cost before any have been made (the flow plan's token estimates), shown as estimates. */
export const TRIM_COST_GUESS: Record<TrimModel | 'approach', number> = { opus: 0.12, approach: 0.02 };

/** Why the owner keeps a suggested cut, or cuts a card: one tap. */
export const KEEP_CHIPS = ['pet_card', 'part_of_plan', 'already_tried'] as const;
export const CUT_CHIPS = ['too_slow', 'off_plan', 'have_better'] as const;
export type TrimChip = (typeof KEEP_CHIPS)[number] | (typeof CUT_CHIPS)[number];
export const TRIM_CHIP_LABELS: Record<TrimChip, string> = {
  pet_card: 'Pet card', part_of_plan: 'Part of my plan', already_tried: 'Tried cutting it',
  too_slow: 'Too slow', off_plan: 'Off-plan', have_better: 'Have better',
};
export const isTrimChip = (v: unknown): v is TrimChip => typeof v === 'string' && v in TRIM_CHIP_LABELS;

/** The owner's call on one card: cut it or keep it, and why if they said. */
export interface TrimChoice {
  choice: 'cut' | 'keep';
  chip?: TrimChip | null;
  text?: string;
}

/** Where a card stands in the list: one of Claude's N cuts, a closer call, a card it left in on purpose, or one the owner kept on the list before. */
export type TrimTier = 'cut' | 'maybe' | 'kept' | 'yours';

export interface TrimItem {
  /** The suggestion's key in the suggestion log. */
  key: string;
  name: string;
  tier: TrimTier;
  why: string;
  /** Cards it works with, when Claude named some. */
  with: string[];
  /** From the plan read: "Engine", "Key card", "In a way to win: Pingers". Shown, never a block. */
  flag: string | null;
  /** What cutting it would break, said plainly: shown once it is chosen. */
  warn: string | null;
  card: { id: string; image: string | null; manaCost: string; typeLine: string; text: string; land: boolean };
}

export interface TrimApproach {
  text: string;
  by: 'claude' | 'code' | 'owner';
  at: string;
}

export interface TrimJob { kind: 'approach' | 'cuts'; status: 'running' | 'failed'; detail: string | null; error: string | null }

/** What an apply did, kept so the done screen survives a reload and can be undone. */
export interface TrimDone { at: string; cut: number; size: number; to: string; undo: unknown; logged: { accepted: number; refused: number; left: number; reasons: number } }

export interface TrimView {
  /** Cards in the deck, the commander included, and how many over 100. */
  size: number;
  over: number;
  /** The plan read later steps use: current, out of date, or none. */
  plan: { state: 'current' | 'stale' | 'none'; text: string | null; at: string | null; confirmed: boolean };
  approach: TrimApproach | null;
  /** A line the owner added to correct the approach. */
  correction: string;
  model: TrimModel;
  costs: Record<TrimModel | 'approach', { usd: number; measured: boolean }>;
  /** The latest list, or null before the first. */
  run: {
    id: string; at: string; model: string; round: number; notes: string;
    items: TrimItem[];
    /** The deck changed since the list was made: its cards may be gone. */
    stale: boolean;
  } | null;
  choices: Record<string, TrimChoice>;
  /** The numbers now and with the chosen cuts, from code. */
  impact: { rows: ImpactRow[]; size: { before: number; after: number } };
  lands: { have: number; floor: number; range: [number, number] };
  /** What Claude is sent for the cut list, in words. */
  reads: string[];
  cutsTo: { id: string; name: string };
  job: TrimJob | null;
  done: TrimDone | null;
  /** No Claude key on the server: the approach can still be drafted or written, the list can't be made. */
  noKey: boolean;
}

/** The cards chosen to cut: Claude's cuts unless kept, and anything else the owner marked cut. */
export function chosenCuts(items: TrimItem[], choices: Record<string, TrimChoice>): string[] {
  return items.filter((i) => (choices[i.name]?.choice ?? (i.tier === 'cut' ? 'cut' : 'keep')) === 'cut').map((i) => i.name);
}

/** A choice or a reason that says something: an explicit call against the default, or any reason. */
export function saidSomething(item: TrimItem, c: TrimChoice | undefined): boolean {
  if (!c) return false;
  const def = item.tier === 'cut' ? 'cut' : 'keep';
  return c.choice !== def || !!c.chip || !!c.text?.trim();
}
