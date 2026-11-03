/**
 * How a deck wins, guessed from its cards alone - no model. Pure.
 *
 * Three kinds of evidence, strongest first:
 *   - combos Commander Spellbook knows are in the deck, whose result ends the
 *     game (win the game, each opponent loses, infinite damage, drain or mill);
 *   - single cards whose Scryfall tags say they win or finish (alternate win
 *     conditions, extra turns, extra combats, overruns, drain);
 *   - the deck's shape: many creatures with anthems or overruns (go wide),
 *     many equipment and auras (commander damage), many mill cards.
 *
 * It names each likely route with the cards behind it, and says so when it
 * finds none: a deck can be a pile of good cards with no way to close.
 */

import { primaryType } from './deckview';
import type { RoleCount } from './roles';
import { oracleTextOf, type ScryfallCard } from './scryfall';
import type { Combo } from './spellbook';

export interface WinRoute {
  id: string;
  label: string;
  /** One sentence on how it closes the game. */
  how: string;
  cards: string[];
  /** strong: it ends the game by itself once assembled; some: it helps close. */
  strength: 'strong' | 'some';
}

export interface WinGuess {
  routes: WinRoute[];
  /** What the deck lacks to close games, or '' when it has a strong route. */
  missing: string;
}

/** A combo result that ends the game rather than just making resources. */
const WINS = /win the game|each opponent loses|infinite (combat )?damage|infinite (life ?loss|drain)|infinite mill|lose the game/i;

const named = (roles: RoleCount[], id: string) => roles.find((r) => r.id === id)?.cards ?? [];

export function guessWinRoutes(input: {
  cards: Array<{ card: ScryfallCard; quantity: number }>;
  roles: RoleCount[];
  /** Combos the deck has, from Spellbook; null when it could not be asked. */
  combos: Combo[] | null;
}): WinGuess {
  const { cards, roles, combos } = input;
  const routes: WinRoute[] = [];

  // Combos that end the game, most played first, one route per result.
  const winning = (combos ?? []).filter((c) => c.produces.some((p) => WINS.test(p)))
    .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
  if (winning.length) {
    const best = winning.slice(0, 3);
    routes.push({
      id: 'combo',
      label: 'Combo',
      how: `${winning.length} combo${winning.length === 1 ? '' : 's'} that end the game - e.g. ${best.map((c) => `${c.cards.join(' + ')} (${c.produces.find((p) => WINS.test(p))})`).join('; ')}.`,
      cards: [...new Set(best.flatMap((c) => c.cards))],
      strength: 'strong',
    });
  }

  const altWins = named(roles, 'wincon');
  if (altWins.length) {
    routes.push({ id: 'alt-win', label: 'Alternate win', how: 'Cards that win the game outright when their condition is met.', cards: altWins, strength: 'strong' });
  }

  const extraTurns = named(roles, 'extra-turn');
  if (extraTurns.length >= 2) {
    routes.push({ id: 'extra-turns', label: 'Extra turns', how: 'Take extra turns to keep attacking or out-tempo the table.', cards: extraTurns, strength: 'some' });
  }

  // Combat: a creature deck with ways to push damage through.
  const creatures = cards.filter((c) => primaryType(c.card) === 'Creatures').reduce((n, c) => n + c.quantity, 0);
  const pushers = [...named(roles, 'overrun'), ...named(roles, 'anthem'), ...named(roles, 'extra-combat')];
  if (creatures >= 18 && pushers.length >= 3) {
    routes.push({
      id: 'combat',
      label: 'Combat',
      how: `${creatures} creatures with ${pushers.length} anthems, overruns or extra combats to swing for lethal.`,
      cards: [...new Set(pushers)],
      strength: pushers.length >= 6 ? 'strong' : 'some',
    });
  }

  // Finishers: mass steal or death payoffs that end a game already close.
  const finishers = named(roles, 'finisher');
  if (finishers.length >= 2) {
    routes.push({
      id: 'finisher',
      label: 'Finishers',
      how: 'Cards that turn a board, or a pile of deaths, into lethal: take every creature for a turn, or make each one that dies hurt the table.',
      cards: finishers,
      strength: finishers.length >= 4 ? 'strong' : 'some',
    });
  }

  // Commander damage: a pile of equipment and auras that make one creature
  // bigger. Ramp auras (Wild Growth) and protection auras do not count.
  const support = new Set([...named(roles, 'ramp'), ...named(roles, 'protection')]);
  const suitUp = cards.filter((c) => /\b(Equipment|Aura)\b/.test(c.card.type_line ?? '')
    && !support.has(c.card.name)
    && /(equipped|enchanted) creature gets \+/i.test(oracleTextOf(c.card))).map((c) => c.card.name);
  if (suitUp.length >= 8) {
    routes.push({ id: 'voltron', label: 'Commander damage', how: `${suitUp.length} equipment and auras to suit up one creature for 21 commander damage.`, cards: suitUp, strength: 'some' });
  }

  const drain = named(roles, 'drain');
  if (drain.length >= 3) {
    routes.push({ id: 'drain', label: 'Drain', how: 'Life loss to every opponent, a little at a time or all at once.', cards: drain, strength: drain.length >= 6 ? 'strong' : 'some' });
  }

  const mill = named(roles, 'mill');
  if (mill.length >= 6) {
    routes.push({ id: 'mill', label: 'Mill', how: 'Empty the opponents\' libraries.', cards: mill, strength: mill.length >= 10 ? 'strong' : 'some' });
  }

  const strong = routes.some((r) => r.strength === 'strong');
  const missing = strong
    ? ''
    : routes.length
      ? 'Its ways to win only help close a game; nothing ends it once assembled. A combo, an alternate win or more finishers would make it close reliably.'
      : 'No clear way to win from the cards: no combo that ends the game, no alternate win, and too few finishers (overruns, extra combats, drain, mass steal).';
  return { routes, missing };
}
