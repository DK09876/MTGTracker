/**
 * A deck's cut list as the Tune tab shows it: the cards, roles, tags,
 * commander, EDHREC's numbers when on, the plan's styles and the owner's
 * rule settings, put through cut-score.ts. Shared by the cut list itself
 * and Claude's review of it. Server only.
 */

import { karstenLands } from './build';
import { cutCandidates } from './cut-score';
import { cachedRoles, cardsInList, deckTags, saveRoles, type List } from './db';
import { cutSettings, planFor, planStyles } from './deck-plan';
import { deckRoles, keeps } from './deck-roles';
import { commanderPage, edhrecEnabled } from './edhrec';
import { fitProfile } from './fit';
import { analyse } from './health';
import { countRoles } from './roles';
import { searchCards } from './scryfall';

export async function deckCutList(list: Pick<List, 'id' | 'commander'>) {
  const main = cardsInList(list.id).filter((c) => c.board === 'main');
  const health = analyse({ commander: list.commander, cards: main });
  const roles = await deckRoles(list.id, main);
  const cheap = new Set(roles.filter((r) => ['ramp', 'draw'].includes(r.id)).flatMap((r) => r.cards));
  const want = karstenLands(health.averageMv, main.filter((c) => cheap.has(c.card.name) && (c.card.cmc ?? 0) <= 2).reduce((n, c) => n + c.quantity, 0));
  const page = list.commander && edhrecEnabled() ? await commanderPage(list.commander.name).catch(() => null) : null;
  // What the commander itself does, from the same tags (it is in every game).
  const commanderRoles = list.commander
    ? (await countRoles([{ card: list.commander, quantity: 1 }], { search: (q) => searchCards(q), cached: cachedRoles, save: saveRoles }))
      .filter((r) => r.count > 0).map((r) => r.id)
    : [];
  const settings = cutSettings(list.id);
  const styles = planStyles(list.id, list.commander, main);
  const plan = planFor(list.id, '', list.commander, main);
  const tags = deckTags(list.id);
  const result = cutCandidates({
    cards: main, roles, fit: fitProfile(list.commander), commander: list.commander, commanderRoles,
    tags, keep: keeps(list.id), stats: page?.stats ?? null,
    // Lands are offered only over the plan's range (its flip turn's), never to make room.
    lands: { have: health.lands, want: Math.max(want, plan.lands[1]) - 1 },
    packages: plan.packages,
    settings, styles,
  });
  return { ...result, main, health, roles, settings, styles, tags };
}
