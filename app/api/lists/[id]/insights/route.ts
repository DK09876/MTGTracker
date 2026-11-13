/**
 * What a deck's list says about how it plays: its bracket floor, the
 * combos it has and is one card from (Commander Spellbook), and how it
 * wins.
 *
 * Spellbook is asked twice per look, so answers are kept until the deck
 * changes: switching tabs does not ask again.
 */

import { deckRoles } from '@/lib/deck-roles';
import { NextResponse } from 'next/server';

import { bracketFloor } from '@/lib/bracket';
import { asideOf, textLookup } from '@/lib/bracket-aside';
import { cardsInList } from '@/lib/db';
import { requireList } from '@/lib/profile-route';
import { guessWinRoutes } from '@/lib/wincons';
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

  const aside = asideOf(id);
  const key = `${id}:${list.updatedAt}:${list.commander?.id ?? ''}:${[...aside].sort().join('|')}`;
  if (cache.has(key)) return NextResponse.json(cache.get(key));

  const main = cardsInList(id).filter((c) => c.board === 'main');
  const deck: DeckList = {
    commanders: list.commander ? [list.commander.name] : [],
    main: main.map((c) => ({ name: c.card.name, quantity: c.quantity })),
  };

  const [bracket, combos, roles] = await Promise.all([
    estimateBracket(deck).catch(() => null),
    combosInDeck(deck).catch(() => null),
    deckRoles(id, main).catch(() => null),
  ]);

  // Near-misses grouped by the card that completes them: one card often
  // finishes several combos, and listing each separately repeated it.
  let toAdd: Array<Record<string, unknown>> = [];
  if (combos) {
    const near = combos.almost.filter((c) => c.missing.length === 1)
      .sort((a, b) => a.cards.length - b.cards.length).slice(0, NEAR_MISSES);
    const groups = new Map<string, typeof near>();
    for (const combo of near) groups.set(combo.missing[0], [...(groups.get(combo.missing[0]) ?? []), combo]);
    const ranked = [...groups.entries()]
      // The card that finishes the most combos first, then the smallest combos.
      .sort(([, a], [, b]) => b.length - a.length || a[0].cards.length - b[0].cards.length);
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
          id: c.id, url: c.url, produces: c.produces,
          have: c.cards.filter((n) => n !== name),
        })),
      };
    });
  }

  const body = {
    bracket: bracket && { ...bracketFloor(bracket, { aside, textOf: textLookup([...main.map((c) => c.card), ...(list.commander ? [list.commander] : [])]) }), spellbook: { tag: bracket.tag, label: SPELLBOOK_TAGS[bracket.tag] } },
    combos: combos && { included: combos.included, toAdd },
    // How it wins, from the cards alone (no model): combos, finishers, shape.
    wincons: roles ? guessWinRoutes({ cards: [...main, ...(list.commander ? [{ card: list.commander, quantity: 1 }] : [])], roles, combos: combos?.included ?? null }) : null,
    unavailable: [!bracket && 'bracket', !combos && 'combos'].filter(Boolean),
  };
  if (bracket && combos) {
    if (cache.size > 100) cache.clear();
    cache.set(key, body);
  }
  return NextResponse.json(body);
}
