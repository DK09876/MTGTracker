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

import { isProxy } from './copy-variant';
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
  /** Copies decks took from it: with `count`, everything that belongs to it. */
  inDecks: number;
}

/** Copies of one printing, in one finish and variant, in one box. */
export interface BoxCopies {
  card: ScryfallCard;
  finish: Finish;
  location: string;
  /** Language, condition, proxy and the like (copy-variant.ts); '' for a plain copy. */
  variant: string;
  quantity: number;
  addedAt: string;
  purchasePrice: number | null;
}

/** Copies a deck has taken. */
export interface DeckCopies {
  listId: string;
  listName: string;
  card: ScryfallCard;
  finish: Finish;
  fromLocation: string;
  variant: string;
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
  const pulled = new Map((db.all(
    `SELECT dp.fromLocation AS location, SUM(dp.quantity) AS n FROM deck_pulls dp JOIN lists l ON l.id = dp.listId
     WHERE l.profileId = ? GROUP BY dp.fromLocation`, [profileId],
  ) as Array<{ location: string; n: number }>).map((r) => [r.location, r.n]));
  const at = (name: string) => ({ count: counts.get(name) ?? 0, inDecks: pulled.get(name) ?? 0 });
  const out: Location[] = [{ name: UNSORTED, kind: 'box', ...at(UNSORTED) }];
  for (const l of named) out.push({ ...l, ...at(l.name) });
  // A location named in an import but never made still shows.
  for (const name of new Set([...counts.keys(), ...pulled.keys()])) {
    if (name !== UNSORTED && !named.some((l) => l.name === name)) out.push({ name, kind: 'box', ...at(name) });
  }
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
    'SELECT cardId, finish, variant, quantity FROM collection_cards WHERE profileId = ? AND location = ?', [profileId, from],
  ) as Array<{ cardId: string; finish: Finish; variant: string; quantity: number }>;
  for (const r of rows) {
    changeCount(profileId, r.cardId, r.finish, from, -r.quantity, r.variant);
    changeCount(profileId, r.cardId, r.finish, to, r.quantity, r.variant);
  }
}

// --- copies in boxes ----------------------------------------------------------

/** Add or take away copies in one box; a count that reaches zero removes the row. */
function changeCount(
  profileId: string, cardId: string, finish: Finish, location: string, delta: number, variant = '', purchasePrice: number | null = null,
): number {
  const db = database();
  const where = 'profileId = ? AND cardId = ? AND finish = ? AND location = ? AND variant = ?';
  const key = [profileId, cardId, finish, location, variant];
  const row = db.get(`SELECT quantity FROM collection_cards WHERE ${where}`, key) as { quantity: number } | null;
  const next = Math.max(0, (row?.quantity ?? 0) + delta);
  if (row && next === 0) {
    db.run(`DELETE FROM collection_cards WHERE ${where}`, key);
  } else if (row) {
    db.run(`UPDATE collection_cards SET quantity = ? WHERE ${where}`, [next, ...key]);
  } else if (next > 0) {
    db.run('INSERT INTO collection_cards (profileId, cardId, finish, location, variant, quantity, addedAt, purchasePrice) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [profileId, cardId, finish, location, variant, next, now(), purchasePrice]);
  }
  return next;
}

/** Add copies to the collection. Answers how many are in that box now. */
export function addToCollection(
  profileId: string, card: ScryfallCard, quantity = 1, finish: Finish = 'nonfoil', location = UNSORTED,
  extra: { variant?: string; kind?: LocationKind; purchasePrice?: number | null } = {},
): number {
  return tx(() => {
    storeCard(card);
    if (location !== UNSORTED) addLocation(profileId, location, extra.kind);
    return changeCount(profileId, card.id, finish, location, quantity, extra.variant ?? '', extra.purchasePrice ?? null);
  });
}

export interface CollectionItem {
  card: ScryfallCard;
  quantity: number;
  finish: Finish;
  location: string;
  variant?: string;
  kind?: LocationKind;
  purchasePrice?: number | null;
}

/** Many cards at once, for an import: one transaction. */
export function addManyToCollection(profileId: string, items: CollectionItem[]): void {
  tx(() => {
    for (const i of items) addToCollection(profileId, i.card, i.quantity, i.finish, i.location, i);
  });
}

/**
 * Empty a profile's collection before importing it again from another app:
 * every copy in its boxes, the boxes, and what its decks had taken (the
 * decks keep their cards; they are no longer linked to copies).
 */
export function clearCollection(profileId: string): void {
  tx(() => {
    const db = database();
    db.run('DELETE FROM collection_cards WHERE profileId = ?', [profileId]);
    db.run('DELETE FROM collection_locations WHERE profileId = ?', [profileId]);
    db.run('DELETE FROM deck_pulls WHERE listId IN (SELECT id FROM lists WHERE profileId = ?)', [profileId]);
  });
}

/** When this exact file was last imported into the profile, if it was. */
export function importedBefore(profileId: string, hash: string): { at: string; copies: number; mode: string } | null {
  return database().get('SELECT at, copies, mode FROM collection_imports WHERE profileId = ? AND hash = ?', [profileId, hash]) as
    { at: string; copies: number; mode: string } | null;
}

export function recordImport(profileId: string, hash: string, format: string, copies: number, mode: string): void {
  database().run(
    `INSERT INTO collection_imports (profileId, hash, format, copies, mode, at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(profileId, hash) DO UPDATE SET copies = excluded.copies, mode = excluded.mode, at = excluded.at`,
    [profileId, hash, format, copies, mode, now()],
  );
}

/** Set how many copies are in one box; zero removes them. */
export function setCollectionCount(profileId: string, cardId: string, finish: Finish, location: string, quantity: number, variant = ''): void {
  tx(() => {
    const row = database().get(
      'SELECT quantity FROM collection_cards WHERE profileId = ? AND cardId = ? AND finish = ? AND location = ? AND variant = ?',
      [profileId, cardId, finish, location, variant],
    ) as { quantity: number } | null;
    changeCount(profileId, cardId, finish, location, Math.max(0, quantity) - (row?.quantity ?? 0), variant);
  });
}

/** Move copies to another box, or relabel their finish. */
export function moveCopies(
  profileId: string, from: { cardId: string; finish: Finish; location: string; variant?: string },
  to: { finish?: Finish; location?: string }, quantity: number,
): number {
  const variant = from.variant ?? '';
  return tx(() => {
    const row = database().get(
      'SELECT quantity FROM collection_cards WHERE profileId = ? AND cardId = ? AND finish = ? AND location = ? AND variant = ?',
      [profileId, from.cardId, from.finish, from.location, variant],
    ) as { quantity: number } | null;
    const n = Math.min(quantity, row?.quantity ?? 0);
    if (n <= 0) return 0;
    const location = to.location ?? from.location;
    if (location !== UNSORTED) addLocation(profileId, location);
    changeCount(profileId, from.cardId, from.finish, from.location, -n, variant);
    changeCount(profileId, from.cardId, to.finish ?? from.finish, location, n, variant);
    return n;
  });
}

/** Everything in the profile's boxes. */
export function boxCopies(profileId: string): BoxCopies[] {
  return (database().all(
    `SELECT cc.finish, cc.location, cc.variant, cc.quantity, cc.addedAt, cc.purchasePrice, c.data FROM collection_cards cc
     JOIN cards c ON c.id = cc.cardId WHERE cc.profileId = ? ORDER BY c.name`, [profileId],
  ) as Array<{ finish: Finish; location: string; variant: string; quantity: number; addedAt: string; purchasePrice: number | null; data: string }>)
    .map(({ data, ...r }) => ({ ...r, card: JSON.parse(data) as ScryfallCard }));
}

/** Everything the profile's decks have taken. */
export function deckCopies(profileId: string): DeckCopies[] {
  return (database().all(
    `SELECT dp.listId, l.name AS listName, dp.finish, dp.fromLocation, dp.variant, dp.quantity, c.data FROM deck_pulls dp
     JOIN lists l ON l.id = dp.listId JOIN cards c ON c.id = dp.cardId
     WHERE l.profileId = ? ORDER BY c.name`, [profileId],
  ) as Array<{ listId: string; listName: string; finish: Finish; fromLocation: string; variant: string; quantity: number; data: string }>)
    .map(({ data, ...r }) => ({ ...r, card: JSON.parse(data) as ScryfallCard }));
}

// --- decks and the copies they take ----------------------------------------------

export type Status = 'in-deck' | 'proxy' | 'in-box' | 'in-other-deck' | 'missing' | 'basic';

/** One card a deck wants, and where its copies are. */
export interface Holding {
  key: string;
  name: string;
  /** Copies the deck wants. */
  need: number;
  /** Copies in the deck - taken from the collection, real or proxy. */
  pulled: number;
  /** Copies standing in as proxies: marked on the deck, or proxy copies taken from a box. */
  proxies: number;
  /** Still to find: need less pulled and marked proxies. */
  short: number;
  status: Status;
  /** 'main' for the 100; a sideboard or maybeboard card shows only for copies the deck holds. */
  board: 'main' | 'side' | 'maybe';
  pulledCopies: Array<{ cardId: string; set: string; number: string; finish: Finish; fromLocation: string; variant: string; quantity: number }>;
  /** Copies in the profile's boxes, best match first. */
  inBoxes: Array<{ cardId: string; set: string; number: string; finish: Finish; location: string; variant: string; quantity: number; exact: boolean }>;
  /** Copies other decks hold. */
  inDecks: Array<{ listId: string; listName: string; quantity: number }>;
  /** What one copy costs, in the printing and finish the deck lists. */
  price: number | null;
  /** The deck's rows for this card (printing ids), for marking proxies. */
  cardIds: string[];
  commander: boolean;
  /** A basic land: the collection need not track these, so one not found is not missing. */
  basic: boolean;
  image: string | null;
}

export interface Ownership {
  cards: Holding[];
  summary: {
    need: number;
    /** Real copies in the deck. */
    inDeck: number;
    proxies: number;
    /** Short copies that are sitting in a box, ready to pull. */
    inBoxes: number;
    /** Short copies only other decks have. */
    inOtherDecks: number;
    missing: number;
    /** Basic lands the collection does not track: not counted as missing. */
    basics: number;
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

interface Wants {
  /** The main board, the commander and the companion. */
  main: Map<string, Want>;
  /** Sideboard and maybeboard cards: a deck keeps copies of these only on purpose (`kept`), up to the count listed. */
  extra: Map<string, Want & { board: 'side' | 'maybe' }>;
}

const isBasic = (card: ScryfallCard) => /\bBasic\b/.test(card.type_line ?? '') && /\bLand\b/.test(card.type_line ?? '');

/** What a deck wants, by card. Plain lists want nothing. */
function wants(listId: string): Wants {
  const db = database();
  const list = db.get('SELECT kind, commanderId, commanderFinish FROM lists WHERE id = ?', [listId]) as
    { kind: string; commanderId: string | null; commanderFinish: Finish } | null;
  const out: Wants = { main: new Map(), extra: new Map() };
  if (!list || list.kind !== 'deck') return out;
  const rows = db.all(
    `SELECT c.data, lc.quantity, lc.finish, lc.proxies, lc.board, lc.slot FROM list_cards lc JOIN cards c ON c.id = lc.cardId
     WHERE lc.listId = ? AND lc.board IN ('main', 'side', 'maybe')`, [listId],
  ) as Array<{ data: string; quantity: number; finish: Finish; proxies: number; board: string; slot: string | null }>;
  const commander = list.commanderId
    ? db.get('SELECT data FROM cards WHERE id = ?', [list.commanderId]) as { data: string } | null
    : null;
  const entries = rows.map((r) => ({
    card: JSON.parse(r.data) as ScryfallCard, quantity: r.quantity, finish: r.finish, proxies: r.proxies, commander: false,
    board: (r.board === 'main' || r.slot === 'companion' ? 'main' : r.board) as 'main' | 'side' | 'maybe',
  }));
  if (commander) entries.push({ card: JSON.parse(commander.data) as ScryfallCard, quantity: 1, finish: list.commanderFinish, proxies: 0, commander: true, board: 'main' });
  for (const e of entries) {
    const key = tagKey(e.card);
    const into = (e.board === 'main' ? out.main : out.extra) as Map<string, Want & { board: 'side' | 'maybe' }>;
    const w = into.get(key) ?? { key, name: e.card.name, need: 0, proxies: 0, listed: [], board: e.board as 'side' };
    w.need += e.quantity;
    w.proxies += Math.min(e.proxies, e.quantity);
    w.listed.push({ card: e.card, finish: e.finish, commander: e.commander });
    into.set(key, w);
  }
  return out;
}

interface PullRow { cardId: string; finish: Finish; fromLocation: string; variant: string; quantity: number; kept: number; data: string }

function pullsOf(listId: string): Array<PullRow & { key: string; card: ScryfallCard }> {
  return (database().all(
    `SELECT dp.cardId, dp.finish, dp.fromLocation, dp.variant, dp.quantity, dp.kept, c.data FROM deck_pulls dp
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

  const holding = (w: Want, board: Holding['board']): Holding => {
    const mine = pulls.filter((p) => p.key === w.key);
    const pulled = mine.reduce((n, p) => n + p.quantity, 0);
    const proxyPulls = mine.filter((p) => isProxy(p.variant)).reduce((n, p) => n + p.quantity, 0);
    const short = Math.max(0, w.need - pulled - w.proxies);
    const listedIds = new Set(w.listed.map((l) => l.card.id));
    const inBoxes = boxes.filter((b) => tagKey(b.card) === w.key)
      .map((b) => ({
        cardId: b.card.id, set: b.card.set ?? '', number: b.card.collector_number ?? '', finish: b.finish,
        location: b.location, variant: b.variant, quantity: b.quantity, exact: listedIds.has(b.card.id),
      }))
      // A real copy before a proxy, the deck's printing first, then the biggest pile.
      .sort((a, b) => Number(isProxy(a.variant)) - Number(isProxy(b.variant)) || Number(b.exact) - Number(a.exact) || b.quantity - a.quantity);
    const byDeck = new Map<string, { listId: string; listName: string; quantity: number }>();
    for (const d of others.filter((o) => tagKey(o.card) === w.key)) {
      const e = byDeck.get(d.listId) ?? { listId: d.listId, listName: d.listName, quantity: 0 };
      e.quantity += d.quantity;
      byDeck.set(d.listId, e);
    }
    const inDecks = [...byDeck.values()];
    const boxed = inBoxes.reduce((n, b) => n + b.quantity, 0);
    const basic = w.listed.some((l) => isBasic(l.card));
    // Other decks' basic lands are not worth taking: a basic not in a box is just "basic".
    const status: Status = short === 0
      ? (pulled - proxyPulls > 0 ? 'in-deck' : 'proxy')
      : boxed > 0 ? 'in-box' : basic ? 'basic' : inDecks.length ? 'in-other-deck' : 'missing';
    const prices = w.listed.map((l) => priceOf(l.card, l.finish)).filter((p): p is number => p !== null);
    return {
      key: w.key, name: w.name, need: w.need, pulled, proxies: w.proxies + proxyPulls, short, status, board,
      pulledCopies: mine.map((p) => ({
        cardId: p.cardId, set: p.card.set ?? '', number: p.card.collector_number ?? '', finish: p.finish,
        fromLocation: p.fromLocation, variant: p.variant, quantity: p.quantity,
      })),
      inBoxes, inDecks,
      price: prices.length ? Math.min(...prices) : null,
      cardIds: w.listed.filter((l) => !l.commander).map((l) => l.card.id),
      commander: w.listed.some((l) => l.commander),
      basic,
      image: imageOf(w.listed[0].card, 'small'),
    };
  };

  const cards: Holding[] = [...want.main.values()].map((w) => holding(w, 'main'));
  // Sideboard and maybeboard cards show only for the copies the deck holds.
  for (const w of want.extra.values()) {
    if (want.main.has(w.key)) continue;
    const held = pulls.filter((p) => p.key === w.key).reduce((n, p) => n + p.quantity, 0);
    if (held > 0) cards.push(holding({ ...w, need: Math.min(held, w.need), proxies: 0 }, w.board));
  }
  cards.sort((a, b) => a.name.localeCompare(b.name));

  const summary = { need: 0, inDeck: 0, proxies: 0, inBoxes: 0, inOtherDecks: 0, missing: 0, basics: 0, missingCost: 0 };
  for (const h of cards.filter((c) => c.board === 'main')) {
    summary.need += h.need;
    const real = Math.min(h.need, h.pulledCopies.filter((p) => !isProxy(p.variant)).reduce((n, p) => n + p.quantity, 0));
    summary.inDeck += real;
    summary.proxies += Math.min(h.proxies, h.need - real);
    const boxed = Math.min(h.short, h.inBoxes.reduce((n, b) => n + b.quantity, 0));
    const fromDecks = h.basic ? 0 : Math.min(h.short - boxed, h.inDecks.reduce((n, d) => n + d.quantity, 0));
    const missing = h.short - boxed - fromDecks;
    summary.inBoxes += boxed;
    summary.inOtherDecks += fromDecks;
    if (h.basic) summary.basics += missing;
    else {
      summary.missing += missing;
      summary.missingCost += missing * (h.price ?? 0);
    }
  }
  summary.missingCost = Math.round(summary.missingCost * 100) / 100;
  return { cards, summary };
}

function recordPull(listId: string, cardId: string, finish: Finish, fromLocation: string, quantity: number, variant = '', kept = false): void {
  database().run(
    `INSERT INTO deck_pulls (listId, cardId, finish, fromLocation, variant, quantity, kept) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(listId, cardId, finish, fromLocation, variant) DO UPDATE SET quantity = quantity + excluded.quantity, kept = MAX(kept, excluded.kept)`,
    [listId, cardId, finish, fromLocation, variant, quantity, kept ? 1 : 0],
  );
}

function dropPull(listId: string, cardId: string, finish: Finish, fromLocation: string, quantity: number, variant = ''): void {
  const db = database();
  db.run(
    `UPDATE deck_pulls SET quantity = quantity - ? WHERE listId = ? AND cardId = ? AND finish = ? AND fromLocation = ? AND variant = ?`,
    [quantity, listId, cardId, finish, fromLocation, variant],
  );
  db.run('DELETE FROM deck_pulls WHERE listId = ? AND quantity <= 0', [listId]);
}

export interface CopyRef { cardId: string; finish: Finish; location: string; variant?: string }

/**
 * Take copies of a card from the boxes into the deck: as many as it is short,
 * or `quantity`. Real copies of the deck's own printing and finish first,
 * then the rest. A given box (and copy) can be asked for. Answers how many
 * were taken.
 */
export function pull(listId: string, key: string, quantity?: number, from?: CopyRef): number {
  const profileId = profileOfList(listId);
  if (!profileId) return 0;
  return tx(() => {
    const holding = ownership({ id: listId }).cards.find((h) => h.key === key);
    if (!holding) return 0;
    let left = Math.min(quantity ?? holding.short, holding.short);
    let taken = 0;
    const sources = from
      ? holding.inBoxes.filter((b) => b.cardId === from.cardId && b.finish === from.finish && b.location === from.location
        && (from.variant === undefined || b.variant === from.variant))
      : holding.inBoxes;
    for (const b of sources) {
      if (left <= 0) break;
      const n = Math.min(left, b.quantity);
      changeCount(profileId, b.cardId, b.finish, b.location, -n, b.variant);
      recordPull(listId, b.cardId, b.finish, b.location, n, b.variant);
      left -= n;
      taken += n;
    }
    return taken;
  });
}

/**
 * Take one given copy out of its box and into a deck: for imports that say
 * exactly which copy a deck holds. `kept` marks a sideboard card's copy the
 * deck keeps with it on purpose, so settling leaves it there. Answers how
 * many were taken.
 */
export function pullExact(listId: string, from: CopyRef, quantity: number, kept = false): number {
  const profileId = profileOfList(listId);
  if (!profileId) return 0;
  const variant = from.variant ?? '';
  return tx(() => {
    const row = database().get(
      'SELECT quantity FROM collection_cards WHERE profileId = ? AND cardId = ? AND finish = ? AND location = ? AND variant = ?',
      [profileId, from.cardId, from.finish, from.location, variant],
    ) as { quantity: number } | null;
    const n = Math.min(quantity, row?.quantity ?? 0);
    if (n <= 0) return 0;
    changeCount(profileId, from.cardId, from.finish, from.location, -n, variant);
    recordPull(listId, from.cardId, from.finish, from.location, n, variant, kept);
    return n;
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
      dropPull(fromListId, p.cardId, p.finish, p.fromLocation, n, p.variant);
      recordPull(listId, p.cardId, p.finish, p.fromLocation, n, p.variant, false);
      left -= n;
      taken += n;
    }
    return taken;
  });
}

/**
 * Put a deck's copies back in the collection - of one card, or all of them -
 * into the box each came from, or into `to`. Proxy copies go back last.
 * Answers how many went back.
 */
export function giveBack(listId: string, key: string | null = null, quantity?: number, to?: string): number {
  const profileId = profileOfList(listId);
  if (!profileId) return 0;
  return tx(() => {
    let left = quantity ?? Infinity;
    let back = 0;
    // When only some go back, a deck keeps what it kept on purpose and its real copies, and returns proxies first.
    const rows = pullsOf(listId).filter((x) => key === null || x.key === key)
      .sort((a, b) => a.kept - b.kept || Number(isProxy(b.variant)) - Number(isProxy(a.variant)));
    for (const p of rows) {
      if (left <= 0) break;
      const n = Math.min(left, p.quantity);
      dropPull(listId, p.cardId, p.finish, p.fromLocation, n, p.variant);
      const location = to ?? p.fromLocation;
      if (location !== UNSORTED) addLocation(profileId, location);
      changeCount(profileId, p.cardId, p.finish, location, n, p.variant);
      left -= n;
      back += n;
    }
    return back;
  });
}

/**
 * Return copies the deck no longer wants to the box they came from: after a
 * card is cut, its count lowered, it leaves the deck's boards, the commander
 * changes, or the list is pasted over. Proxies count as filling a slot, so
 * marking one returns a real copy if the deck then has too many. A sideboard
 * or maybeboard card keeps the copies it was given on purpose, up to the
 * count listed; a card merely cut there gives its copy back.
 */
export function settle(listId: string): number {
  return tx(() => {
    const want = wants(listId);
    const byKey = new Map<string, { pulled: number; kept: number }>();
    for (const p of pullsOf(listId)) {
      const e = byKey.get(p.key) ?? { pulled: 0, kept: 0 };
      e.pulled += p.quantity;
      if (p.kept) e.kept += p.quantity;
      byKey.set(p.key, e);
    }
    let back = 0;
    for (const [key, { pulled, kept }] of byKey) {
      const w = want.main.get(key);
      const room = (w ? Math.max(0, w.need - w.proxies) : 0) + Math.min(kept, want.extra.get(key)?.need ?? 0);
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
      byBox.set(label, [...(byBox.get(label) ?? []), `${n} ${h.name} (${b.set.toUpperCase()}) ${b.number}${b.finish === 'foil' ? ' *F*' : b.finish === 'etched' ? ' *E*' : ''}${isProxy(b.variant) ? ' *P*' : ''}`]);
      left -= n;
    }
    for (const d of h.basic ? [] : h.inDecks) {
      if (left <= 0) break;
      const n = Math.min(left, d.quantity);
      const label = `In ${d.listName}`;
      byBox.set(label, [...(byBox.get(label) ?? []), `${n} ${h.name}`]);
      left -= n;
    }
    if (left > 0 && !h.basic) buy.push(`${left} ${h.name}`);
  }
  const fetch = [...byBox].map(([box, lines]) => `${box}:\n${lines.join('\n')}`).join('\n\n');
  return { fetch, buy: buy.join('\n') };
}

/** The collection page's data: copies in boxes, copies in decks, the boxes, and totals. Cards slimmed to send. */
export function collectionState(profile: string) {
  const boxes = boxCopies(profile).map((c) => ({ ...c, card: slimCard(c.card) }));
  const decks = deckCopies(profile).map((c) => ({ ...c, card: slimCard(c.card) }));
  const all = [...boxes, ...decks];
  // A proxy is counted as a copy (it is in a box or a deck) but has no value.
  const value = all.reduce((sum, c) => sum + (isProxy(c.variant) ? 0 : c.quantity * (priceOf(c.card, c.finish) ?? 0)), 0);
  const sum = (rows: Array<{ quantity: number }>) => rows.reduce((n, c) => n + c.quantity, 0);
  return {
    boxes, decks, locations: locations(profile),
    totals: {
      copies: sum(all),
      unique: new Set(all.map((c) => c.card.oracle_id ?? c.card.id)).size,
      inBoxes: sum(boxes),
      inDecks: sum(decks),
      proxies: sum(all.filter((c) => isProxy(c.variant))),
      value: Math.round(value * 100) / 100,
    },
  };
}


const NOT_PROXY = (t: string) => `(',' || ${t}.variant || ',') NOT LIKE '%,proxy,%'`;

/** How many copies of each card a profile owns (in boxes and decks, proxies aside), by card id, for search results. */
export function ownedCounts(profileId: string | null, cards: ScryfallCard[]): Record<string, number> {
  if (!profileId || !cards.length) return {};
  const db = database();
  const counts = new Map<string, number>();
  const rows = [
    ...db.all(
      `SELECT json_extract(c.data, '$.oracle_id') AS oracle, cc.cardId, SUM(cc.quantity) AS n FROM collection_cards cc
       JOIN cards c ON c.id = cc.cardId WHERE cc.profileId = ? AND ${NOT_PROXY('cc')} GROUP BY cc.cardId`, [profileId],
    ),
    ...db.all(
      `SELECT json_extract(c.data, '$.oracle_id') AS oracle, dp.cardId, SUM(dp.quantity) AS n FROM deck_pulls dp
       JOIN lists l ON l.id = dp.listId JOIN cards c ON c.id = dp.cardId WHERE l.profileId = ? AND ${NOT_PROXY('dp')} GROUP BY dp.cardId`, [profileId],
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
