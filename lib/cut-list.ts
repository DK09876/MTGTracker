/**
 * A deck's cut list as the Tune tab shows it: the cards, roles, tags,
 * commander, the plan's styles and the owner's
 * rule settings, put through cut-score.ts. Shared by the cut list itself
 * and Claude's review of it. Server only.
 */

import { cutCandidates } from './cut-score';
import { cardsInList, deckTags, type List } from './db';
import { cutSettings, planFor, planStyles } from './deck-plan';
import { commanderRoles as rolesOfCommander, deckRoles, keeps } from './deck-roles';
import { fitProfile } from './fit';
import { analyse } from './health';

export async function deckCutList(list: Pick<List, 'id' | 'commander'>) {
  const main = cardsInList(list.id).filter((c) => c.board === 'main');
  const health = analyse({ commander: list.commander, cards: main });
  const roles = await deckRoles(list.id, main);
  // What the commander itself does, from the same tags (it is in every game).
  const commanderRoles = await rolesOfCommander(list.commander);
  const settings = cutSettings(list.id);
  const styles = planStyles(list.id, list.commander, main);
  const plan = planFor(list.id, '', list.commander, main);
  const tags = deckTags(list.id);
  const result = cutCandidates({
    // A second commander leads the deck with the first: never a cut.
    cards: main.filter((c) => c.slot !== 'partner'), roles, fit: fitProfile(list.commander), commander: list.commander, commanderRoles,
    tags, keep: keeps(list.id),
    // Lands are offered only over the plan's range, never to make room.
    lands: { have: plan.landNumber.have, range: plan.lands },
    packages: plan.packages,
    settings, styles,
  });
  return { ...result, main, health, roles, settings, styles, tags };
}
