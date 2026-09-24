/**
 * What a Commander deck looks like as a whole: its curve, what its spells
 * ask of the mana and what the lands give, what kinds of cards it runs,
 * what is wrong with it, and how its opening hands come out.
 *
 * Everything here reads the stored Scryfall records, so it needs no network
 * and is pure - the role counts, which do need Scryfall, live in roles.ts.
 */

import { primaryType } from './deckview';
import { distribution } from './odds';
import type { Finish, ScryfallCard } from './scryfall';
import { manaCostOf } from './scryfall';

export type Color = 'W' | 'U' | 'B' | 'R' | 'G';
export const COLORS: Color[] = ['W', 'U', 'B', 'R', 'G'];

export interface HealthInput {
  commander: ScryfallCard | null;
  /** The main board: the 99. Sideboard and maybeboard are not the deck. */
  cards: Array<{ card: ScryfallCard; quantity: number; finish?: Finish }>;
}

export interface Warning {
  level: 'critical' | 'warning' | 'info';
  title: string;
  detail?: string;
  cards?: string[];
}

export interface Health {
  /** Cards in the deck, the commander included. */
  size: number;
  lands: number;
  /** Average mana value of the non-land cards, commander excluded. */
  averageMv: number;
  curve: Array<{ label: string; count: number; cards: string[] }>;
  types: Array<{ label: string; count: number }>;
  colors: Array<{ color: Color; pips: number; share: number; landSources: number; otherSources: number }>;
  gameChangers: string[];
  warnings: Warning[];
  hand: { library: number; lands: number; distribution: number[]; twoToFour: number; averageLands: number };
}

const isLand = (card: ScryfallCard) => primaryType(card) === 'Lands';
const typeLine = (card: ScryfallCard) => card.type_line ?? card.card_faces?.map((f) => f.type_line).join(' // ') ?? '';
const oracle = (card: ScryfallCard) => card.oracle_text ?? card.card_faces?.map((f) => f.oracle_text).join('\n') ?? '';

/**
 * Coloured mana symbols in a cost. Hybrid {W/U} counts half to each colour;
 * phyrexian {W/P} and two-brid {2/W} count as their colour.
 */
export function pips(cost: string): Record<Color, number> {
  const out: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const [, symbol] of cost.matchAll(/\{([^}]+)\}/g)) {
    const colors = symbol.split('/').filter((part): part is Color => (COLORS as string[]).includes(part));
    for (const c of colors) out[c] += 1 / colors.length;
  }
  return out;
}

/** Cards a Commander deck may run more than one of. */
function anyNumberAllowed(card: ScryfallCard): boolean {
  return /\bBasic\b/.test(typeLine(card)) || /A deck can have (any number of|up to \w+) cards named/i.test(oracle(card));
}

export function analyse({ commander, cards }: HealthInput): Health {
  const count = (list: typeof cards) => list.reduce((n, c) => n + c.quantity, 0);
  const lands = cards.filter((c) => isLand(c.card));
  const spells = cards.filter((c) => !isLand(c.card));
  const size = count(cards) + (commander ? 1 : 0);

  // Curve: mana value 0 to 7+, spells only.
  const curve = Array.from({ length: 8 }, (_, mv) => ({ label: mv === 7 ? '7+' : String(mv), count: 0, cards: [] as string[] }));
  for (const { card, quantity } of spells) {
    const bucket = curve[Math.min(7, Math.floor(card.cmc ?? 0))];
    bucket.count += quantity;
    bucket.cards.push(card.name);
  }
  const spellCount = count(spells);
  const averageMv = spellCount ? spells.reduce((sum, c) => sum + (c.card.cmc ?? 0) * c.quantity, 0) / spellCount : 0;

  const typeCounts = new Map<string, number>();
  for (const { card, quantity } of cards) typeCounts.set(primaryType(card), (typeCounts.get(primaryType(card)) ?? 0) + quantity);
  const typeOrder = ['Creatures', 'Planeswalkers', 'Battles', 'Instants', 'Sorceries', 'Artifacts', 'Enchantments', 'Lands', 'Other'];
  const types = typeOrder.filter((t) => typeCounts.has(t)).map((label) => ({ label, count: typeCounts.get(label)! }));

  // Colour demand (pips in spells) against supply (what the mana cards make).
  const identity = new Set<string>(commander?.color_identity ?? []);
  const demand: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const { card, quantity } of spells) {
    const p = pips(manaCostOf(card));
    for (const c of COLORS) demand[c] += p[c] * quantity;
  }
  const totalPips = COLORS.reduce((n, c) => n + demand[c], 0);
  const shown = COLORS.filter((c) => (commander ? identity.has(c) : demand[c] > 0));
  const colors = shown.map((color) => ({
    color,
    pips: Math.round(demand[color] * 10) / 10,
    share: totalPips ? demand[color] / totalPips : 0,
    landSources: count(lands.filter((c) => c.card.produced_mana?.includes(color))),
    otherSources: count(spells.filter((c) => c.card.produced_mana?.includes(color))),
  }));

  const gameChangers = [commander, ...cards.map((c) => c.card)]
    .filter((c): c is ScryfallCard => !!c && c.game_changer === true).map((c) => c.name);

  const warnings: Warning[] = [];
  if (!commander) warnings.push({ level: 'warning', title: 'No commander', detail: 'Pick one above to check colours and legality.' });
  if (size !== 100) {
    warnings.push({
      level: 'warning',
      title: `${size} cards, not 100`,
      detail: size > 100 ? `${size - 100} to cut.` : `${100 - size} to add.`,
    });
  }
  if (commander) {
    const outside = cards.filter((c) => (c.card.color_identity ?? []).some((x) => !identity.has(x)));
    if (outside.length) {
      warnings.push({
        level: 'critical',
        title: `${outside.length} card${outside.length === 1 ? '' : 's'} outside ${commander.name.split(',')[0]}'s colours`,
        cards: outside.map((c) => c.card.name),
      });
    }
  }
  const extra = cards.filter((c) => c.quantity > 1 && !anyNumberAllowed(c.card));
  if (extra.length) {
    warnings.push({ level: 'critical', title: 'More than one copy of a card', detail: 'Commander is singleton.', cards: extra.map((c) => `${c.quantity}× ${c.card.name}`) });
  }
  for (const [status, label] of [['banned', 'Banned in Commander'], ['not_legal', 'Not legal in Commander']] as const) {
    const hit = [commander, ...cards.map((c) => c.card)]
      .filter((c): c is ScryfallCard => !!c && c.legalities?.commander === status).map((c) => c.name);
    if (hit.length) warnings.push({ level: 'critical', title: label, cards: hit });
  }
  if (gameChangers.length) {
    warnings.push({
      level: 'info',
      title: `${gameChangers.length} Game Changer${gameChangers.length === 1 ? '' : 's'}`,
      detail: gameChangers.length > 3
        ? 'More than three puts the deck in bracket 4 or higher.'
        : 'Brackets 1 and 2 allow none; bracket 3 allows up to three.',
      cards: gameChangers,
    });
  }

  // Opening hands: seven from the library - the deck without its commander.
  const library = count(cards);
  const landCount = count(lands);
  const dist = library >= 7 ? distribution(library, landCount, 7) : [];
  return {
    size,
    lands: landCount,
    averageMv: Math.round(averageMv * 100) / 100,
    curve,
    types,
    colors,
    gameChangers,
    warnings,
    hand: {
      library,
      lands: landCount,
      distribution: dist,
      twoToFour: dist.slice(2, 5).reduce((a, b) => a + b, 0),
      averageLands: library ? (7 * landCount) / library : 0,
    },
  };
}
