/**
 * Decks from Mythic Tools, with the copies they hold.
 *
 * Mythic Tools exports a deck two ways. The deck list is the usual shape -
 * commander first, then the 99, then "Sideboard:" - with "*P*" on proxies.
 * The collection-linked list says where each card's copy is:
 *
 *   Cards to get from my collection:
 *   From "bulk"
 *   1x Sol Ring (40k) #250
 *   1x Command Tower (sld) #7030 FOIL
 *   Proxies:
 *   1x Plateau (ced) #280
 *   New cards (imported from outside my collection): None
 *   Available in my collection (not yet linked):
 *   1x Hidden Courtyard (lci) #274 (Sideboard)
 *     → exact: bulk
 *   Need to buy:
 *   1x Mana Geyser (soc) #247 (Sideboard)
 *
 * The deck list makes the deck; the linked list then takes each "From" copy
 * out of that box and into the deck, as the deck's own copy. Proxies that
 * are copies in a box are taken the same way; the rest are marked on the
 * deck. Maybeboard cards are only in the linked list, so they come from it.
 * What is available or to buy needs nothing: the deck's Collection view
 * works that out from the boxes.
 */

import { giveBack, pullExact, setProxies, settle, UNSORTED } from './collection';
import { isProxy } from './copy-variant';
import { createList, database, deleteList, getList, listLists, type List } from './db';
import { parseDecklist } from './decklist';
import { replaceWith, type ImportSummary } from './import-into';
import type { Finish, ScryfallCard } from './scryfall';

export interface LinkedLine {
  quantity: number;
  /** The English name: "ジェスカの意志 (Jeska's Will)" is read as Jeska's Will. */
  name: string;
  set: string;
  number: string;
  finish: Finish;
  board: 'main' | 'side' | 'maybe';
  line: string;
}

export interface LinkedList {
  title: string;
  fromBoxes: Array<LinkedLine & { location: string }>;
  proxies: LinkedLine[];
  newCards: LinkedLine[];
  available: Array<LinkedLine & { where: string; exact: boolean }>;
  buy: LinkedLine[];
  unreadable: string[];
}

const SECTIONS: Array<[RegExp, keyof Omit<LinkedList, 'title' | 'unreadable'>]> = [
  [/^cards to get from my collection:/i, 'fromBoxes'],
  [/^proxies:/i, 'proxies'],
  [/^new cards\b.*:/i, 'newCards'],
  [/^available in my collection\b.*:/i, 'available'],
  [/^need to buy:/i, 'buy'],
];

// "1x Name (set) #123 FOIL (Sideboard)"
const LINKED = /^(\d+)x?\s+(.+?)\s+\(([A-Za-z0-9]{2,6})\)\s+#(\S+)((?:\s+(?:FOIL|ETCHED))?)(?:\s+\((Sideboard|Maybeboard|Main)\))?\s*$/i;

/** A name with the English one after it in brackets, as Mythic Tools writes a card in another language. */
export function englishName(name: string): string {
  const m = name.match(/^(.*\S)\s+\(([^()]+)\)$/);
  // Only when the part before is not plain English: "Erase (Not the Urza's Legacy One)" stays as it is.
  return m && /[^\x20-\x7E]|[|$]/.test(m[1]) ? m[2].trim() : name;
}

/** Whether a paste is Mythic Tools' collection-linked list. */
export const isLinkedList = (text: string) => /^(cards to get from my collection|need to buy):/im.test(text);

export function parseLinkedList(text: string): LinkedList {
  const out: LinkedList = { title: '', fromBoxes: [], proxies: [], newCards: [], available: [], buy: [], unreadable: [] };
  let section: keyof Omit<LinkedList, 'title' | 'unreadable'> | null = null;
  let box = '';
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const heading = SECTIONS.find(([re]) => re.test(line));
    if (heading) {
      section = heading[1];
      box = '';
      continue; // "New cards (...): None" - nothing after the colon is a card.
    }
    if (!section) {
      if (!out.title) out.title = line;
      continue;
    }
    if (/^none$/i.test(line)) continue;
    const from = line.match(/^From\s+"(.*)"$/i);
    if (from) {
      box = from[1];
      continue;
    }
    const where = line.match(/^→\s*(exact|partial):\s*(.*)$/i) ?? line.match(/^->\s*(exact|partial):\s*(.*)$/i);
    if (where) {
      const last = out.available[out.available.length - 1];
      if (last && section === 'available') {
        last.where = where[2].trim();
        last.exact = where[1].toLowerCase() === 'exact';
      }
      continue;
    }
    const m = line.match(LINKED);
    if (!m) {
      out.unreadable.push(line);
      continue;
    }
    const card: LinkedLine = {
      quantity: Number(m[1]),
      name: englishName(m[2].trim()),
      set: m[3].toLowerCase(),
      number: m[4],
      finish: /etched/i.test(m[5]) ? 'etched' : /foil/i.test(m[5]) ? 'foil' : 'nonfoil',
      board: /side/i.test(m[6] ?? '') ? 'side' : /maybe/i.test(m[6] ?? '') ? 'maybe' : 'main',
      line,
    };
    if (section === 'fromBoxes') out.fromBoxes.push({ ...card, location: box });
    else if (section === 'available') out.available.push({ ...card, where: '', exact: false });
    else out[section].push(card);
  }
  return out;
}

const MARK: Record<Finish, string> = { nonfoil: '', foil: ' *F*', etched: ' *E*' };
const lineOf = (l: LinkedLine) => `${l.quantity} ${l.name} (${l.set}) ${l.number}${MARK[l.finish]}`;

/**
 * The text to import: the deck list with its first `commanders` lines
 * under a Commander heading, and the linked list's maybeboard after it.
 */
export function mythicDeckText(list: string, linked = '', commanders = 1): string {
  const lines = list.replace(/^﻿/, '').split(/\r?\n/);
  const first = lines.findIndex((l) => l.trim());
  // A list that already names its sections is left as it is.
  const headed = lines.some((l) => /^\s*(\/\/\s*)?commanders?:?\s*$/i.test(l));
  const body = headed || first < 0
    ? lines
    : ['Commander', ...lines.slice(first, first + commanders), '', 'Deck', ...lines.slice(first + commanders)];
  const maybe = linked ? [...new Map(
    (() => {
      const p = parseLinkedList(linked);
      return [...p.fromBoxes, ...p.proxies, ...p.newCards, ...p.available, ...p.buy].filter((l) => l.board === 'maybe');
    })().map((l) => [`${l.set}|${l.number}|${l.finish}`, l]),
  ).values()] : [];
  return [...body, ...(maybe.length ? ['', 'Maybeboard:', ...maybe.map(lineOf)] : [])].join('\n');
}

export interface LinkReport {
  /** Copies taken from the box the list named. */
  linked: number;
  /** Of those, proxy copies. */
  proxiesLinked: number;
  /** Lines found in another box than the one named. */
  otherBox: string[];
  /** "From" lines with no copy left to take. */
  notLinked: string[];
  /** Proxies marked on the deck, having no proxy copy in a box. */
  proxiesMarked: number;
  /** Proxy lines that left the real copy for a deck still to come whose line is not a proxy: marked as proxies instead. */
  yielded: string[];
  /** Copies given back because the deck did not want them. Should be 0. */
  returned: number;
  /** What the linked list said: for checking against the deck's Collection view. */
  available: number;
  buy: number;
  unreadable: string[];
}

interface CopyRow { cardId: string; finish: Finish; location: string; variant: string; quantity: number }

/**
 * The profile's boxes, read once and looked up by printing and by name.
 * Asking the database per line meant reading every copy's card data four
 * times for each line of a deck - minutes per deck on the Pi.
 */
interface CopyIndex { byPrinting: Map<string, CopyRow[]>; byName: Map<string, CopyRow[]> }

function copyIndex(profileId: string): CopyIndex {
  const rows = database().all(
    `SELECT cc.cardId, cc.finish, cc.location, cc.variant, cc.quantity, c.data FROM collection_cards cc JOIN cards c ON c.id = cc.cardId
     WHERE cc.profileId = ?`, [profileId],
  ) as unknown as Array<CopyRow & { data: string }>;
  const index: CopyIndex = { byPrinting: new Map(), byName: new Map() };
  const add = (map: Map<string, CopyRow[]>, key: string, row: CopyRow) => { const list = map.get(key); if (list) list.push(row); else map.set(key, [row]); };
  const cards = new Map<string, ScryfallCard>();
  for (const { data, ...row } of rows) {
    let card = cards.get(row.cardId);
    if (!card) { card = JSON.parse(data) as ScryfallCard; cards.set(row.cardId, card); }
    add(index.byPrinting, printing({ set: card.set ?? '', number: card.collector_number ?? '' }), row);
    // A line names the card or its front face ("Fire // Ice" is found as "Fire").
    const name = card.name.toLowerCase();
    add(index.byName, name, row);
    const front = name.split(' // ')[0];
    if (front !== name) add(index.byName, front, row);
  }
  return index;
}

/** Copies of a printing in the profile's boxes - in `location` first - best match for the line first. */
function copiesFor(index: CopyIndex, l: LinkedLine, location: string | null, proxy: boolean): CopyRow[] {
  return (index.byPrinting.get(printing(l)) ?? [])
    .filter((r) => location === null || r.location === location)
    .sort((a, b) => Number(b.finish === l.finish) - Number(a.finish === l.finish)
      || Number(isProxy(b.variant) === proxy) - Number(isProxy(a.variant) === proxy)
      || b.quantity - a.quantity);
}

/** The same card in any printing, in a box: for a copy whose printing the collection has under another number. */
function anyPrinting(index: CopyIndex, l: LinkedLine, location: string | null): CopyRow[] {
  return (index.byName.get(l.name.toLowerCase()) ?? []).filter((r) => location === null || r.location === location)
    .sort((a, b) => Number(b.finish === l.finish) - Number(a.finish === l.finish) || Number(isProxy(a.variant)) - Number(isProxy(b.variant)));
}

const printing = (l: { set: string; number: string }) => `${l.set.toLowerCase()}|${l.number}`;
const nameKey = (name: string) => name.split(' // ')[0].trim().toLowerCase();

/** A deck's proxy lines, by printing: from the linked list's Proxies and from "*P*" in the deck list. */
function proxyLinesOf(list: string, parsed: LinkedList) {
  return [
    ...parsed.proxies,
    ...parseDecklist(list).entries.filter((e) => e.proxy && e.set && e.collectorNumber)
      .map((e) => ({ set: e.set!, number: e.collectorNumber!, name: e.name, quantity: e.quantity })),
  ];
}

/**
 * The real copies a deck's linked list claims, by card name: its "From" lines
 * less those that are proxies. For importing several decks: a proxy line
 * leaves a real copy to a later deck that claims it for real.
 */
export function realClaims(list: string, linked: string): Map<string, number> {
  const parsed = parseLinkedList(linked);
  const proxy = new Map<string, number>();
  for (const p of proxyLinesOf(list, parsed)) proxy.set(printing(p), Math.max(proxy.get(printing(p)) ?? 0, p.quantity));
  const claims = new Map<string, number>();
  for (const l of parsed.fromBoxes) {
    const asProxy = Math.min(l.quantity, proxy.get(printing(l)) ?? 0);
    proxy.set(printing(l), (proxy.get(printing(l)) ?? 0) - asProxy);
    if (l.quantity > asProxy) claims.set(nameKey(l.name), (claims.get(nameKey(l.name)) ?? 0) + l.quantity - asProxy);
  }
  return claims;
}

/** Mark proxies on the deck row for this printing, or for the same card by name. */
function markProxy(listId: string, l: { set: string; number: string; name: string }, quantity: number): boolean {
  const rows = database().all(
    `SELECT lc.cardId, lc.proxies, lc.quantity, c.data FROM list_cards lc JOIN cards c ON c.id = lc.cardId WHERE lc.listId = ?`, [listId],
  ) as Array<{ cardId: string; proxies: number; quantity: number; data: string }>;
  const cards = rows.map((r) => ({ ...r, card: JSON.parse(r.data) as ScryfallCard }));
  const front = (n: string) => n.split(' // ')[0].trim().toLowerCase();
  const row = cards.find((r) => printing({ set: r.card.set ?? '', number: r.card.collector_number ?? '' }) === printing(l))
    ?? cards.find((r) => front(r.card.name) === front(l.name));
  if (!row) return false;
  setProxies(listId, row.cardId, row.proxies + quantity);
  return true;
}

/**
 * Link a deck to the copies the linked list names. The deck's cards must
 * be in already. What the deck held before goes back first, so linking
 * again gives the same answer. `reserved`: real copies, by card name, that
 * decks still to be linked claim with lines that are not proxies - a proxy
 * line here does not take those (realClaims).
 */
export function linkMythic(listId: string, profileId: string, list: string, linked: string, reserved?: Map<string, number>): LinkReport {
  const parsed = parseLinkedList(linked);
  const report: LinkReport = {
    linked: 0, proxiesLinked: 0, otherBox: [], notLinked: [], proxiesMarked: 0, yielded: [], returned: 0,
    available: parsed.available.reduce((n, l) => n + l.quantity, 0), buy: parsed.buy.reduce((n, l) => n + l.quantity, 0),
    unreadable: parsed.unreadable,
  };
  const db = database();
  const own = !db.inTransaction;
  if (own) db.run('BEGIN');
  try {
    giveBack(listId);
    // Lines that are proxies, by printing: from the linked list and from "*P*" in the deck list.
    const proxyLeft = new Map<string, number>();
    const proxyLines = proxyLinesOf(list, parsed);
    for (const p of proxyLines) proxyLeft.set(printing(p), Math.max(proxyLeft.get(printing(p)) ?? 0, p.quantity));
    const proxyTotal = new Map(proxyLeft);
    // Read after giving back, so copies this deck held before can be taken again.
    const index = copyIndex(profileId);

    for (const l of parsed.fromBoxes) {
      const key = printing(l);
      let left = l.quantity;
      const wantProxy = (proxyLeft.get(key) ?? 0) > 0;
      const location = l.location || UNSORTED;
      const sources: Array<[CopyRow[], boolean]> = [
        [copiesFor(index, l, location, wantProxy), false],
        [copiesFor(index, l, null, wantProxy), true],
        [anyPrinting(index, l, location), false],
        [anyPrinting(index, l, null), true],
      ];
      let elsewhere = false;
      let yielded = false;
      // Real copies of this card still in a box beyond what later decks claim for real: all a proxy line may take.
      const spare = () => (index.byName.get(nameKey(l.name)) ?? []).filter((r) => !isProxy(r.variant)).reduce((n, r) => n + r.quantity, 0)
        - (reserved?.get(nameKey(l.name)) ?? 0);
      for (const [rows, other] of sources) {
        for (const r of rows) {
          if (left <= 0) break;
          const cap = wantProxy && !isProxy(r.variant) && reserved ? Math.max(0, Math.min(left, spare())) : left;
          if (cap < left && !isProxy(r.variant)) yielded = true;
          if (cap <= 0) continue;
          const n = pullExact(listId, { cardId: r.cardId, finish: r.finish, location: r.location, variant: r.variant }, cap, l.board !== 'main');
          if (!n) continue;
          // The index is read once: keep it true to what is left in the boxes.
          r.quantity -= n;
          left -= n;
          report.linked += n;
          if (other) elsewhere = true;
          if (isProxy(r.variant)) {
            report.proxiesLinked += n;
            proxyLeft.set(key, Math.max(0, (proxyLeft.get(key) ?? 0) - n));
          } else if (wantProxy) {
            // A real copy stands where the list says proxy: it fills the slot, so nothing to mark.
            proxyLeft.set(key, Math.max(0, (proxyLeft.get(key) ?? 0) - n));
          }
        }
        if (left <= 0) break;
      }
      if (elsewhere) report.otherBox.push(l.line);
      if (left > 0 && yielded) report.yielded.push(l.line);
      else if (left > 0) report.notLinked.push(left === l.quantity ? l.line : `${l.line} (${left} of ${l.quantity} not found)`);
    }

    // Proxies with no copy in a box are marked on the deck.
    for (const p of proxyLines) {
      const key = printing(p);
      const left = proxyLeft.get(key) ?? 0;
      if (left <= 0 || !proxyTotal.has(key)) continue;
      if (markProxy(listId, p, left)) report.proxiesMarked += left;
      proxyLeft.set(key, 0);
    }
    report.returned = settle(listId);
    if (own) db.run('COMMIT');
  } catch (error) {
    if (own) db.run('ROLLBACK');
    throw error;
  }
  return report;
}

/**
 * Mark the "*P*" lines of a plain import as proxies, when there is no
 * linked list to take copies from. A card the deck already holds a proxy
 * copy of is not marked again: that would send the copy back.
 */
export function markListProxies(listId: string, list: string): number {
  const held = new Map<string, number>();
  for (const r of database().all(
    `SELECT dp.variant, dp.quantity, c.data FROM deck_pulls dp JOIN cards c ON c.id = dp.cardId WHERE dp.listId = ?`, [listId],
  ) as Array<{ variant: string; quantity: number; data: string }>) {
    if (!isProxy(r.variant)) continue;
    const name = (JSON.parse(r.data) as ScryfallCard).name.split(' // ')[0].toLowerCase();
    held.set(name, (held.get(name) ?? 0) + r.quantity);
  }
  let marked = 0;
  for (const e of parseDecklist(list).entries.filter((x) => x.proxy)) {
    const name = e.name.split(' // ')[0].toLowerCase();
    const n = e.quantity - Math.min(e.quantity, held.get(name) ?? 0);
    held.set(name, Math.max(0, (held.get(name) ?? 0) - e.quantity));
    if (n > 0 && markProxy(listId, { set: e.set ?? '', number: e.collectorNumber ?? '', name: e.name }, n)) marked += n;
  }
  return marked;
}

export interface MythicDeck { name: string; list: string; linked?: string; commanders?: number }

/**
 * Several Mythic Tools decks, in order, safe in any order: when two decks'
 * exports claim the same single copy, the one whose line is not a proxy
 * gets it - a proxy line leaves it for a later deck that claims it for real,
 * and is marked as a proxy. Two real claims: the first deck keeps it.
 * `run` imports one deck (the script wraps it to wait out Scryfall and print).
 */
export async function importMythicDecks(
  profileId: string, decks: MythicDeck[],
  run: (deck: MythicDeck, reserved: Map<string, number>) => Promise<MythicDeckResult> = (deck, reserved) => importMythicDeck(profileId, deck, reserved),
): Promise<MythicDeckResult[]> {
  const claims = decks.map((d) => (d.linked?.trim() ? realClaims(d.list, d.linked) : new Map<string, number>()));
  const out: MythicDeckResult[] = [];
  for (let i = 0; i < decks.length; i++) {
    const reserved = new Map<string, number>();
    for (const later of claims.slice(i + 1)) for (const [name, n] of later) reserved.set(name, (reserved.get(name) ?? 0) + n);
    out.push(await run(decks[i], reserved));
  }
  return out;
}

export interface MythicDeckResult {
  list: List;
  created: boolean;
  imported: ImportSummary & { applied: boolean };
  link: LinkReport | null;
  proxiesMarked: number;
}

/**
 * A Mythic Tools deck into a profile: a deck of the same name is updated in
 * place - its plan, tags, notes, sections and games stay - otherwise a new
 * deck is made. Nothing changes if a line of the list cannot be found.
 */
export async function importMythicDeck(
  profileId: string, deck: MythicDeck, reserved?: Map<string, number>,
): Promise<MythicDeckResult> {
  const name = deck.name.trim();
  const existing = listLists(profileId, 'deck').find((l) => l.name.trim().toLowerCase() === name.toLowerCase()) ?? null;
  const text = mythicDeckText(deck.list, deck.linked ?? '', deck.commanders ?? 1);
  // A new deck is made only once its list reads in full.
  const list = existing ?? createList(profileId, name, '', { kind: 'deck' });
  const imported = await replaceWith(list, text);
  if (!imported.applied) {
    if (!existing) deleteList(list.id);
    return { list, created: false, imported, link: null, proxiesMarked: 0 };
  }
  database().run('UPDATE list_cards SET proxies = 0 WHERE listId = ?', [list.id]);
  const link = deck.linked?.trim() ? linkMythic(list.id, profileId, deck.list, deck.linked, reserved) : null;
  const proxiesMarked = link ? link.proxiesMarked : markListProxies(list.id, deck.list);
  return { list: getList(list.id, profileId) ?? list, created: !existing, imported, link, proxiesMarked };
}
