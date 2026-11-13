/** The Tags tab's shapes, safe for the browser (the server side is lib/tags-tab.ts). */

import type { Category } from './categories-shared';

/** A tag from the card data offered in step 1. */
export interface TagRow { key: string; slug: string; name: string; cards: string[] }

/** One AI suggestion: a card in or out of a category on the deck, or a new group. */
export interface AiRow {
  key: string;
  /** add or remove a card; a new group; merge a group into another; remove a whole group; a description for a group. */
  kind: 'add' | 'remove' | 'new' | 'merge' | 'drop' | 'describe';
  category: string;
  categoryId: string | null;
  card?: string;
  cards?: string[];
  /** merge: the group it goes into. */
  into?: string;
  intoId?: string;
  /** describe: the description itself. */
  text?: string;
  why: string;
}

/**
 * What a Refine with AI run looks for. Narrow runs ask for one kind of change
 * only, and the server keeps the answer to it.
 */
export type TagsFocus =
  | { kind: 'all' }
  | { kind: 'fix' }
  | { kind: 'one'; category: string }
  | { kind: 'find'; text: string }
  | { kind: 'tidy' }
  | { kind: 'describe' };

export const FOCUS_LABELS: Record<TagsFocus['kind'], string> = {
  all: 'Everything', fix: 'Fix my groups', one: 'One group', find: 'Look for…', tidy: 'Tidy groups', describe: 'Describe groups',
};

/** What each focus asks for, in the owner's words (the ⓘ beside the choice). */
export const FOCUS_TIPS: Record<TagsFocus['kind'], string> = {
  all: 'Cards missing from your groups or wrong for them, then new groups the plan depends on.',
  fix: 'Only cards to add to or take out of the groups already on the deck. No new groups.',
  one: 'Only cards to add to or take out of the one group you pick.',
  find: 'One group for the kind of card you name, for example "wheels" or "sac outlets". If a group like it is already here, cards to add to it instead.',
  tidy: 'Whole groups only: new ones the plan needs, two that overlap merged into one, and ones that add nothing removed. Never your ways to win, key cards or jobs.',
  describe: 'A one-line description for each group that has none, or only a thin one. Nothing about its cards changes.',
};

export function cleanFocus(v: unknown): TagsFocus {
  const f = (v ?? {}) as Record<string, unknown>;
  const text = (x: unknown) => (typeof x === 'string' ? x.trim().slice(0, 120) : '');
  if (f.kind === 'one' && text(f.category)) return { kind: 'one', category: text(f.category) };
  if (f.kind === 'find' && text(f.text)) return { kind: 'find', text: text(f.text) };
  if (f.kind === 'fix' || f.kind === 'tidy' || f.kind === 'describe') return { kind: f.kind };
  return { kind: 'all' };
}

export interface TagsView {
  categories: Category[];
  /**
   * Each job's number as the Cards tab shows it: the weighted count, the
   * usual range, and warn for a hard failure (no card draw at 90+ cards).
   */
  jobNumbers: Record<string, { count: number; range: [number, number] | null; warn: boolean }>;
  cardNames: string[];
  confirmed: boolean;
  hasKey: boolean;
  step1: {
    /** Any of the six jobs not on the deck. skipped: the owner said Skip, so it is offered quietly, not as a suggestion. */
    jobs: { key: 'jobs'; all: boolean; skipped: boolean; missing: Array<{ id: string; label: string }> } | null;
    /** The top tags that stand out, still open. */
    tags: TagRow[];
    /** The rest, behind "Show more". */
    more: TagRow[];
    combos: Array<{ key: string; title: string; result: string; cards: string[] }>;
    comboKeys: Array<{ key: string; name: string; count: number }>;
    /** The jobs row and the top tags still open: what step 1 counts as left to look at. */
    open: number;
    comboCount: number;
  };
  ai: {
    ran: boolean;
    at: string | null;
    notes: string;
    rows: AiRow[];
    job: { id: string; status: string; progress: string | null; error: string | null } | null;
    /** What the last run looked for. */
    focus: TagsFocus;
    /** What a run will cost (lib/ai-estimate.ts). */
    cost: { usd: number; measured: boolean };
  };
}
