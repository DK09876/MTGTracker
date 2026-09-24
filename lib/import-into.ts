/**
 * Importing a pasted decklist into a list, on the server: resolve every
 * line against Scryfall, add what was found, and set the commander if the
 * deck has none and the list names or implies one.
 */

import { addCardToList, setCommander, type List } from './db';
import { resolveDecklist } from './import';
import { collection } from './scryfall';

export interface ImportSummary {
  /** Distinct cards added, and copies counting duplicates. */
  added: number;
  copies: number;
  /** The commander taken from the list, if one was. */
  commander: string | null;
  missing: string[];
  unreadable: string[];
  skipped: number;
}

export async function importInto(list: Pick<List, 'id' | 'kind' | 'commander'>, text: string): Promise<ImportSummary> {
  const resolved = await resolveDecklist(text, collection, { commanderPicked: list.commander?.name ?? null });
  const takeCommander = list.kind === 'deck' && !list.commander && resolved.commander;
  if (takeCommander) setCommander(list.id, resolved.commander);

  for (const { card, quantity } of resolved.cards) addCardToList(list.id, card, quantity);
  // A plain list has no header, so a commander found in the paste stays a card in it.
  if (list.kind !== 'deck' && resolved.commander) addCardToList(list.id, resolved.commander, 1);

  return {
    added: resolved.cards.length,
    copies: resolved.cards.reduce((n, c) => n + c.quantity, 0),
    commander: takeCommander ? resolved.commander!.name : null,
    missing: resolved.missing,
    unreadable: resolved.unreadable,
    skipped: resolved.skipped,
  };
}
