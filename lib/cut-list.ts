/**
 * A deck's cut list as the Tune tab shows it: the cards, roles, tags,
 * commander, the plan's styles and the owner's
 * rule settings, put through cut-score.ts. Shared by the cut list itself
 * and Claude's review of it. Server only.
 */

import { cutCandidates } from './cut-score';
import { cardsInList, deckTags, type List } from './db';
import { cutSettings, effectiveCutSettings, planFor, planStyles } from './deck-plan';
import { commanderRoles as rolesOfCommander, deckRoles, keeps } from './deck-roles';
import { fitProfile } from './fit';
import { analyse } from './health';

export async function deckCutList(list: Pick<List, 'id' | 'commander'>, opts: { landCut?: string | null } = {}) {
  const main = cardsInList(list.id).filter((c) => c.board === 'main');
  const health = analyse({ commander: list.commander, cards: main });
  const roles = await deckRoles(list.id, main);
  // What the commander itself does, from the same tags (it is in every game).
  const commanderRoles = await rolesOfCommander(list.commander);
  const settings = cutSettings(list.id);
  // Scored with the deck's changes to the usual rules on top, where the owner set nothing.
  const effective = effectiveCutSettings(list.id);
  const styles = planStyles(list.id, list.commander, main);
  const plan = planFor(list.id, '', list.commander, main);
  const tags = deckTags(list.id);
  // Never cut: the owner's ★ never-cut list (the commander is never in the list). The plan read's
  // engines and key cards are flagged where a cut is shown, not blocked (deck-context.ts planFlags).
  const keep = keeps(list.id);
  const result = cutCandidates({
    // A second commander leads the deck with the first: never a cut.
    cards: main.filter((c) => c.slot !== 'partner'), roles, fit: fitProfile(list.commander), commander: list.commander, commanderRoles,
    tags, keep,
    // Lands are offered only over the plan's range, never to make room.
    lands: { have: plan.landNumber.have, range: plan.lands },
    packages: plan.packages,
    settings: effective.settings, styles,
    // The plan as the owner confirmed it: how the deck is built, its themes not yet kept as tags, what it optimizes for.
    build: plan.stored.build?.v ?? plan.snapshot.build,
    themes: (plan.snapshot.themes ?? []).filter((t) => !Object.prototype.hasOwnProperty.call(plan.stored.themes?.kept ?? {}, t.id) && !(plan.stored.themes?.dropped ?? []).includes(t.id)),
    goal: plan.goal.chips,
    landCut: opts.landCut ?? null,
  });
  return { ...result, main, health, roles, settings, overridden: Object.fromEntries(Object.entries(effective.changed).map(([k, o]) => [k, o.what])), styles, tags };
}
