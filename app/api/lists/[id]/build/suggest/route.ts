/**
 * GET ?role=wipe&owned=1&max=10: cards to fill a gap in the deck - cards in
 * the role, in the commander's colours, legal, not already in the deck -
 * ranked by how often this commander's decks play them on EDHREC (or how
 * popular they are in Commander overall), with the ones the profile owns
 * first when asked. From the card data on the Pi; no model.
 */

import { NextResponse } from 'next/server';

import { localCardsByOracle, searchLocalText } from '@/lib/card-store';
import { cardsInList, database } from '@/lib/db';
import { commanderPage, edhrecEnabled } from '@/lib/edhrec';
import { requireList } from '@/lib/profile-route';
import { ROLES } from '@/lib/roles';
import { imageOf, type ScryfallCard } from '@/lib/scryfall';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SHOW = 12;
const front = (name: string) => name.split(' // ')[0];

/** Where the profile has a copy of each card, by oracle id: a box, or another deck. */
function holdings(profileId: string, listId: string): Map<string, string> {
  const d = database();
  const where = new Map<string, string>();
  const oracleOf = (data: string) => (JSON.parse(data) as ScryfallCard).oracle_id ?? '';
  for (const row of d.all(`SELECT c.data, cc.location FROM collection_cards cc JOIN cards c ON c.id = cc.cardId WHERE cc.profileId = ? AND cc.quantity > 0`, [profileId]) as Array<{ data: string; location: string }>) {
    where.set(oracleOf(row.data), row.location ? `yours, ${row.location}` : 'yours');
  }
  for (const row of d.all(`SELECT c.data, l.name FROM list_cards lc JOIN lists l ON l.id = lc.listId JOIN cards c ON c.id = lc.cardId
    WHERE l.profileId = ? AND l.id != ? AND l.kind = 'deck'`, [profileId, listId]) as Array<{ data: string; name: string }>) {
    const o = oracleOf(row.data);
    if (!where.has(o)) where.set(o, `in ${row.name}`);
  }
  return where;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const { list, profile } = owned;
  const q = new URL(request.url).searchParams;
  const roleId = q.get('role') ?? '';
  const role = ROLES.find((r) => r.id === roleId);
  if (!role) return NextResponse.json({ error: 'No such role' }, { status: 400 });
  const max = Number(q.get('max')) || null;
  const ownedFirst = q.get('owned') === '1';

  // Cards in the role: tag roles from the saved roles, text roles by their text.
  let candidates: ScryfallCard[];
  if (role.text && !role.tag) {
    candidates = searchLocalText(role.text);
  } else {
    const ids = (database().all('SELECT oracleId FROM card_roles WHERE role = ?', [role.id]) as Array<{ oracleId: string }>).map((r) => r.oracleId);
    candidates = localCardsByOracle(ids);
  }

  const identity = new Set(list.commander?.color_identity ?? []);
  const inDeck = new Set(cardsInList(id).map((c) => front(c.card.name)));
  if (list.commander) inDeck.add(front(list.commander.name));
  const where = holdings(profile, id);
  const page = list.commander && edhrecEnabled() ? await commanderPage(list.commander.name).catch(() => null) : null;

  const fits = candidates.filter((c) => (c.color_identity ?? []).every((x) => identity.has(x))
    && c.legalities?.commander === 'legal'
    && !/\bLand\b/.test(c.type_line ?? '')
    && !inDeck.has(front(c.name))
    && (max === null || Number(c.prices?.usd ?? 0) <= max));

  const scored = fits.map((c) => {
    const stats = page?.stats.get(front(c.name)) ?? page?.stats.get(c.name);
    return { card: c, inclusion: stats?.inclusion ?? null, rank: (c as { edhrec_rank?: number }).edhrec_rank ?? 1e9, held: where.get(c.oracle_id ?? '') ?? null };
  }).sort((a, b) => (ownedFirst ? Number(!!b.held) - Number(!!a.held) : 0)
    || (b.inclusion ?? -1) - (a.inclusion ?? -1)
    || a.rank - b.rank);

  return NextResponse.json({
    role: { id: role.id, label: role.label },
    source: page ? 'edhrec' : 'popularity',
    cards: scored.slice(0, SHOW).map((s) => ({
      id: s.card.id, name: s.card.name, image: imageOf(s.card, 'small'), price: s.card.prices?.usd ?? null,
      typeLine: s.card.type_line ?? '', cmc: s.card.cmc ?? 0, held: s.held,
      why: s.inclusion !== null
        ? `In ${Math.round(s.inclusion * 100)}% of ${front(list.commander!.name)} decks on EDHREC`
        : `Popular in Commander (#${s.rank.toLocaleString()} on EDHREC)`,
    })),
  });
}
