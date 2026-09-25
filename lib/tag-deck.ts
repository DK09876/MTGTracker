/**
 * A deck as the tagging model reads it: the commander and the cards on the
 * chosen boards, each with a short reference (c1, c2...) and Scryfall's
 * roles where they are already known. Server only - it reads the database.
 */

import { cachedRoles, cardsInList, type List } from './db';
import type { Board } from './decklist';
import { ROLES, ROLES_VERSION } from './roles';
import type { DeckCard } from './tagging';
import { tagKey } from './tags';

export interface TaggingDeck {
  cards: DeckCard[];
  /** Short reference -> the card's tag key (its oracle id). */
  keyOf: Map<string, string>;
  /** The card's tag key -> short reference. */
  refOf: Map<string, string>;
}

const LABEL = new Map(ROLES.map((r) => [r.id, r.label]));

export function taggingDeck(list: List, boards: Board[] = ['main']): TaggingDeck {
  const listed = cardsInList(list.id).filter((c) => boards.includes(c.board));
  const entries = [
    ...(list.commander ? [{ card: list.commander, quantity: 1, commander: true }] : []),
    ...listed.map((c) => ({ card: c.card, quantity: c.quantity, commander: false })),
  ];

  // One entry per card: two printings of a card are one card to tag.
  const merged = new Map<string, (typeof entries)[number]>();
  for (const e of entries) {
    const key = tagKey(e.card);
    const seen = merged.get(key);
    if (seen) seen.quantity += e.quantity;
    else merged.set(key, { ...e });
  }

  const oracleIds = [...merged.values()].map((e) => e.card.oracle_id).filter((id): id is string => !!id);
  // Any age and version will do: these are hints, not counts.
  const { roles } = cachedRoles(oracleIds, '1970-01-01', ROLES_VERSION);

  const keyOf = new Map<string, string>();
  const refOf = new Map<string, string>();
  const cards: DeckCard[] = [];
  let i = 0;
  for (const [key, e] of merged) {
    const ref = `c${++i}`;
    keyOf.set(ref, key);
    refOf.set(key, ref);
    const known = e.card.oracle_id ? roles.get(e.card.oracle_id) : undefined;
    cards.push({
      key: ref,
      card: e.card,
      quantity: e.quantity,
      commander: e.commander,
      roles: known?.map((r) => LABEL.get(r) ?? r),
    });
  }
  return { cards, keyOf, refOf };
}
