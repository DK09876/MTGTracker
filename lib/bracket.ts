/**
 * The lowest official Commander bracket a deck can be, and why.
 *
 * The brackets are mostly about intent, which no list can show - so this
 * gives a floor from the things the rules do name: Game Changers (none in
 * brackets 1-2, up to three in 3), mass land denial (4 and up), two-card
 * combos (not in 1-2; in 3 only late in the game), and extra turns (never
 * chained below 4). What depends on how the deck plays - is a combo early,
 * are extra turns chained - is a caution, not a verdict.
 *
 * Which cards are Game Changers, mass land denial or extra turns comes from
 * Commander Spellbook's classifier, not a list kept here.
 */

import type { BracketReport } from './spellbook';

export interface BracketFloor {
  /** 1 means "1 or 2": the difference between them is intent, not cards. */
  floor: 1 | 3 | 4;
  label: string;
  reasons: Array<{ floor: 3 | 4; text: string; cards: string[] }>;
  cautions: Array<{ text: string; cards: string[] }>;
}

export function bracketFloor(report: Pick<BracketReport, 'cards' | 'combos'>): BracketFloor {
  const names = (pick: (c: BracketReport['cards'][number]) => boolean) => report.cards.filter(pick).map((c) => c.name);
  const gameChangers = names((c) => c.gameChanger);
  const landDenial = names((c) => c.massLandDenial);
  const extraTurns = names((c) => c.extraTurn);
  const twoCard = report.combos.filter((c) => c.twoCard);

  const reasons: BracketFloor['reasons'] = [];
  const cautions: BracketFloor['cautions'] = [];

  if (landDenial.length) {
    reasons.push({ floor: 4, text: 'Mass land denial is only for bracket 4 and up', cards: landDenial });
  }
  if (gameChangers.length > 3) {
    reasons.push({ floor: 4, text: `${gameChangers.length} Game Changers: bracket 3 allows three`, cards: gameChangers });
  } else if (gameChangers.length) {
    reasons.push({ floor: 3, text: `${gameChangers.length} Game Changer${gameChangers.length === 1 ? '' : 's'}: brackets 1 and 2 allow none`, cards: gameChangers });
  }
  if (twoCard.length) {
    reasons.push({
      floor: 3,
      text: `${twoCard.length} two-card combo${twoCard.length === 1 ? '' : 's'}: not in brackets 1 and 2`,
      cards: twoCard.map((c) => c.cards.join(' + ')),
    });
    cautions.push({
      text: 'Bracket 3 allows two-card combos only late in the game; if one can win early, the deck is bracket 4',
      cards: twoCard.map((c) => c.cards.join(' + ')),
    });
  }
  if (extraTurns.length) {
    cautions.push({
      text: `${extraTurns.length} extra-turn card${extraTurns.length === 1 ? '' : 's'}: chaining extra turns is bracket 4 only`,
      cards: extraTurns,
    });
  }

  const floor = reasons.reduce<number>((max, r) => Math.max(max, r.floor), 1) as BracketFloor['floor'];
  const label = floor === 1 ? 'Bracket 1–2' : floor === 3 ? 'At least bracket 3' : 'Bracket 4 or 5';
  return { floor, label, reasons, cautions };
}
