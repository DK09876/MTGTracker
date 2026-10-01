/**
 * Rules a card's own words call for, whatever else the search finds.
 *
 * Searching the rulebook by words finds rules about the words; it can miss
 * the rule that decides an interaction. Asked about Blade of Selves on
 * Kratos, Stoic Father ("whenever a God dies ..."), the search filled up with
 * Equip and myriad rules and never offered 603.10a - that dying permanents
 * "look back in time" and see each other die - so the answer counted three
 * experience counters instead of seven, twice, as "certain" (2026-09-30).
 *
 * So some card text always brings its rules: a "dies" trigger brings the
 * look-back-in-time rules and one-event-many-triggers; copies bring the copy
 * rules; a legendary creature being copied brings the legend rule; a
 * creature put onto the battlefield attacking brings "never declared".
 */

import type { ScryfallCard } from '../scryfall';

export interface Anchor {
  rule: string;
  /** Why it is here, for the model. */
  why: string;
}

const textOf = (c: ScryfallCard) => `${c.oracle_text ?? ''} ${c.card_faces?.map((f) => f.oracle_text ?? '').join(' ') ?? ''}`.toLowerCase();

export function anchorRules(question: string, cards: ScryfallCard[]): Anchor[] {
  const oracle = cards.map(textOf).join(' \n ');
  const all = `${question.toLowerCase()} \n ${oracle}`;
  const legendary = cards.some((c) => /legendary/i.test(c.type_line ?? ''));
  const out: Anchor[] = [];
  const add = (rule: string, why: string) => { if (!out.some((a) => a.rule === rule)) out.push({ rule, why }); };

  const leaves = /\b(dies|die|died|dying)\b|put into (a|your|an opponent's|its owner's|their owners?'?) graveyard from the battlefield|leaves the battlefield/;
  if (leaves.test(oracle) || leaves.test(question.toLowerCase())) {
    add('603.10a', 'a "dies" / leaves-the-battlefield trigger looks back in time: permanents leaving at the same moment still see it');
    add('603.2c', 'one event with several deaths triggers once for each');
    add('700.4', 'what "dies" means');
    add('603.6c', 'leaves-the-battlefield triggers');
  }
  const copies = /\b(cop(y|ies)|myriad|populate|clone|embalm|eternalize|encore)\b/;
  if (copies.test(all)) {
    add('707.2', 'a copy has the copied object\'s abilities, so token copies trigger like the original');
  }
  if (legendary && copies.test(all)) {
    add('704.5j', 'the legend rule, for legendary copies');
    add('704.3', 'state-based actions happen all at once');
  }
  if (/tapped and attacking|onto the battlefield attacking|\bmyriad\b|\bencore\b/.test(all)) {
    add('508.4', 'a creature put onto the battlefield attacking was never declared as an attacker');
  }
  if (/\bcounters?\b(?! target)/.test(all) && !/counter target (spell|ability)/.test(all)) {
    add('122.1', 'counters');
  }
  return out;
}
