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

/** What can be set aside by the owner: the classifier's land-denial and extra-turn flags. Game Changers are an official list. */
export type FlagKind = 'land' | 'turns';

export interface BracketFloor {
  /** 1 means "1 or 2": the difference between them is intent, not cards. */
  floor: 1 | 3 | 4;
  label: string;
  reasons: Array<{ floor: 3 | 4; text: string; cards: string[]; kind?: FlagKind }>;
  cautions: Array<{ text: string; cards: string[]; kind?: FlagKind }>;
  /** Why each flagged card is flagged, in a few words from its own text (Part D 17). */
  why?: Record<string, string>;
  /** Flagged cards the owner said don't count in this deck: left out of the floor, and listed so they can go back. */
  aside?: string[];
}

const front = (n: string) => n.split(' // ')[0].trim().toLowerCase();

/** The line of a card's text that does the flagged thing, short: a planeswalker's loyalty ability with its cost. */
export function flagWhy(text: string, kind: FlagKind): string | null {
  const lines = text.split('\n').map((l) => l.replace(/\([^)]*\)/g, '').trim()).filter(Boolean);
  const hit = kind === 'land'
    ? lines.find((l) => /\b(destroy|sacrifice|exile|return)s?\b[^.]*\b(lands?|permanents?|the rest)\b/i.test(l) || /\blands? (don't|doesn't) untap\b/i.test(l))
    : lines.find((l) => /\bextra turn\b/i.test(l));
  if (!hit) return null;
  const short = hit.length > 110 ? `${hit.slice(0, 107).replace(/\s+\S*$/, '')}…` : hit;
  return short;
}

/**
 * A planeswalker whose land denial sits only on a loyalty ability costing 6 or more (Liliana, Dreadhorde General's
 * −9): the last ability, rarely reached, so a caution and not a floor.
 */
export function onlyUltimate(text: string): boolean {
  const lines = text.split('\n').map((l) => l.trim());
  // Every line that touches lands counts, not only destroy and sacrifice (round 2, item 14): "Lands don't untap",
  // "Exile all lands", "Return all lands", "Tap all lands" on a small ability keep the card's floor.
  const touches = (l: string) => /\b(destroy|sacrifice|exile|return|bounce)s?\b[^.]*\b(lands?|permanents?|the rest)\b/i.test(l)
    || /\blands?\b[^.]*\b(don'?t|doesn'?t|can'?t) untap\b/i.test(l) || /\btap all lands\b/i.test(l);
  const hits = lines.filter(touches);
  return hits.length > 0 && hits.every((l) => { const m = l.match(/^[−-](\d+):/); return !!m && Number(m[1]) >= 6; });
}

export function bracketFloor(report: Pick<BracketReport, 'cards' | 'combos'>, opts: { aside?: Set<string>; textOf?: (name: string) => { text: string; planeswalker: boolean } | null } = {}): BracketFloor {
  const names = (pick: (c: BracketReport['cards'][number]) => boolean) => report.cards.filter(pick).map((c) => c.name);
  const aside = opts.aside ?? new Set<string>();
  const isAside = (n: string) => aside.has(front(n));
  const gameChangers = names((c) => c.gameChanger);
  const flaggedLand = names((c) => c.massLandDenial);
  const flaggedTurns = names((c) => c.extraTurn);
  // A planeswalker's last ability is a caution, not a floor.
  const ultimate = flaggedLand.filter((n) => { const t = opts.textOf?.(n); return !!t && t.planeswalker && onlyUltimate(t.text); });
  const landDenial = flaggedLand.filter((n) => !isAside(n) && !ultimate.includes(n));
  const extraTurns = flaggedTurns.filter((n) => !isAside(n));
  const why: Record<string, string> = {};
  for (const [list, kind] of [[flaggedLand, 'land'], [flaggedTurns, 'turns']] as const) {
    for (const n of list) { const t = opts.textOf?.(n); const w = t ? flagWhy(t.text, kind) : null; if (w) why[n] = w; }
  }
  const twoCard = report.combos.filter((c) => c.twoCard);

  const reasons: BracketFloor['reasons'] = [];
  const cautions: BracketFloor['cautions'] = [];

  if (landDenial.length) {
    reasons.push({ floor: 4, text: 'Mass land denial is only for bracket 4 and up', cards: landDenial, kind: 'land' });
  }
  const ultimateShown = ultimate.filter((n) => !isAside(n));
  if (ultimateShown.length) {
    cautions.push({ text: 'Can wipe lands with its last ability: count it if your table would', cards: ultimateShown, kind: 'land' });
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
      kind: 'turns',
    });
  }

  const floor = reasons.reduce<number>((max, r) => Math.max(max, r.floor), 1) as BracketFloor['floor'];
  const label = floor === 1 ? 'Bracket 1–2' : floor === 3 ? 'At least bracket 3' : 'Bracket 4 or 5';
  const set = [...new Set([...flaggedLand, ...flaggedTurns])].filter(isAside);
  return { floor, label, reasons, cautions, ...(Object.keys(why).length ? { why } : {}), ...(set.length ? { aside: set } : {}) };
}
