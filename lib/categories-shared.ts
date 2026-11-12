/**
 * A deck's categories, shared by the server and the browser: one store for
 * the jobs it tracks (ramp, card draw...), tags from the card data, its ways
 * to win, its key cards and the owner's own groups. The Plan tab and the
 * Tags tab read and write the same records (lib/categories.ts).
 *
 * Nothing is on a deck until the owner accepts it or makes it. Every
 * category and every card in it says who added it: the owner, the card data
 * (no AI), or AI (accepted by the owner).
 */

import type { JobId } from './deck-numbers';

export type CategoryKind = 'job' | 'tag' | 'win' | 'key' | 'own';
export type AddedBy = 'owner' | 'cards' | 'ai';

/** The six jobs most decks track, offered together on the Tags tab. Each is counted and checked against its range once accepted. */
export const SIX_JOBS: Array<{ id: Exclude<JobId, 'impulse'>; label: string; how: string }> = [
  { id: 'ramp', label: 'Ramp', how: 'Counts cards that make extra mana. A card that makes Treasure only once is left out, and ramp that costs as much as the flip turn counts half.' },
  { id: 'draw', label: 'Card draw', how: 'Counts cards that leave you with more cards. Cantrips, looting and tutors are not card draw.' },
  { id: 'interaction', label: 'Interaction', how: 'Counts targeted removal, counterspells and board wipes together. Removal you can use again counts twice.' },
  { id: 'wipe', label: 'Board wipes', how: 'Counts spells and abilities that clear the board.' },
  { id: 'protection', label: 'Protection', how: 'Counts cards that protect your board or the commander, fogs, and spells that change a target.' },
  { id: 'finishers', label: 'Ways to finish', how: 'Counts cards that win outright or close a game: alternate wins, extra turns, extra combats, overruns and drain.' },
];
export const SIX_JOB_IDS = SIX_JOBS.map((j) => j.id);
export const jobLabel = (id: string) => SIX_JOBS.find((j) => j.id === id)?.label ?? id;

export interface CategoryCard {
  /** The card's oracle id. */
  key: string;
  name: string;
  /** Who put it in: the card data for a live tag or a job, the owner, or AI. */
  by: AddedBy;
}

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  by: AddedBy;
  /** For a job: which one. */
  jobId: JobId | null;
  /** For a tag from the card data: the tag(s) it is made of (several after a merge). */
  slugs: string[];
  /** One line on how it is counted (jobs), how it wins (ways to win), or what it is. */
  how: string;
  /** Names of what was merged into it. */
  madeOf: string[];
  cards: CategoryCard[];
  /** Cards the owner took out of a live tag or job, so it does not put them back. */
  out: CategoryCard[];
  /** Named cards no longer in the deck (ways to win and key cards): "Look again". */
  gone: string[];
}

/** The card data's tag names, tidied only: dashes to spaces, first letter capital. Never renamed. */
export const tidyTag = (slug: string): string => { const w = slug.split('-').join(' '); return w.charAt(0).toUpperCase() + w.slice(1); };

/** A key for a generated item the owner removed or skipped, stable across runs. */
export const identity = (kind: CategoryKind, name: string, jobId?: string | null, slugs?: string[]) =>
  kind === 'job' ? `job:${jobId}` : kind === 'tag' && slugs?.length ? `tag:${slugs[0]}` : `${kind}:${name.trim().toLowerCase()}`;
