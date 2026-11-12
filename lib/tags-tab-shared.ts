/** The Tags tab's shapes, safe for the browser (the server side is lib/tags-tab.ts). */

import type { Category } from './categories-shared';

/** A tag from the card data offered in step 1. */
export interface TagRow { key: string; slug: string; name: string; cards: string[] }

/** One AI suggestion: a card in or out of a category on the deck, or a new group. */
export interface AiRow {
  key: string;
  kind: 'add' | 'remove' | 'new';
  category: string;
  categoryId: string | null;
  card?: string;
  cards?: string[];
  why: string;
}

export interface TagsView {
  categories: Category[];
  cardNames: string[];
  confirmed: boolean;
  hasKey: boolean;
  step1: {
    /** The six jobs most decks track, or the ones not on the deck. */
    jobs: { key: 'jobs'; all: boolean; missing: Array<{ id: string; label: string }> } | null;
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
  };
}
