/**
 * A deck's own tags - "Sac outlets", "Token makers", "Win conditions" -
 * which the owner writes, or has the model propose and apply. Shared by the
 * server and the browser, so nothing here touches the database.
 *
 * Tags belong to one deck: what counts as a "payoff" depends on the plan.
 * A card is tagged by its oracle id, so changing its printing keeps its tags.
 */

import type { ScryfallCard } from './scryfall';

/** proposed: suggested by the model, not yet reviewed. rejected: kept so it is not suggested again. */
export type TagStatus = 'proposed' | 'accepted' | 'rejected';
export type TagKind = 'role' | 'plan' | 'synergy' | 'wincon' | 'utility';

export interface Tag {
  id: string;
  name: string;
  /** What a card must do to carry this tag - the model tags by it, so it is worth writing precisely. */
  description: string;
  color: string;
  kind: TagKind | null;
  status: TagStatus;
  origin: 'ai' | 'manual';
  position: number;
  /** For a proposal: the deck's cards the model expects to fit, so it can be judged before accepting. */
  examples: string[];
}

/**
 * One card carrying one tag. `on: false` records the owner taking a tag off,
 * so re-running the model does not put it back.
 */
export interface CardTag {
  key: string;
  tagId: string;
  source: 'ai' | 'manual';
  on: boolean;
  /** Why the model applied it, citing the card's text. Empty for manual tags. */
  reason: string;
}

export interface DeckTags {
  /** What the owner wants the deck, or parts of it, to do - read by every model step. */
  brief: string;
  /** The model's short read of the deck, from the last time it proposed tags. */
  overview: string;
  tags: Tag[];
  cardTags: CardTag[];
}

export const TAG_KINDS: Record<TagKind, string> = {
  role: 'Role',
  plan: 'Game plan',
  synergy: 'Synergy',
  wincon: 'Win condition',
  utility: 'Utility',
};

// Distinct on the dark surface, and each readable as text on a 15% tint of itself.
export const TAG_COLORS = [
  '#e0b64a', '#5fb3e8', '#7ccf8a', '#e8785f', '#b58be8',
  '#e86fb0', '#4fd1c5', '#f0a35e', '#9aa7ff', '#c3d45b',
];

/** The colour for the next tag: the first not yet used, else round again. */
export function nextColor(used: string[]): string {
  return TAG_COLORS.find((c) => !used.includes(c)) ?? TAG_COLORS[used.length % TAG_COLORS.length];
}

/** Which card a tag is on - the oracle id, so every printing shares it. */
export const tagKey = (card: ScryfallCard): string => card.oracle_id ?? card.id;

/** The accepted tags on each card, in the deck's tag order. */
export function tagsByCard(data: DeckTags): Map<string, Array<{ tag: Tag; link: CardTag }>> {
  const accepted = new Map(data.tags.filter((t) => t.status === 'accepted').map((t) => [t.id, t]));
  const out = new Map<string, Array<{ tag: Tag; link: CardTag }>>();
  for (const link of data.cardTags) {
    const tag = accepted.get(link.tagId);
    if (!tag || !link.on) continue;
    const list = out.get(link.key) ?? [];
    list.push({ tag, link });
    out.set(link.key, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.tag.position - b.tag.position);
  return out;
}
