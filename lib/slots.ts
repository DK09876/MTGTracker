/**
 * After an import: take the second commander and the companion when the
 * list makes them clear, and keep a question for the owner when it does
 * not (commanders.ts). Server only.
 */

import { detectSlots } from './commanders';
import { cardsInList, database, setSlot, setSlotQuestions } from './db';
import type { ScryfallCard } from './scryfall';

/** `named`: card ids the list itself put under Commander or Companion. */
export function settleSlots(listId: string, named: Map<string, 'commander' | 'companion'> = new Map()): void {
  const d = database();
  const row = d.get(`SELECT c.data FROM lists l JOIN cards c ON c.id = l.commanderId WHERE l.id = ? AND l.kind = 'deck'`, [listId]) as { data: string } | null;
  const commander = row ? (JSON.parse(row.data) as ScryfallCard) : null;
  if (!commander) { setSlotQuestions(listId, []); return; }
  const cards = cardsInList(listId).map((c) => ({ card: c.card, board: c.board, slot: c.slot ?? null, explicit: named.get(c.card.id) }));
  const { partner, companion, ask } = detectSlots({ commander, cards });
  if (partner) setSlot(listId, partner, 'partner');
  if (companion) setSlot(listId, companion, 'companion');
  setSlotQuestions(listId, ask);
}
