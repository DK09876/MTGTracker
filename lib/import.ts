/**
 * Turning a pasted decklist into cards.
 *
 * Each line is looked up first in the copy of Scryfall's cards kept on the
 * Pi, by name - instant. A line naming a printing (set and collector number)
 * the copy does not hold either waits for Scryfall, or, when the caller
 * says so, takes the copy's printing now and is listed in `later` to be
 * swapped for the exact one in the background. Lines the copy does not know
 * go to Scryfall by printing, then by name. What still cannot be found is
 * reported by the line as written, so it can be fixed and pasted again.
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
  cards: Array<{ card: ScryfallCard; quantity: number; finish: Finish; board: Board; named?: 'commander' | 'companion'; tags?: string[] }>;
  /** Tags the list gave the commander's own line. */
  commanderTags?: string[];
  /** The commander, when the list says or implies one. */
  commander: ScryfallCard | null;
  /** The finish of the commander's line, including a picked commander's. */
  commanderFinish: Finish | null;
  /** A commander the list named that lost to the picked one, and so sits in the deck. */
  outvoted: string | null;
  /** Lines that named a card Scryfall could not find. */
  missing: string[];
  /** Lines that could not be read as a card at all. */
  unreadable: string[];
  /** Lines left out: tokens and the like. */
  skipped: number;
  /** Cards taken from the local copy for now, and the exact printing each line named. */
  later: Array<{ cardId: string; set: string; collectorNumber: string }>;
}

/** The Pi's copy of Scryfall's cards, and whether a named printing may wait. */
export interface Local {
  byName: (names: string[]) => ScryfallCard[];
  /** Take the copy's printing now and fix it later, rather than wait for Scryfall. */
  printingsLater: boolean;
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
  text: string, collection: Collection, { commanderPicked, keepPicked = false, local }: {
    commanderPicked: string | null;
    /** The picked commander stays even when the list names another; that one joins the deck. */
    keepPicked?: boolean;
    local?: Local;
  },
): Promise<Resolved> {
  const { entries, unreadable } = parseDecklist(text);
  const wanted = entries.filter((e) => e.section !== 'skip');
  const skipped = entries.length - wanted.length;

  const found = new Map<Entry, ScryfallCard>();
  const later: Resolved['later'] = [];
  if (local) {
    const byName = new Map(local.byName(wanted.map((e) => e.name)).map((c) => [front(c.name), c]));
    for (const e of wanted) {
      const card = byName.get(front(e.name));
      if (!card) continue;
      const named = e.set && e.collectorNumber ? printingKey(e.set, e.collectorNumber) : null;
      if (!named || named === printingKey(card.set ?? '', card.collector_number ?? '')) found.set(e, card);
      else if (local.printingsLater) {
        found.set(e, card);
        if (!later.some((l) => l.cardId === card.id)) later.push({ cardId: card.id, set: e.set!, collectorNumber: e.collectorNumber! });
      }
    }
  }
  const ask = wanted.filter((e) => !found.has(e));
  // First pass: exact printings where given, names otherwise.
  if (ask.length) for (const [entry, card] of await lookUp(ask, collection, true)) found.set(entry, card);
  // Second pass: printings Scryfall did not know, by name.
  const retry = wanted.filter((e) => !found.has(e));
  if (retry.length) for (const [entry, card] of await lookUp(retry, collection, false)) found.set(entry, card);

  const missing = wanted.filter((e) => !found.has(e)).map((e) => e.line);
  const resolved = wanted.filter((e) => found.has(e)).map((e) => ({ entry: e, card: found.get(e)! }));

  let commander: ScryfallCard | null = null;
  const named = resolved.find((r) => r.entry.section === 'commander');
  // The list's commander loses to a picked one only when asked; it is then just a card in the deck.
  const outvoted = named && keepPicked && commanderPicked && front(named.card.name) !== front(commanderPicked) ? named : null;
  if (named && !outvoted) commander = named.card;
  else if (!commanderPicked && resolved[0]?.entry.section === 'main' && canLead(resolved[0].card)) commander = resolved[0].card;
  let commanderFinish: Finish | null = null;
  let commanderTags: string[] = [];

  // The commander sits in the header, not in the 99 - whether it came from
  // the list or was picked separately and also appears in it.
  const leader = commander ? front(commander.name) : commanderPicked ? front(commanderPicked) : null;
  let leaderRemoved = false;
  const cards: Resolved['cards'] = [];
  for (const { entry, card } of resolved) {
    if (leader && !leaderRemoved && front(card.name) === leader) {
      leaderRemoved = true;
      commanderFinish = entry.finish;
      commanderTags = entry.tags ?? [];
      continue;
    }
    // A second card under Commander stays in the deck, named as a commander;
    // a companion waits on the sideboard, named as the companion (commanders.ts).
    const board: Board = entry.section === 'side' || entry.section === 'maybe' ? entry.section : entry.section === 'companion' ? 'side' : 'main';
    const named = entry.section === 'commander' ? 'commander' as const : entry.section === 'companion' ? 'companion' as const : undefined;
    const existing = cards.find((c) => c.card.id === card.id);
    const tags = entry.tags ?? [];
    if (existing) {
      existing.quantity += entry.quantity;
      if (tags.length) existing.tags = [...new Set([...(existing.tags ?? []), ...tags])];
    } else cards.push({ card, quantity: entry.quantity, finish: entry.finish, board, ...(named ? { named } : {}), ...(tags.length ? { tags } : {}) });
  }
  return { cards, commander, commanderFinish, commanderTags, outvoted: outvoted?.card.name ?? null, missing, unreadable, skipped, later: later.filter((l) => cards.some((c) => c.card.id === l.cardId)) };
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
    const card = 'set' in id ? byPrinting.get(printingKey(id.set, id.collector_number)) : 'name' in id ? byName.get(front(id.name)) : undefined;
    if (card) out.set(entry, card);
  });
  return out;
}
