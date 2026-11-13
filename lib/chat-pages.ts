/**
 * Chat as the catch-all (handoff 9, Part C): it does a change when the owner
 * has made the decision, and sends them to a page when the page's job is to
 * help make it. Shared by the server (the cap, the button it stores) and the
 * Chat tab (the button). Pure.
 */

export type ChatPage = 'trim' | 'finish' | 'tags' | 'check' | 'plan';
export const CHAT_PAGES: ChatPage[] = ['trim', 'finish', 'tags', 'check', 'plan'];

/** A button under an answer that opens a page of this deck, with a starting value where the page takes one. */
export interface ChatGo {
  page: ChatPage;
  why: string;
  /** Trim: cut this many. */
  cut?: number;
  /** Trim: cut down to this size. */
  cutTo?: number;
  /** Finish: add this many. */
  add?: number;
}

export const PAGE_LABEL: Record<ChatPage, string> = { trim: 'Trim', finish: 'Finish', tags: 'Tags', check: 'Check', plan: 'Plan' };

/** Pages inside Tune, which stays locked until the plan is confirmed. */
export const LOCKED_UNTIL_PLAN: ChatPage[] = ['trim', 'finish'];

/**
 * Changes of one kind proposed in Chat in one answer; past this the first ones stay and the page that does the
 * full job gets a button. A guess (handoff 9): 5.
 */
export const CHAT_CHANGE_LIMIT = 5;

/** The page that does many changes of a kind at once. */
export const PAGE_FOR: Partial<Record<'add' | 'cut' | 'group' | 'ungroup', ChatPage>> = { cut: 'trim', add: 'finish', group: 'tags', ungroup: 'tags' };

const whole = (x: unknown, max: number) => (typeof x === 'number' && Number.isFinite(x) && x >= 1 ? Math.min(max, Math.round(x)) : undefined);

/** open_page's input, checked: null when the page isn't one of ours. */
export function pageGo(input: Record<string, unknown>): ChatGo | null {
  const page = String(input.page ?? '').toLowerCase().trim() as ChatPage;
  if (!CHAT_PAGES.includes(page)) return null;
  const why = typeof input.why === 'string' ? input.why.trim().slice(0, 300) : '';
  const cut = page === 'trim' ? whole(input.cut, 200) : undefined;
  const cutTo = page === 'trim' && cut === undefined ? whole(input.cut_to, 500) : undefined;
  const add = page === 'finish' ? whole(input.add, 200) : undefined;
  return { page, why, ...(cut ? { cut } : {}), ...(cutTo ? { cutTo } : {}), ...(add ? { add } : {}) };
}

/**
 * Finish's number from Chat's: an add that brings the deck to exactly 100 is Finish's fill to 100 (null), where
 * the app picks the lands; Chat says "add 99" for a commander-only deck, and 99 picks would add no lands. Any
 * other number is that many cards (97 cards and "add 5" is 5, to 102).
 */
export const finishWant = (add: number | undefined, size: number | null): number | null | undefined =>
  (add === undefined ? undefined : size !== null && size + add === 100 ? null : add);

/** What the button says: where it goes, with its number. `size`: the deck's cards with the commander, when known. */
export function goLabel(go: ChatGo, planConfirmed: boolean, size: number | null = null): string {
  if (!planConfirmed && LOCKED_UNTIL_PLAN.includes(go.page)) return `Confirm the plan first · Open Plan`;
  const fill = go.page === 'finish' && finishWant(go.add, size) === null;
  const n = go.page === 'trim' ? (go.cut ? ` · cut ${go.cut}` : go.cutTo ? ` · cut to ${go.cutTo}` : '') : fill ? ' · fill to 100' : go.page === 'finish' && go.add ? ` · add ${go.add}` : '';
  return `Open ${PAGE_LABEL[go.page]}${n}`;
}
