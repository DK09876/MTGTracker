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

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

import { localCards } from './card-store';
import { foldName } from './card-lookup';
import { exactCard, findMentions, markText, nameIndex, phraseKey, phrasesForPick, type CardPick, type CardReading, type NameIndex } from './card-names';
import { cardPicks, rememberPick } from './card-picks';
import { EVERYDAY_WORDS } from './everyday-words';
import { database, storeCard } from './db';
import { rulesIndex } from './rules/sources';
import { cardNameCatalog, collection, getCard, imageOf, printingsOf, ScryfallError, type ScryfallCard } from './scryfall';

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

// --- Every card's name, for reading the owner's words (lib/card-names.ts) ---

const NAMES_FILE = join(dirname(process.env.MTG_DB_PATH || `${process.cwd()}/data/mtg.db`), 'rules', 'card-names.json');
const DAY = 24 * 3600_000;
// Kept on globalThis: every route's bundle has its own copy of this module.
const kept = globalThis as unknown as { __cardNames?: { index: NameIndex; at: number } };

/** Every card name (Scryfall's catalog, fetched daily and kept on disk), indexed for findMentions. */
export async function cardNameIndex(): Promise<NameIndex> {
  if (kept.__cardNames && Date.now() - kept.__cardNames.at < DAY) return kept.__cardNames.index;
  const read = () => { try { return JSON.parse(readFileSync(NAMES_FILE, 'utf8')) as string[]; } catch { return null; } };
  let names: string[] | null = null;
  try { if (Date.now() - statSync(NAMES_FILE).mtimeMs < DAY) names = read(); } catch { /* not kept yet */ }
  if (!names) {
    try {
      names = await cardNameCatalog();
      try { mkdirSync(dirname(NAMES_FILE), { recursive: true }); writeFileSync(NAMES_FILE, JSON.stringify(names)); } catch { /* in memory only */ }
    } catch (error) {
      // An old copy beats none.
      names = read();
      if (!names) throw error;
    }
  }
  const index = nameIndex(names);
  kept.__cardNames = { index, at: Date.now() };
  return index;
}

/**
 * Read the owner's words for cards (AGENTS.md, "Reading the owner's words"): the cards we're sure of marked
 * [[like this]] in the text, what to ask about, and how a loose word was read. `picks` are the owner's answers to
 * earlier choices: remembered for the profile (lib/card-picks.ts), so the same words aren't asked again.
 * `known`: cards in play where the text was written (the deck's, the conversation's).
 */
export async function readCards(
  text: string,
  { profile = null, known = [], picks = [], pictures = true }: { profile?: string | null; known?: string[]; picks?: CardPick[]; pictures?: boolean } = {},
): Promise<CardReading> {
  const [index, vocab] = await Promise.all([cardNameIndex(), rulesIndex().then((r) => r.vocab).catch(() => new Set<string>())]);
  const remembered = profile ? cardPicks(profile) : new Map<string, string>();
  for (const p of picks) {
    const phrases = phrasesForPick(p.mention, p.name, p.kind, index);
    for (const phrase of phrases) remembered.set(phrase, p.name);
    if (profile) rememberPick(profile, phrases, p.name);
  }
  // A [[mark]] no card has (an edit inside a marked name, a typo in brackets) is read again as words, so it's asked
  // about like any other typo rather than sent as a card that doesn't exist.
  const checked = text.replace(/\[\[+([^[\]]*)\]\]+/g, (mark, name: string) => (exactCard(name, index) ? mark : name));
  const unmarked = checked.replace(/\[\[+[^[\]]*\]\]+/g, ' ');
  const m = findMentions(unmarked, index, vocab, { everyday: EVERYDAY_WORDS, known, remembered });
  const shown = pictures && m.ambiguous.length ? await findCards(m.ambiguous.flatMap((a) => a.options)).catch(() => null) : null;
  return {
    text: markText(checked, m.spans),
    cards: m.cards,
    choices: m.ambiguous.map((a) => ({
      mention: a.mention, kind: a.kind,
      options: a.options.map((name) => { const c = shown?.get(name); return { name, image: c ? imageOf(c, 'normal') : null }; }),
    })),
    // A word read loosely (a pick from before, a card in play) is said, with a way to forget a pick.
    readAs: m.spans.filter((s) => s.how !== 'exact' && phraseKey(s.mention) !== phraseKey(s.name.split(' // ')[0]))
      .map((s) => ({ mention: s.mention, name: s.name, remembered: s.how === 'remembered' })),
    suggestions: m.suggestions,
  };
}
