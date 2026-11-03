/**
 * Cards to fill a role in a deck - in the role, in the commander's colours,
 * legal, not already in the deck - ranked by how often the commander's
 * decks play them on EDHREC (or how popular they are in Commander), with
 * where the profile already has a copy. From the card data on the Pi; no
 * model. Used by the Build tab and the deck chat. Server only.
 */

import { localCardsByOracle, localCards, searchLocalText } from './card-store';
import { cardsInList, database, type List } from './db';
import { commanderPage, edhrecEnabled } from './edhrec';
import { ROLES } from './roles';
import { imageOf, type ScryfallCard } from './scryfall';

export interface GapCard {
  id: string;
  name: string;
  image: string | null;
  price: string | null;
  typeLine: string;
  cmc: number;
  /** Where the profile has a copy: "yours, Box 2", "in Ulalek Eldrazi"; null if not owned. */
  held: string | null;
  why: string;
}

const front = (name: string) => name.split(' // ')[0];

/** Where the profile has a copy of each card, by oracle id: a box, or another deck. */
export function holdings(profileId: string, exceptList: string | null): Map<string, string> {
  const d = database();
  const where = new Map<string, string>();
  const oracleOf = (data: string) => (JSON.parse(data) as ScryfallCard).oracle_id ?? '';
  for (const row of d.all(`SELECT c.data, cc.location FROM collection_cards cc JOIN cards c ON c.id = cc.cardId WHERE cc.profileId = ? AND cc.quantity > 0`, [profileId]) as Array<{ data: string; location: string }>) {
    where.set(oracleOf(row.data), row.location ? `yours, ${row.location}` : 'yours');
  }
  for (const row of d.all(`SELECT c.data, l.name FROM list_cards lc JOIN lists l ON l.id = lc.listId JOIN cards c ON c.id = lc.cardId
    WHERE l.profileId = ? AND l.id != ? AND l.kind = 'deck'`, [profileId, exceptList ?? '']) as Array<{ data: string; name: string }>) {
    const o = oracleOf(row.data);
    if (!where.has(o)) where.set(o, `in ${row.name}`);
  }
  return where;
}

/** Where the profile holds each of these cards, by name. */
export function heldByName(profileId: string, exceptList: string | null, names: string[]): Record<string, string | null> {
  const where = holdings(profileId, exceptList);
  const byName = new Map(localCards(names).map((c) => [front(c.name).toLowerCase(), c.oracle_id ?? '']));
  return Object.fromEntries(names.map((n) => [n, where.get(byName.get(front(n).toLowerCase()) ?? '') ?? null]));
}

export async function gapCards(list: List, profileId: string, roleId: string, opts: { owned: boolean; max: number | null; show?: number }):
  Promise<{ role: { id: string; label: string }; source: 'edhrec' | 'popularity'; cards: GapCard[] }> {
  const role = ROLES.find((r) => r.id === roleId);
  if (!role) throw new Error(`No such role: ${roleId}`);
  const candidates = role.text && !role.tag
    ? searchLocalText(role.text)
    : localCardsByOracle((database().all('SELECT oracleId FROM card_roles WHERE role = ?', [role.id]) as Array<{ oracleId: string }>).map((r) => r.oracleId));

  const identity = new Set(list.commander?.color_identity ?? []);
  const inDeck = new Set(cardsInList(list.id).map((c) => front(c.card.name)));
  if (list.commander) inDeck.add(front(list.commander.name));
  const where = holdings(profileId, list.id);
  const page = list.commander && edhrecEnabled() ? await commanderPage(list.commander.name).catch(() => null) : null;

  const fits = candidates.filter((c) => (c.color_identity ?? []).every((x) => identity.has(x))
    && c.legalities?.commander === 'legal'
    && !/\bLand\b/.test(c.type_line ?? '')
    && !inDeck.has(front(c.name))
    && (opts.max === null || Number(c.prices?.usd ?? 0) <= opts.max));

  const scored = fits.map((c) => {
    const stats = page?.stats.get(front(c.name)) ?? page?.stats.get(c.name);
    return { card: c, inclusion: stats?.inclusion ?? null, rank: (c as { edhrec_rank?: number }).edhrec_rank ?? 1e9, held: where.get(c.oracle_id ?? '') ?? null };
  }).sort((a, b) => (opts.owned ? Number(!!b.held) - Number(!!a.held) : 0)
    || (b.inclusion ?? -1) - (a.inclusion ?? -1)
    || a.rank - b.rank);

  return {
    role: { id: role.id, label: role.label },
    source: page ? 'edhrec' : 'popularity',
    cards: scored.slice(0, opts.show ?? 12).map((s) => ({
      id: s.card.id, name: s.card.name, image: imageOf(s.card, 'small'), price: s.card.prices?.usd ?? null,
      typeLine: s.card.type_line ?? '', cmc: s.card.cmc ?? 0, held: s.held,
      why: s.inclusion !== null
        ? `In ${Math.round(s.inclusion * 100)}% of ${front(list.commander!.name)} decks on EDHREC`
        : `Popular in Commander (#${s.rank.toLocaleString()} on EDHREC)`,
    })),
  };
}
