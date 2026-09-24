/**
 * Turning a pasted decklist into cards.
 *
 * Each line is looked up by its exact printing when it names one (set and
 * collector number), then - for anything Scryfall does not know by that
 * printing - by name. What still cannot be found is reported by the line
 * as written, so it can be fixed and pasted again.
 *
 * The commander comes from a "Commander" section if the list has one.
 * Otherwise, when no commander has been picked, the first card is taken
 * as the commander if it could be one: that is where Moxfield and
 * Archidekt exports put it. A commander leaves the 99 and goes in the
 * deck's header.
 */

import { parseDecklist, type Board, type Entry } from './decklist';
import type { Finish, Identifier, ScryfallCard } from './scryfall';

export interface Resolved {
  /** Cards for the deck, with how many of each, which finish and which board. */
  cards: Array<{ card: ScryfallCard; quantity: number; finish: Finish; board: Board }>;
  /** The commander, when the list says or implies one. */
  commander: ScryfallCard | null;
  /** The finish of the commander's line, including a picked commander's. */
  commanderFinish: Finish | null;
  /** Lines that named a card Scryfall could not find. */
  missing: string[];
  /** Lines that could not be read as a card at all. */
  unreadable: string[];
  /** Lines left out: tokens and the like. */
  skipped: number;
}

type Collection = (identifiers: Identifier[]) => Promise<{ cards: ScryfallCard[]; notFound: Identifier[] }>;

const front = (name: string) => name.split(' // ')[0].trim().toLowerCase();
const printingKey = (set: string, number: string) => `${set.toLowerCase()}/${number.toLowerCase()}`;

/**
 * Whether a card can lead a Commander deck: a legendary creature, a
 * legendary Vehicle or Spacecraft with power and toughness (Hearthhull, the
 * Worldseed), or a card that says it can be your commander.
 */
export function canLead(card: ScryfallCard): boolean {
  const face = card.card_faces?.[0];
  const type = card.type_line ?? face?.type_line ?? '';
  const text = card.oracle_text ?? card.card_faces?.map((f) => f.oracle_text).join('\n') ?? '';
  const hasBody = (card.power ?? face?.power) !== undefined && (card.toughness ?? face?.toughness) !== undefined;
  const legal = !card.legalities || card.legalities.commander === 'legal';
  return legal && /Legendary/.test(type) && (/Creature/.test(type) || hasBody || /can be your commander/i.test(text));
}

export async function resolveDecklist(
  text: string, collection: Collection, { commanderPicked }: { commanderPicked: string | null },
): Promise<Resolved> {
  const { entries, unreadable } = parseDecklist(text);
  const wanted = entries.filter((e) => e.section !== 'skip');
  const skipped = entries.length - wanted.length;

  // First pass: exact printings where given, names otherwise.
  const found = new Map<Entry, ScryfallCard>();
  const byPrinting = await lookUp(wanted, collection, true);
  for (const [entry, card] of byPrinting) found.set(entry, card);
  // Second pass: printings Scryfall did not know, by name.
  const retry = wanted.filter((e) => !found.has(e));
  if (retry.length) for (const [entry, card] of await lookUp(retry, collection, false)) found.set(entry, card);

  const missing = wanted.filter((e) => !found.has(e)).map((e) => e.line);
  const resolved = wanted.filter((e) => found.has(e)).map((e) => ({ entry: e, card: found.get(e)! }));

  let commander: ScryfallCard | null = null;
  const named = resolved.find((r) => r.entry.section === 'commander');
  if (named) commander = named.card;
  else if (!commanderPicked && resolved[0]?.entry.section === 'main' && canLead(resolved[0].card)) commander = resolved[0].card;
  let commanderFinish: Finish | null = null;

  // The commander sits in the header, not in the 99 - whether it came from
  // the list or was picked separately and also appears in it.
  const leader = commander ? front(commander.name) : commanderPicked ? front(commanderPicked) : null;
  let leaderRemoved = false;
  const cards: Resolved['cards'] = [];
  for (const { entry, card } of resolved) {
    if (leader && !leaderRemoved && front(card.name) === leader) {
      leaderRemoved = true;
      commanderFinish = entry.finish;
      continue;
    }
    const board: Board = entry.section === 'side' || entry.section === 'maybe' ? entry.section : 'main';
    const existing = cards.find((c) => c.card.id === card.id);
    if (existing) existing.quantity += entry.quantity;
    else cards.push({ card, quantity: entry.quantity, finish: entry.finish, board });
  }
  return { cards, commander, commanderFinish, missing, unreadable, skipped };
}

async function lookUp(entries: Entry[], collection: Collection, printings: boolean): Promise<Map<Entry, ScryfallCard>> {
  const identifiers: Identifier[] = entries.map((e) => (printings && e.set && e.collectorNumber
    ? { set: e.set, collector_number: e.collectorNumber }
    : { name: e.name.split(' // ')[0].trim() }));
  const { cards } = await collection(identifiers);

  const byPrinting = new Map(cards.map((c) => [printingKey(c.set ?? '', c.collector_number ?? ''), c]));
  const byName = new Map(cards.map((c) => [front(c.name), c]));
  const out = new Map<Entry, ScryfallCard>();
  entries.forEach((entry, i) => {
    const id = identifiers[i];
    const card = 'set' in id ? byPrinting.get(printingKey(id.set, id.collector_number)) : byName.get(front(id.name));
    if (card) out.set(entry, card);
  });
  return out;
}
