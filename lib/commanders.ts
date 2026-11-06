/**
 * A deck's second commander and its companion, read from the cards. Pure.
 *
 * Two commanders share the 100 (98 + 2): Partner, "Partner with" a named
 * card, Partner—a group, Friends forever, "Choose a Background" with a
 * Background, and Doctor's companion with a Time Lord Doctor. A companion
 * starts outside the game, so it is not one of the 100: it is kept on the
 * sideboard, marked, and never counted or cut.
 *
 * On import, a list that names its second commander or companion is taken
 * at its word. Otherwise a card that could be one is taken when it is the
 * only one that could; when several could, the owner is asked once.
 */

import { canPartner } from './partners';
import { oracleTextOf, type ScryfallCard } from './scryfall';

/** What a card in the deck is beyond a card: the second commander, or the companion. */
export type Slot = 'partner' | 'companion';

/** A question for the owner after an import: which of these cards is the second commander, or the companion. */
export interface SlotQuestion {
  kind: Slot;
  /** Card ids, as stored in the deck. */
  options: string[];
}

const typeOf = (card: ScryfallCard) => `${card.type_line ?? ''} ${card.card_faces?.map((f) => f.type_line ?? '').join(' ') ?? ''}`;

/** Whether a commander can have a second one beside it (partners.ts says which). */
export function takesPartner(card: ScryfallCard): boolean {
  return /^(Partner\b|Friends forever\b|Choose a Background\b|Doctor's companion\b)/im.test(oracleTextOf(card)) || /\bTime Lord Doctor\b/.test(typeOf(card));
}

/** Whether these two can lead a deck together. */
export const canPair = (a: ScryfallCard, b: ScryfallCard) => a.id !== b.id && canPartner(a, b);

/** A companion: a card with the Companion keyword. */
export function isCompanion(card: ScryfallCard): boolean {
  return (card.keywords ?? []).some((k) => k.toLowerCase() === 'companion') || /^Companion\s*[—-]/im.test(oracleTextOf(card));
}

/** The colours a deck may use: every commander's identity together. */
export function deckIdentity(commanders: Array<ScryfallCard | null | undefined>): Set<string> {
  return new Set(commanders.flatMap((c) => c?.color_identity ?? []));
}

export interface SlotInput {
  commander: ScryfallCard | null;
  cards: Array<{ card: ScryfallCard; board: string; slot?: Slot | null; explicit?: 'commander' | 'companion' }>;
}

/**
 * Who the second commander and the companion are, when it is clear, and
 * what to ask when it is not. A kind already set in the deck is left alone.
 */
export function detectSlots({ commander, cards }: SlotInput): { partner: string | null; companion: string | null; ask: SlotQuestion[] } {
  const out = { partner: null as string | null, companion: null as string | null, ask: [] as SlotQuestion[] };
  if (!commander) return out;
  const has = (slot: Slot) => cards.some((c) => c.slot === slot);
  const pick = (kind: Slot, options: ScryfallCard[]) => {
    const ids = [...new Set(options.map((c) => c.id))];
    if (ids.length === 1) out[kind] = ids[0];
    else if (ids.length > 1) out.ask.push({ kind, options: ids });
  };

  if (!has('partner') && takesPartner(commander)) {
    const main = cards.filter((c) => c.board === 'main' && canPair(commander, c.card));
    // A list that names two commanders is taken at its word.
    const named = main.filter((c) => c.explicit === 'commander');
    pick('partner', (named.length ? named : main).map((c) => c.card));
  }

  if (!has('companion')) {
    const partner = cards.find((c) => c.slot === 'partner' || c.card.id === out.partner)?.card;
    const colours = deckIdentity([commander, partner]);
    const fits = (c: ScryfallCard) => (c.color_identity ?? []).every((x) => colours.has(x));
    // Only cards outside the deck can be its companion; one in the 99 is just a card.
    const outside = cards.filter((c) => c.board !== 'main' && isCompanion(c.card) && fits(c.card));
    const named = outside.filter((c) => c.explicit === 'companion');
    pick('companion', (named.length ? named : outside).map((c) => c.card));
  }
  return out;
}
