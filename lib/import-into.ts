/**
 * Importing a pasted decklist into a list, on the server: resolve every
 * line - from the Pi's copy of Scryfall's cards, so it is instant - add what
 * was found, and set the commander if the deck has none and the list names
 * or implies one. Printings the copy does not hold are fetched from Scryfall
 * afterwards, in the background, and swapped in.
 */

import { localCards } from './card-store';
import { addCardToList, database, replaceListCards, setCommander, updateListCard, type List } from './db';
import { resolveDecklist, type Resolved } from './import';
import { startJob } from './jobs';
import { collection } from './scryfall';

const key = (set: string, number: string) => `${set.toLowerCase()}/${number.toLowerCase()}`;

/** Swap the copy's printings for the ones the decklist named, in the background. */
function fixPrintings(listId: string, profileId: string | null, later: Resolved['later']): void {
  if (!later.length) return;
  startJob({ kind: 'printings', label: 'Matching the printings in the list', subject: `${later.length} card${later.length === 1 ? '' : 's'}`, profileId, listId, errorLevel: () => 'warn' },
    async ({ progress }) => {
      progress('Asking Scryfall for the exact printings');
      const { cards } = await collection(later.map((l) => ({ set: l.set, collector_number: l.collectorNumber })));
      const byKey = new Map(cards.map((c) => [key(c.set ?? '', c.collector_number ?? ''), c]));
      let swapped = 0;
      for (const l of later) {
        const printing = byKey.get(key(l.set, l.collectorNumber));
        if (printing && updateListCard(listId, l.cardId, { printing })) swapped += 1;
      }
      return { swapped, of: later.length };
    });
}

export interface ImportSummary {
  /** Distinct cards added, and copies counting duplicates. */
  added: number;
  copies: number;
  /** The commander taken from the list, if one was. */
  commander: string | null;
  /** A commander the list named that lost to the deck's own, and so went into the deck. */
  outvoted?: string | null;
  missing: string[];
  unreadable: string[];
  skipped: number;
}

export async function importInto(list: Pick<List, 'id' | 'kind' | 'commander'>, text: string, profileId: string | null = null): Promise<ImportSummary> {
  const resolved = await resolveDecklist(text, collection, {
    commanderPicked: list.commander?.name ?? null,
    keepPicked: true,
    local: { byName: localCards, printingsLater: true },
  });
  const takeCommander = list.kind === 'deck' && !list.commander && resolved.commander;
  if (takeCommander) setCommander(list.id, resolved.commander, resolved.commanderFinish ?? 'nonfoil');
  // A commander picked separately still takes "*F*" from its own line in the paste.
  else if (list.kind === 'deck' && list.commander && resolved.commanderFinish) {
    setCommander(list.id, list.commander, resolved.commanderFinish);
  }

  // One transaction for the lot: a hundred separate writes take seconds.
  const db = database();
  db.run('BEGIN');
  try {
    for (const { card, quantity, finish, board } of resolved.cards) addCardToList(list.id, card, quantity, finish, board);
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
  // A plain list has no header, so a commander found in the paste stays a card in it.
  if (list.kind !== 'deck' && resolved.commander) {
    addCardToList(list.id, resolved.commander, 1, resolved.commanderFinish ?? 'nonfoil');
  }
  fixPrintings(list.id, profileId, resolved.later);

  return {
    added: resolved.cards.length,
    copies: resolved.cards.reduce((n, c) => n + c.quantity, 0),
    commander: takeCommander ? resolved.commander!.name : null,
    outvoted: resolved.outvoted,
    missing: resolved.missing,
    unreadable: resolved.unreadable,
    skipped: resolved.skipped,
  };
}

/**
 * Replace a list's cards with a pasted decklist - "Edit as text", saved.
 *
 * Nothing is written if any line cannot be found or read: replacing means
 * everything not in the paste is removed, so a typo would otherwise
 * silently delete a card. The answer lists those lines to fix instead.
 *
 * A "Commander" section sets the commander; without one the deck keeps the
 * commander it has.
 */
export async function replaceWith(
  list: Pick<List, 'id' | 'kind' | 'commander' | 'commanderFinish'>, text: string,
): Promise<ImportSummary & { applied: boolean }> {
  // Replacing keeps exact printings: a line naming one the copy lacks waits for Scryfall.
  const resolved = await resolveDecklist(text, collection, {
    commanderPicked: list.commander?.name ?? null,
    local: { byName: localCards, printingsLater: false },
  });
  const summary = {
    added: resolved.cards.length,
    copies: resolved.cards.reduce((n, c) => n + c.quantity, 0),
    commander: null as string | null,
    missing: resolved.missing,
    unreadable: resolved.unreadable,
    skipped: resolved.skipped,
  };
  if (resolved.missing.length || resolved.unreadable.length) return { ...summary, applied: false };

  const cards = [...resolved.cards];
  const finish = resolved.commanderFinish ?? list.commanderFinish ?? 'nonfoil';
  if (resolved.commander && list.kind === 'deck') {
    if (resolved.commander.id !== list.commander?.id) summary.commander = resolved.commander.name;
    setCommander(list.id, resolved.commander, finish);
  } else if (resolved.commander) {
    cards.push({ card: resolved.commander, quantity: 1, finish, board: 'main' });
  } else if (list.commander && resolved.commanderFinish) {
    // The commander's own line, with a new finish or printing marker.
    setCommander(list.id, list.commander, resolved.commanderFinish);
  }
  replaceListCards(list.id, cards);
  return { ...summary, applied: true };
}
