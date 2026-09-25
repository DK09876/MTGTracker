/**
 * Arranging a deck's cards for display: which group each card falls in,
 * and the order within groups. Pure, so it is tested without a browser.
 *
 * Grouping by type uses a card's main type the way deck sites do - an
 * artifact creature is a creature, a land creature is a creature - and the
 * front face of a double-faced card.
 */

import type { Finish, ScryfallCard } from './scryfall';
import { priceOf } from './scryfall';

export type GroupBy = 'type' | 'mv' | 'tag' | 'role' | 'none';
export type SortBy = 'name' | 'mv' | 'price';

export interface Item {
  card: ScryfallCard;
  quantity: number;
  finish: Finish;
  commander?: boolean;
}

export interface Group<T extends Item> {
  key: string;
  label: string;
  items: T[];
  /** Copies in the group, counting quantities. */
  count: number;
  /** A tag's colour, for its heading. */
  color?: string;
}

// The order deck sites list types in; the first that matches wins.
const TYPES: Array<[string, string]> = [
  ['Creature', 'Creatures'],
  ['Planeswalker', 'Planeswalkers'],
  ['Battle', 'Battles'],
  ['Instant', 'Instants'],
  ['Sorcery', 'Sorceries'],
  ['Artifact', 'Artifacts'],
  ['Enchantment', 'Enchantments'],
  ['Land', 'Lands'],
];

const typeLine = (card: ScryfallCard) => card.card_faces?.[0]?.type_line ?? card.type_line ?? '';

/** The group a card is listed under when grouping by type. */
export function primaryType(card: ScryfallCard): string {
  const line = typeLine(card).split('—')[0];
  return TYPES.find(([type]) => line.includes(type))?.[1] ?? 'Other';
}

const isLand = (card: ScryfallCard) => primaryType(card) === 'Lands';

/**
 * Groups a card can be in several of at once - the deck's tags, or its
 * roles. `order` lists them in the order shown; a card in none of them
 * goes under `none`, last.
 */
export interface Categories {
  of: (card: ScryfallCard) => string[];
  order: Array<{ key: string; label: string; color?: string }>;
  none: string;
}

function compare(sortBy: SortBy) {
  return (a: Item, b: Item) => {
    if (sortBy === 'mv') return (a.card.cmc ?? 0) - (b.card.cmc ?? 0) || a.card.name.localeCompare(b.card.name);
    if (sortBy === 'price') {
      return (priceOf(b.card, b.finish) ?? -1) - (priceOf(a.card, a.finish) ?? -1) || a.card.name.localeCompare(b.card.name);
    }
    return a.card.name.localeCompare(b.card.name);
  };
}

/**
 * Cards in groups, each sorted. The commander always gets a group of its own,
 * first; empty groups are left out.
 */
export function groupCards<T extends Item>(items: T[], groupBy: GroupBy, sortBy: SortBy, categories?: Categories): Group<T>[] {
  // Tags and roles need their categories; until they arrive, one plain group.
  if ((groupBy === 'tag' || groupBy === 'role') && !categories) groupBy = 'none';
  const labels = new Map(categories?.order.map((c) => [c.key, c.label]));
  const order: string[] = [];
  const buckets = new Map<string, { label: string; items: T[] }>();
  const put = (key: string, label: string, item: T) => {
    if (!buckets.has(key)) { buckets.set(key, { label, items: [] }); order.push(key); }
    buckets.get(key)!.items.push(item);
  };

  for (const item of items) {
    if (item.commander) { put('commander', 'Commander', item); continue; }
    if (groupBy === 'type') {
      const label = primaryType(item.card);
      put(label, label, item);
    } else if (groupBy === 'tag' || groupBy === 'role') {
      // A card with several tags is listed under each of them.
      const keys = categories!.of(item.card).filter((k) => labels.has(k));
      if (!keys.length) put('none', categories!.none, item);
      for (const key of keys) put(key, labels.get(key)!, item);
    } else if (groupBy === 'mv') {
      if (isLand(item.card)) { put('lands', 'Lands', item); continue; }
      const mv = Math.min(7, Math.floor(item.card.cmc ?? 0));
      put(`mv-${mv}`, mv === 7 ? 'Mana value 7+' : `Mana value ${mv}`, item);
    } else {
      put('all', 'Cards', item);
    }
  }

  // Groups in a fixed order: commander, then types or mana values ascending, then lands.
  const rank = (key: string) => {
    if (key === 'commander') return -1;
    if (groupBy === 'type') { const i = TYPES.findIndex(([, label]) => label === key); return i < 0 ? TYPES.length : i; }
    if (groupBy === 'tag' || groupBy === 'role') {
      if (key === 'none') return 100_000;
      return categories!.order.findIndex((c) => c.key === key);
    }
    if (key === 'lands') return 100;
    return key.startsWith('mv-') ? Number(key.slice(3)) : 50;
  };
  return order
    .sort((a, b) => rank(a) - rank(b))
    .map((key) => {
      const { label, items: grouped } = buckets.get(key)!;
      const color = categories?.order.find((c) => c.key === key)?.color;
      return {
        key, label, items: [...grouped].sort(compare(sortBy)), count: grouped.reduce((n, i) => n + i.quantity, 0),
        ...(color ? { color } : {}),
      };
    });
}
