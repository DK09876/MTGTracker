/**
 * A deck's sections, as both the page and the server read them. Main is the
 * deck; every deck also has a Maybeboard and a Sideboard, and the owner can
 * add more - a wishlist, cards to buy, proxies. Each section's purpose says
 * what tuning does with it: cards that might go in are offered as swaps,
 * cuts are filed in the one where cards came out, and a plain list is left
 * alone. The names are the owner's; the purpose is only how the app treats
 * the section. Pure.
 */

import type { Board } from './decklist';

export type Purpose = 'in' | 'out' | 'list';

export interface DeckSection {
  id: Exclude<Board, 'main'>;
  name: string;
  purpose: Purpose;
  /** The Maybeboard and Sideboard: renamed or re-purposed, never deleted, since imports and exports use them. */
  builtIn: boolean;
}

export const PURPOSES: Record<Purpose, { label: string; why: string }> = {
  in: { label: 'Might go in', why: 'Cards you are thinking of adding. Tuning offers them as swaps.' },
  out: { label: 'Came out', why: 'Cards you took out. Cuts are filed here, so you can bring them back.' },
  list: { label: 'Just a list', why: 'Tuning leaves it alone: a wishlist, cards to buy, proxies.' },
};

export const DEFAULT_SECTIONS: DeckSection[] = [
  { id: 'maybe', name: 'Maybeboard', purpose: 'in', builtIn: true },
  { id: 'side', name: 'Sideboard', purpose: 'out', builtIn: true },
];

export const isPurpose = (v: unknown): v is Purpose => v === 'in' || v === 'out' || v === 'list';

/** Where a cut goes: the first section for cards that came out, else the Sideboard. */
export function cutBoard(sections: DeckSection[]): Exclude<Board, 'main'> {
  return sections.find((s) => s.purpose === 'out')?.id ?? 'side';
}

/** A board's name as the page shows it. */
export function boardName(sections: DeckSection[], board: Board): string {
  return board === 'main' ? 'Main' : sections.find((s) => s.id === board)?.name ?? (board === 'maybe' ? 'Maybeboard' : board === 'side' ? 'Sideboard' : 'Section');
}
