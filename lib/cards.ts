/**
 * Getting a card: the one place every feature asks for card data by name or id (AGENTS.md, "Getting a card").
 *
 *   1. The cards the app has stored (mtg.db `cards`: every card in a deck, list, collection or answer).
 *   2. The full card data copied from Scryfall each week (cards.db, lib/card-store.ts).
 *   3. Scryfall itself, for a card newer than the last copy. What it returns is stored (1), so the next ask is
 *      local and the weekly refresh (refreshCardData) keeps its price and data fresh.
 *
 * Names are matched exactly, by the front face, ignoring case and accents: a loose match ("did you mean") is the
 * caller's choice to offer, never a silent answer here. Server only.
 */

import { localCards, pieceNames } from './card-store';
import { foldName } from './card-lookup';
import { database, storeCard } from './db';
import { collection, getCard, printingsOf, ScryfallError, type ScryfallCard } from './scryfall';

/** The key a name is matched by: its front face, folded (case, accents, curly quotes). */
export const cardKey = (name: string) => foldName(name);

/** Cards by name: any spelling of a name's key finds it ("Lim-Dûl", "lim-dul", "Delver of Secrets // Insectile Aberration"). */
export class CardMap extends Map<string, ScryfallCard> {
  override get(name: string) { return super.get(cardKey(name)); }
  override has(name: string) { return super.has(cardKey(name)); }
  override set(name: string, card: ScryfallCard) { return super.set(cardKey(name), card); }
  override delete(name: string) { return super.delete(cardKey(name)); }
}

let indexed = false;
/** The stored cards, with a case-blind index on their names (made once). */
function nameIndexed() {
  const db = database();
  if (!indexed) { db.run('CREATE INDEX IF NOT EXISTS cards_name_nocase ON cards (name COLLATE NOCASE)'); indexed = true; }
  return db;
}

/**
 * Cards by name from what the app holds (1 and 2), without reaching Scryfall: for code that must not wait on the
 * network (checking a model's picks in a loop). Keyed by cardKey.
 */
export function cardsNamed(names: string[]): CardMap {
  const out = new CardMap();
  const db = nameIndexed();
  // By the name column with its own case-blind index, never json_extract: that read every stored card once per
  // name and blocked the server for minutes on a Finish list with cards to buy. A double-faced card is found by
  // its front face ("Delver of Secrets" finds "Delver of Secrets // Insectile Aberration").
  for (const n of new Set(names.map((x) => x.trim()).filter(Boolean))) {
    const front = n.split(' // ')[0].trim();
    const r = db.get(`SELECT data FROM cards WHERE name = ? COLLATE NOCASE OR name LIKE ? ESCAPE '\\' LIMIT 1`, [front, `${front.replace(/[\\%_]/g, (c) => `\\${c}`)} // %`]) as { data: string } | null;
    if (r) out.set(n, JSON.parse(r.data) as ScryfallCard);
  }
  const rest = names.filter((n) => !out.has(n));
  if (rest.length) for (const c of localCards(rest)) if (!out.has(c.name)) out.set(c.name, c);
  return out;
}

/**
 * Cards by name, reaching Scryfall for any the app doesn't hold, and storing what it finds. Names nobody has are
 * left out of the map: the caller shows them as not found. Keyed by cardKey.
 */
export async function findCards(names: string[]): Promise<CardMap> {
  const out = cardsNamed(names);
  const missing = [...new Set(names.map((n) => n.split(' // ')[0].trim()).filter((n) => n && !out.has(n)))];
  if (!missing.length) return out;
  try {
    const { cards } = await collection(missing.map((name) => ({ name })));
    for (const c of cards) {
      storeCard(c);
      out.set(c.name, c);
    }
  } catch (e) {
    // Scryfall unreachable: what the app holds is the answer, and the rest show as not found.
    if (!(e instanceof ScryfallError)) console.error('[cards] Scryfall lookup failed', e);
  }
  return out;
}

/** One card by name (see findCards), or null. */
export async function findCard(name: string): Promise<ScryfallCard | null> {
  return (await findCards([name])).get(name) ?? null;
}

/** A card by its Scryfall id: the stored copy, else Scryfall's (stored). Null when there is no such card. */
export async function cardById(id: string): Promise<ScryfallCard | null> {
  const r = database().get('SELECT data FROM cards WHERE id = ?', [id]) as { data: string } | null;
  if (r) return JSON.parse(r.data) as ScryfallCard;
  try {
    const c = await getCard(id);
    storeCard(c);
    return c;
  } catch (e) {
    if (e instanceof ScryfallError && e.status === 404) return null;
    throw e;
  }
}

/**
 * Which of these names (a card's related parts) are token, emblem or reminder cards rather than cards to play: from
 * the weekly copy, so a deck's extras show Morph or Cyberman and leave out Tower Winder. Names it can't place are
 * left out.
 */
export function tablePieces(names: string[]): string[] {
  try { return [...pieceNames(names)]; } catch { return []; }
}

const PRINTINGS_MS = 6 * 3600_000;
const printingsKept = new Map<string, { at: number; cards: Promise<ScryfallCard[]> }>();

/** Every printing of a card, newest first: asked of Scryfall once and kept for a few hours (the card popup, the printing picker). */
export function printingsFor(oracleId: string): Promise<ScryfallCard[]> {
  const had = printingsKept.get(oracleId);
  if (had && Date.now() - had.at < PRINTINGS_MS) return had.cards;
  const cards = printingsOf(oracleId);
  printingsKept.set(oracleId, { at: Date.now(), cards });
  // A failed ask is not kept: the next one tries again.
  cards.catch(() => { if (printingsKept.get(oracleId)?.cards === cards) printingsKept.delete(oracleId); });
  if (printingsKept.size > 500) printingsKept.delete(printingsKept.keys().next().value!);
  return cards;
}
