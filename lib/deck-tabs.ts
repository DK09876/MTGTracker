/**
 * A deck's tabs: Cards, Plan, Tune, Check and Chat. The tabs the deck used
 * to have still lead somewhere - Tags into Plan, Health and Playtest into
 * Check, Collection into Cards with your copies showing, the old
 * Suggestions into Tune - so links, tours and saved places keep working.
 * Pure.
 */

export type DeckTab = 'cards' | 'plan' | 'tune' | 'check' | 'chat';

/** Where on a tab to land: a section to scroll to, or Check's Health or Playtest. */
export interface TabPlace {
  tab: DeckTab;
  /** Check: which half. */
  check?: 'health' | 'playtest';
  /** Cards: show which cards you own and where (was the Collection tab). */
  copies?: boolean;
  /** An element id to scroll to once the tab shows. */
  anchor?: string;
}

export const DECK_TABS: Array<[DeckTab, string]> = [['cards', 'Cards'], ['plan', 'Plan'], ['tune', 'Tune'], ['check', 'Check'], ['chat', 'Chat']];

/** Any tab name, old or new, as the place it now is. */
export function placeOf(tab: string): TabPlace {
  switch (tab) {
    case 'cards': case 'plan': case 'tune': case 'chat': return { tab };
    case 'check': case 'health': return { tab: 'check', check: 'health' };
    case 'playtest': return { tab: 'check', check: 'playtest' };
    case 'tags': return { tab: 'plan', anchor: 'plan-tags' };
    case 'collection': return { tab: 'cards', copies: true, anchor: 'your-copies' };
    case 'suggestions': case 'build': return { tab: 'tune' };
    default: return { tab: 'cards' };
  }
}
