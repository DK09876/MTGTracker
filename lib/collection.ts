/**
 * A profile's collection: the cards they own, where each copy is kept, and
 * which copies their decks have taken - modelled on Mythic Tools.
 *
 * A copy is in one place at a time. It sits in a box or binder (or unsorted)
 * until a deck pulls it; then it is in that deck, remembered with the box it
 * came from, and no longer in the box. So what someone owns is always what
 * is in their boxes plus what their decks hold, and a card in two decks is
 * two copies or one deck is short.
 *
 * A deck asks for cards by what they are, not which printing: a deck listing
 * the Secret Lair Sol Ring is satisfied by the Commander Legends one in the
 * binder. Pulling prefers the exact printing and finish when there is one.
 *
 * Decks change - cards cut, commanders swapped, lists pasted over, decks
 * deleted - and copies they no longer need go back to the box they came
 * from (settle), so nothing owned is ever lost track of.
 *
 * Plain lists are wishlists and idea piles: they do not take cards.
 */

import { database, storeCard, type List } from './db';
import { imageOf, priceOf, type Finish, type ScryfallCard } from './scryfall';
import { slimCard } from './slim';
import { tagKey } from './tags';

/** The location of a card that has not been put in any box. */
export const UNSORTED = '';

export type LocationKind = 'box' | 'binder';

export interface Location {
  name: string;
  kind: LocationKind;
  /** Copies in it. */
  count: number;
}

/** Copies of one printing, in one finish, in one box. */
export interface BoxCopies {
  card: ScryfallCard;
  finish: Finish;
  location: string;
  quantity: number;
  addedAt: string;
}

/** Copies a deck has taken. */
export interface DeckCopies {
  listId: string;
  listName: string;
  card: ScryfallCard;
  finish: Finish;
  fromLocation: string;
  quantity: number;
}

const now = () => new Date().toISOString();

/** Run in a transaction, or inside the one already open. */
function tx<T>(work: () => T): T {
  const db = database();
  if (db.inTransaction) return work();
  db.run('BEGIN');
  try {
    const out = work();
    db.run('COMMIT');
    return out;
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
}

// --- boxes and binders ---------------------------------------------------------

export function locations(profileId: string): Location[] {
  const db = database();
  const named = db.all('SELECT name, kind FROM collection_locations WHERE profileId = ? ORDER BY createdAt', [profileId]) as
    Array<{ name: string; kind: LocationKind }>;
  const counts = new Map((db.all(
    'SELECT location, SUM(quantity) AS n FROM collection_cards WHERE profileId = ? GROUP BY location', [profileId],
  ) as Array<{ location: string; n: number }>).map((r) => [r.location, r.n]));
  const out: Location[] = [{ name: UNSORTED, kind: 'box', count: counts.get(UNSORTED) ?? 0 }];
  for (const l of named) out.push({ ...l, count: counts.get(l.name) ?? 0 });
  // A location named in an import but never made still shows.
  for (const [name, count] of counts) if (name !== UNSORTED && !named.some((l) => l.name === name)) out.push({ name, kind: 'box', count });
  return out;
}

export function addLocation(profileId: string, name: string, kind: LocationKind = 'box'): void {
  if (name === UNSORTED) return;
  database().run(
    'INSERT INTO collection_locations (profileId, name, kind, createdAt) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
    [profileId, name, kind, now()],
  );
}

/** Rename a box: its cards, and the record of cards decks took from it, follow. */
export function renameLocation(profileId: string, from: string, to: string, kind?: LocationKind): void {
  if (from === UNSORTED || to === UNSORTED) return;
  const db = database();
  tx(() => {
    if (from !== to) {
      moveAll(profileId, from, to);
      db.run('UPDATE collection_locations SET name = ? WHERE profileId = ? AND name = ?', [to, profileId, from]);
      db.run(
        `UPDATE deck_pulls SET fromLocation = ? WHERE fromLocation = ?
         AND listId IN (SELECT id FROM lists WHERE profileId = ?)`, [to, from, profileId],
      );
    }
    if (kind) db.run('UPDATE collection_locations SET kind = ? WHERE profileId = ? AND name = ?', [kind, profileId, to]);
  });
}

/** Remove a box; what was in it becomes unsorted. */
export function deleteLocation(profileId: string, name: string): void {
  if (name === UNSORTED) return;
  const db = database();
  tx(() => {
    moveAll(profileId, name, UNSORTED);
    db.run('DELETE FROM collection_locations WHERE profileId = ? AND name = ?', [profileId, name]);
    db.run(
      `UPDATE deck_pulls SET fromLocation = '' WHERE fromLocation = ?
       AND listId IN (SELECT id FROM lists WHERE profileId = ?)`, [name, profileId],
    );
  });
}

function moveAll(profileId: string, from: string, to: string): void {
  const rows = database().all(
    'SELECT cardId, finish, quantity FROM collection_cards WHERE profileId = ? AND location = ?', [profileId, from],
  ) as Array<{ cardId: string; finish: Finish; quantity: number }>;
  for (const r of rows) {
    changeCount(profileId, r.cardId, r.finish, from, -r.quantity);
    changeCount(profileId, r.cardId, r.finish, to, r.quantity);
  }
}

// --- copies in boxes ----------------------------------------------------------

/** Add or take away copies in one box; a count that reaches zero removes the row. */
function changeCount(profileId: string, cardId: string, finish: Finish, location: string, delta: number): number {
  const db = database();
  const row = db.get(
    'SELECT quantity FROM collection_cards WHERE profileId = ? AND cardId = ? AND finish = ? AND location = ?',
    [profileId, cardId, finish, location],
  ) as { quantity: number } | null;
  const next = Math.max(0, (row?.quantity ?? 0) + delta);
  if (row && next === 0) {
    db.run('DELETE FROM collection_cards WHERE profileId = ? AND cardId = ? AND finish = ? AND location = ?',
      [profileId, cardId, finish, location]);
  } else if (row) {
    db.run('UPDATE collection_cards SET quantity = ? WHERE profileId = ? AND cardId = ? AND finish = ? AND location = ?',
      [next, profileId, cardId, finish, location]);
  } else if (next > 0) {
    db.run('INSERT INTO collection_cards (profileId, cardId, finish, location, quantity, addedAt) VALUES (?, ?, ?, ?, ?, ?)',
      [profileId, cardId, finish, location, next, now()]);
  }
  return next;
}

/** Add copies to the collection. Answers how many are in that box now. */
export function addToCollection(
  profileId: string, card: ScryfallCard, quantity = 1, finish: Finish = 'nonfoil', location = UNSORTED,
): number {
  return tx(() => {
    storeCard(card);
    if (location !== UNSORTED) addLocation(profileId, location);
    return changeCount(profileId, card.id, finish, location, quantity);
  });
}

/** Many cards at once, for an import: one transaction. */
export function addManyToCollection(
  profileId: string, items: Array<{ card: ScryfallCard; quantity: number; finish: Finish; location: string }>,
): void {
  tx(() => {
    for (const i of items) addToCollection(profileId, i.card, i.quantity, i.finish, i.location);
  });
}

/** Set how many copies are in one box; zero removes them. */
export function setCollectionCount(profileId: string, cardId: string, finish: Finish, location: string, quantity: number): void {
  tx(() => {
    const row = database().get(
      'SELECT quantity FROM collection_cards WHERE profileId = ? AND cardId = ? AND finish = ? AND location = ?',
      [profileId, cardId, finish, location],
    ) as { quantity: number } | null;
    changeCount(profileId, cardId, finish, location, Math.max(0, quantity) - (row?.quantity ?? 0));
  });
}

/** Move copies to another box, or relabel their finish. */
export function moveCopies(
  profileId: string, from: { cardId: string; finish: Finish; location: string },
  to: { finish?: Finish; location?: string }, quantity: number,
): number {
  return tx(() => {
    const row = database().get(
      'SELECT quantity FROM collection_cards WHERE profileId = ? AND cardId = ? AND finish = ? AND location = ?',
      [profileId, from.cardId, from.finish, from.location],
    ) as { quantity: number } | null;
    const n = Math.min(quantity, row?.quantity ?? 0);
    if (n <= 0) return 0;
    const location = to.location ?? from.location;
    if (location !== UNSORTED) addLocation(profileId, location);
    changeCount(profileId, from.cardId, from.finish, from.location, -n);
    changeCount(profileId, from.cardId, to.finish ?? from.finish, location, n);
    return n;
  });
}

/** Everything in the profile's boxes. */
export function boxCopies(profileId: string): BoxCopies[] {
  return (database().all(
    `SELECT cc.finish, cc.location, cc.quantity, cc.addedAt, c.data FROM collection_cards cc
     JOIN cards c ON c.id = cc.cardId WHERE cc.profileId = ? ORDER BY c.name`, [profileId],
  ) as Array<{ finish: Finish; location: string; quantity: number; addedAt: string; data: string }>)
    .map(({ data, ...r }) => ({ ...r, card: JSON.parse(data) as ScryfallCard }));
}

/** Everything the profile's decks have taken. */
export function deckCopies(profileId: string): DeckCopies[] {
  return (database().all(
    `SELECT dp.listId, l.name AS listName, dp.finish, dp.fromLocation, dp.quantity, c.data FROM deck_pulls dp
     JOIN lists l ON l.id = dp.listId JOIN cards c ON c.id = dp.cardId
     WHERE l.profileId = ? ORDER BY c.name`, [profileId],
  ) as Array<{ listId: string; listName: string; finish: Finish; fromLocation: string; quantity: number; data: string }>)
    .map(({ data, ...r }) => ({ ...r, card: JSON.parse(data) as ScryfallCard }));
}

// --- decks and the copies they take ----------------------------------------------

export type Status = 'in-deck' | 'proxy' | 'in-box' | 'in-other-deck' | 'missing';

/** One card a deck wants, and where its copies are. */
export interface Holding {
  key: string;
  name: string;
  /** Copies the deck wants. */
  need: number;
  /** Copies in the deck - taken from the collection. */
  pulled: number;
  /** Copies standing in as proxies. */
  proxies: number;
  /** Still to find: need less pulled and proxies. */
  short: number;
  status: Status;
  pulledCopies: Array<{ cardId: string; set: string; number: string; finish: Finish; fromLocation: string; quantity: number }>;
  /** Copies in the profile's boxes, best match first. */
  inBoxes: Array<{ cardId: string; set: string; number: string; finish: Finish; location: string; quantity: number; exact: boolean }>;
  /** Copies other decks hold. */
  inDecks: Array<{ listId: string; listName: string; quantity: number }>;
  /** What one copy costs, in the printing and finish the deck lists. */
  price: number | null;
  /** The deck's rows for this card (printing ids), for marking proxies. */
  cardIds: string[];
  commander: boolean;
  image: string | null;
}

export interface Ownership {
  cards: Holding[];
  summary: {
    need: number;
    inDeck: number;
    proxies: number;
    /** Short copies that are sitting in a box, ready to pull. */
    inBoxes: number;
    /** Short copies only other decks have. */
    inOtherDecks: number;
    missing: number;
    /** What the missing copies cost, at the deck's printings. */
    missingCost: number;
  };
}

interface Want {
  key: string;
  name: string;
  need: number;
  proxies: number;
  /** The printings the deck lists, with finishes and prices. */
  listed: Array<{ card: ScryfallCard; finish: Finish; commander: boolean }>;
}

/** What a deck wants, by card: the main board and the commander. Plain lists want nothing. */
function wants(listId: string): Map<string, Want> {
  const db = database();
  const list = db.get('SELECT kind, commanderId, commanderFinish FROM lists WHERE id = ?', [listId]) as
    { kind: string; commanderId: string | null; commanderFinish: Finish } | null;
  const out = new Map<string, Want>();
  if (!list || list.kind !== 'deck') return out;
  const rows = db.all(
    `SELECT c.data, lc.quantity, lc.finish, lc.proxies FROM list_cards lc JOIN cards c ON c.id = lc.cardId
     WHERE lc.listId = ? AND lc.board = 'main'`, [listId],
  ) as Array<{ data: string; quantity: number; finish: Finish; proxies: number }>;
  const commander = list.commanderId
    ? db.get('SELECT data FROM cards WHERE id = ?', [list.commanderId]) as { data: string } | null
    : null;
  const entries = rows.map((r) => ({ card: JSON.parse(r.data) as ScryfallCard, quantity: r.quantity, finish: r.finish, proxies: r.proxies, commander: false }));
  if (commander) entries.push({ card: JSON.parse(commander.data) as ScryfallCard, quantity: 1, finish: list.commanderFinish, proxies: 0, commander: true });
  for (const e of entries) {
    const key = tagKey(e.card);
    const w = out.get(key) ?? { key, name: e.card.name, need: 0, proxies: 0, listed: [] };
    w.need += e.quantity;
    w.proxies += Math.min(e.proxies, e.quantity);
    w.listed.push({ card: e.card, finish: e.finish, commander: e.commander });
    out.set(key, w);
  }
  return out;
}

interface PullRow { cardId: string; finish: Finish; fromLocation: string; quantity: number; data: string }

function pullsOf(listId: string): Array<PullRow & { key: string; card: ScryfallCard }> {
  return (database().all(
    `SELECT dp.cardId, dp.finish, dp.fromLocation, dp.quantity, c.data FROM deck_pulls dp
     JOIN cards c ON c.id = dp.cardId WHERE dp.listId = ?`, [listId],
  ) as unknown as PullRow[]).map((r) => {
    const card = JSON.parse(r.data) as ScryfallCard;
    return { ...r, card, key: tagKey(card) };
  });
}

function profileOfList(listId: string): string | null {
  return (database().get('SELECT profileId FROM lists WHERE id = ?', [listId]) as { profileId: string } | null)?.profileId ?? null;
}

/** Where every card a deck wants is: in it, in a box, in another deck, or nowhere. */
export function ownership(list: Pick<List, 'id'>): Ownership {
  const profileId = profileOfList(list.id);
  const want = wants(list.id);
  const pulls = pullsOf(list.id);
  const boxes = profileId ? boxCopies(profileId) : [];
  const others = profileId ? deckCopies(profileId).filter((d) => d.listId !== list.id) : [];

  const cards: Holding[] = [];
  for (const w of want.values()) {
    const mine = pulls.filter((p) => p.key === w.key);
    const pulled = mine.reduce((n, p) => n + p.quantity, 0);
    const short = Math.max(0, w.need - pulled - w.proxies);
    const listedIds = new Set(w.listed.map((l) => l.card.id));
    const inBoxes = boxes.filter((b) => tagKey(b.card) === w.key)
      .map((b) => ({
        cardId: b.card.id, set: b.card.set ?? '', number: b.card.collector_number ?? '', finish: b.finish,
        location: b.location, quantity: b.quantity, exact: listedIds.has(b.card.id),
      }))
      .sort((a, b) => Number(b.exact) - Number(a.exact) || b.quantity - a.quantity);
    const byDeck = new Map<string, { listId: string; listName: string; quantity: number }>();
    for (const d of others.filter((o) => tagKey(o.card) === w.key)) {
      const e = byDeck.get(d.listId) ?? { listId: d.listId, listName: d.listName, quantity: 0 };
      e.quantity += d.quantity;
      byDeck.set(d.listId, e);
    }
    const inDecks = [...byDeck.values()];
    const boxed = inBoxes.reduce((n, b) => n + b.quantity, 0);
    const status: Status = short === 0
      ? (pulled > 0 ? 'in-deck' : 'proxy')
      : boxed > 0 ? 'in-box' : inDecks.length ? 'in-other-deck' : 'missing';
    const prices = w.listed.map((l) => priceOf(l.card, l.finish)).filter((p): p is number => p !== null);
    cards.push({
      key: w.key, name: w.name, need: w.need, pulled, proxies: w.proxies, short, status,
      pulledCopies: mine.map((p) => ({
        cardId: p.cardId, set: p.card.set ?? '', number: p.card.collector_number ?? '', finish: p.finish,
        fromLocation: p.fromLocation, quantity: p.quantity,
      })),
      inBoxes, inDecks,
      price: prices.length ? Math.min(...prices) : null,
      cardIds: w.listed.filter((l) => !l.commander).map((l) => l.card.id),
      commander: w.listed.some((l) => l.commander),
      image: imageOf(w.listed[0].card, 'small'),
    });
  }
  cards.sort((a, b) => a.name.localeCompare(b.name));

  const summary = { need: 0, inDeck: 0, proxies: 0, inBoxes: 0, inOtherDecks: 0, missing: 0, missingCost: 0 };
  for (const h of cards) {
    summary.need += h.need;
    summary.inDeck += Math.min(h.pulled, h.need);
    summary.proxies += h.proxies;
    const boxed = Math.min(h.short, h.inBoxes.reduce((n, b) => n + b.quantity, 0));
    const fromDecks = Math.min(h.short - boxed, h.inDecks.reduce((n, d) => n + d.quantity, 0));
    const missing = h.short - boxed - fromDecks;
    summary.inBoxes += boxed;
    summary.inOtherDecks += fromDecks;
    summary.missing += missing;
    summary.missingCost += missing * (h.price ?? 0);
  }
  summary.missingCost = Math.round(summary.missingCost * 100) / 100;
  return { cards, summary };
}

function recordPull(listId: string, cardId: string, finish: Finish, fromLocation: string, quantity: number): void {
  database().run(
    `INSERT INTO deck_pulls (listId, cardId, finish, fromLocation, quantity) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(listId, cardId, finish, fromLocation) DO UPDATE SET quantity = quantity + excluded.quantity`,
    [listId, cardId, finish, fromLocation, quantity],
  );
}

function dropPull(listId: string, cardId: string, finish: Finish, fromLocation: string, quantity: number): void {
  const db = database();
  db.run(
    `UPDATE deck_pulls SET quantity = quantity - ? WHERE listId = ? AND cardId = ? AND finish = ? AND fromLocation = ?`,
    [quantity, listId, cardId, finish, fromLocation],
  );
  db.run('DELETE FROM deck_pulls WHERE listId = ? AND quantity <= 0', [listId]);
}

/**
 * Take copies of a card from the boxes into the deck: as many as it is short,
 * or `quantity`. The deck's own printing and finish first, then the rest. A
 * given box can be asked for. Answers how many were taken.
 */
export function pull(listId: string, key: string, quantity?: number, from?: { cardId: string; finish: Finish; location: string }): number {
  const profileId = profileOfList(listId);
  if (!profileId) return 0;
  return tx(() => {
    const holding = ownership({ id: listId }).cards.find((h) => h.key === key);
    if (!holding) return 0;
    let left = Math.min(quantity ?? holding.short, holding.short);
    let taken = 0;
    const sources = from
      ? holding.inBoxes.filter((b) => b.cardId === from.cardId && b.finish === from.finish && b.location === from.location)
      : holding.inBoxes;
    for (const b of sources) {
      if (left <= 0) break;
      const n = Math.min(left, b.quantity);
      changeCount(profileId, b.cardId, b.finish, b.location, -n);
      recordPull(listId, b.cardId, b.finish, b.location, n);
      left -= n;
      taken += n;
    }
    return taken;
  });
}

/** Pull everything the boxes can supply. Answers how many copies moved. */
export function pullAll(listId: string): number {
  return tx(() => ownership({ id: listId }).cards.filter((h) => h.status === 'in-box').reduce((n, h) => n + pull(listId, h.key), 0));
}

/** Take copies of a card out of another deck and into this one. */
export function takeFromDeck(listId: string, fromListId: string, key: string, quantity?: number): number {
  if (profileOfList(listId) !== profileOfList(fromListId)) return 0;
  return tx(() => {
    const holding = ownership({ id: listId }).cards.find((h) => h.key === key);
    if (!holding) return 0;
    let left = Math.min(quantity ?? holding.short, holding.short);
    let taken = 0;
    for (const p of pullsOf(fromListId).filter((x) => x.key === key)) {
      if (left <= 0) break;
      const n = Math.min(left, p.quantity);
      dropPull(fromListId, p.cardId, p.finish, p.fromLocation, n);
      recordPull(listId, p.cardId, p.finish, p.fromLocation, n);
      left -= n;
      taken += n;
    }
    return taken;
  });
}

/**
 * Put a deck's copies back in the collection - of one card, or all of them -
 * into the box each came from, or into `to`. Answers how many went back.
 */
export function giveBack(listId: string, key: string | null = null, quantity?: number, to?: string): number {
  const profileId = profileOfList(listId);
  if (!profileId) return 0;
  return tx(() => {
    let left = quantity ?? Infinity;
    let back = 0;
    for (const p of pullsOf(listId).filter((x) => key === null || x.key === key)) {
      if (left <= 0) break;
      const n = Math.min(left, p.quantity);
      dropPull(listId, p.cardId, p.finish, p.fromLocation, n);
      const location = to ?? p.fromLocation;
      if (location !== UNSORTED) addLocation(profileId, location);
      changeCount(profileId, p.cardId, p.finish, location, n);
      left -= n;
      back += n;
    }
    return back;
  });
}

/**
 * Return copies the deck no longer wants to the box they came from: after a
 * card is cut, its count lowered, it moves to the maybeboard, the commander
 * changes, or the list is pasted over. Proxies count as filling a slot, so
 * marking one returns a real copy if the deck then has too many.
 */
export function settle(listId: string): number {
  return tx(() => {
    const want = wants(listId);
    const byKey = new Map<string, number>();
    for (const p of pullsOf(listId)) byKey.set(p.key, (byKey.get(p.key) ?? 0) + p.quantity);
    let back = 0;
    for (const [key, pulled] of byKey) {
      const w = want.get(key);
      const room = w ? Math.max(0, w.need - w.proxies) : 0;
      if (pulled > room) back += giveBack(listId, key, pulled - room);
    }
    return back;
  });
}

/** How many of a deck row's copies are proxies. */
export function setProxies(listId: string, cardId: string, proxies: number): void {
  tx(() => {
    database().run('UPDATE list_cards SET proxies = MAX(0, MIN(?, quantity)) WHERE listId = ? AND cardId = ?', [proxies, listId, cardId]);
    settle(listId);
  });
}

/** A text list of what to fetch from which box, and what to buy. */
export function fetchList(o: Ownership): { fetch: string; buy: string } {
  const byBox = new Map<string, string[]>();
  const buy: string[] = [];
  for (const h of o.cards) {
    let left = h.short;
    for (const b of h.inBoxes) {
      if (left <= 0) break;
      const n = Math.min(left, b.quantity);
      const label = b.location || 'Unsorted';
      byBox.set(label, [...(byBox.get(label) ?? []), `${n} ${h.name} (${b.set.toUpperCase()}) ${b.number}${b.finish === 'foil' ? ' *F*' : b.finish === 'etched' ? ' *E*' : ''}`]);
      left -= n;
    }
    for (const d of h.inDecks) {
      if (left <= 0) break;
      const n = Math.min(left, d.quantity);
      const label = `In ${d.listName}`;
      byBox.set(label, [...(byBox.get(label) ?? []), `${n} ${h.name}`]);
      left -= n;
    }
    if (left > 0) buy.push(`${left} ${h.name}`);
  }
  const fetch = [...byBox].map(([box, lines]) => `${box}:\n${lines.join('\n')}`).join('\n\n');
  return { fetch, buy: buy.join('\n') };
}

/** The collection page's data: copies in boxes, copies in decks, the boxes, and totals. Cards slimmed to send. */
export function collectionState(profile: string) {
  const boxes = boxCopies(profile).map((c) => ({ ...c, card: slimCard(c.card) }));
  const decks = deckCopies(profile).map((c) => ({ ...c, card: slimCard(c.card) }));
  const all = [...boxes, ...decks];
  const value = all.reduce((sum, c) => sum + c.quantity * (priceOf(c.card, c.finish) ?? 0), 0);
  return {
    boxes, decks, locations: locations(profile),
    totals: {
      copies: all.reduce((n, c) => n + c.quantity, 0),
      unique: new Set(all.map((c) => c.card.oracle_id ?? c.card.id)).size,
      inDecks: decks.reduce((n, c) => n + c.quantity, 0),
      value: Math.round(value * 100) / 100,
    },
  };
}


/** How many copies of each card a profile owns (in boxes and decks), by card id, for search results. */
export function ownedCounts(profileId: string | null, cards: ScryfallCard[]): Record<string, number> {
  if (!profileId || !cards.length) return {};
  const db = database();
  const counts = new Map<string, number>();
  const rows = [
    ...db.all(
      `SELECT json_extract(c.data, '$.oracle_id') AS oracle, cc.cardId, SUM(cc.quantity) AS n FROM collection_cards cc
       JOIN cards c ON c.id = cc.cardId WHERE cc.profileId = ? GROUP BY cc.cardId`, [profileId],
    ),
    ...db.all(
      `SELECT json_extract(c.data, '$.oracle_id') AS oracle, dp.cardId, SUM(dp.quantity) AS n FROM deck_pulls dp
       JOIN lists l ON l.id = dp.listId JOIN cards c ON c.id = dp.cardId WHERE l.profileId = ? GROUP BY dp.cardId`, [profileId],
    ),
  ] as Array<{ oracle: string | null; cardId: string; n: number }>;
  for (const r of rows) {
    const key = r.oracle ?? r.cardId;
    counts.set(key, (counts.get(key) ?? 0) + r.n);
  }
  const out: Record<string, number> = {};
  for (const card of cards) {
    const n = counts.get(tagKey(card));
    if (n) out[card.id] = n;
  }
  return out;
}
