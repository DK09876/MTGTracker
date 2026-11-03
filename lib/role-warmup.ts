/**
 * Reads a deck's roles from Scryfall in the background right after it is
 * imported, so the Health tab, quick reads and suggestions have them when
 * someone first opens the deck - the first look at a new deck's cards takes
 * up to a minute. Server only.
 */

import { cachedRoles, cardsInList, saveRoles, type List } from './db';
import { startJob } from './jobs';
import { countRoles } from './roles';
import { searchCards } from './scryfall';

export function warmRoles(list: List, profileId: string): void {
  if (list.kind !== 'deck') return;
  startJob({ kind: 'roles', label: 'Reading card roles', subject: list.name, profileId, listId: list.id, errorLevel: () => 'warn' }, async ({ progress }) => {
    progress('Asking Scryfall which cards ramp, draw, remove…');
    const main = cardsInList(list.id).filter((c) => c.board === 'main');
    await countRoles(main, { search: (q) => searchCards(q), cached: cachedRoles, save: saveRoles });
    return null;
  });
}
