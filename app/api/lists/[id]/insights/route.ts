/**
 * What a deck's list says about how it plays: its bracket floor, the
 * combos it has and is one card from (Commander Spellbook), and where to
 * look first for cuts (EDHREC and the role counts).
 *
 * Spellbook is asked twice per look, so answers are kept until the deck
 * changes: switching tabs does not ask again.
 */

import { NextResponse } from 'next/server';

import { bracketFloor } from '@/lib/bracket';
import { cutCandidates } from '@/lib/cuts';
import { cachedRoles, cardsInList, saveRoles } from '@/lib/db';
import { commanderPage, edhrecEnabled } from '@/lib/edhrec';
import { primaryType } from '@/lib/deckview';
import { requireList } from '@/lib/profile-route';
import { countRoles } from '@/lib/roles';
import { imageOf, searchCards, type ScryfallCard } from '@/lib/scryfall';
import { exactName } from '@/lib/syntax';
import { combosInDeck, estimateBracket, SPELLBOOK_TAGS, type DeckList } from '@/lib/spellbook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Near-misses looked at, and the cards-to-add shown from them.
const NEAR_MISSES = 60;
const TO_ADD = 12;
const cache = new Map<string, unknown>();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const { list } = owned;

  const key = `${id}:${list.updatedAt}:${list.commander?.id ?? ''}`;
  if (cache.has(key)) return NextResponse.json(cache.get(key));

  const main = cardsInList(id).filter((c) => c.board === 'main');
  const deck: DeckList = {
    commanders: list.commander ? [list.commander.name] : [],
    main: main.map((c) => ({ name: c.card.name, quantity: c.quantity })),
  };

  const [bracket, combos, roles, page] = await Promise.all([
    estimateBracket(deck).catch(() => null),
    combosInDeck(deck).catch(() => null),
    countRoles(main, { search: (q) => searchCards(q), cached: cachedRoles, save: saveRoles }).catch(() => null),
    list.commander && edhrecEnabled() ? commanderPage(list.commander.name) : Promise.resolve(null),
  ]);

  // Near-misses grouped by the card that completes them: one card often
  // finishes several combos, and listing each separately repeated it.
  let toAdd: Array<Record<string, unknown>> = [];
  if (combos) {
    const near = combos.almost.filter((c) => c.missing.length === 1)
      .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0)).slice(0, NEAR_MISSES);
    const groups = new Map<string, typeof near>();
    for (const combo of near) groups.set(combo.missing[0], [...(groups.get(combo.missing[0]) ?? []), combo]);
    const ranked = [...groups.entries()]
      .sort(([, a], [, b]) => b.length - a.length || (b[0].popularity ?? 0) - (a[0].popularity ?? 0));
    // The cheapest paper printing of each, in one search. Spellbook does not
    // check legality - it offered Fastbond, which is banned - so only cards
    // legal in Commander are suggested.
    const names = ranked.slice(0, TO_ADD * 2).map(([name]) => name);
    const found: ScryfallCard[] = names.length
      ? (await searchCards(`(${names.map(exactName).join(' or ')}) -is:digital prefer:usd-low`).catch(() => ({ cards: [] }))).cards
      : [];
    const byName = new Map(found.map((c) => [c.name.split(' // ')[0], c]));
    const legal = ranked.filter(([name]) => byName.get(name.split(' // ')[0])?.legalities?.commander === 'legal').slice(0, TO_ADD);
    toAdd = legal.map(([name, completes]) => {
      const card = byName.get(name.split(' // ')[0]);
      return {
        name, id: card?.id ?? null, image: card ? imageOf(card, 'small') : null, price: card?.prices?.usd ?? null,
        combos: completes.map((c) => ({
          id: c.id, url: c.url, produces: c.produces, popularity: c.popularity,
          have: c.cards.filter((n) => n !== name),
        })),
      };
    });
  }

  const spells = main.filter((c) => primaryType(c.card) !== 'Lands').map((c) => c.card.name);
  const body = {
    bracket: bracket && { ...bracketFloor(bracket), spellbook: { tag: bracket.tag, label: SPELLBOOK_TAGS[bracket.tag] } },
    combos: combos && { included: combos.included, toAdd },
    cuts: cutCandidates(spells, page?.stats ?? null, roles),
    unavailable: [!bracket && 'bracket', !combos && 'combos'].filter(Boolean),
  };
  if (bracket && combos) {
    if (cache.size > 100) cache.clear();
    cache.set(key, body);
  }
  return NextResponse.json(body);
}
