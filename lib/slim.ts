/**
 * A card with only what the pages use. Stored cards are Scryfall's whole
 * record - purchase links, every format's legality, multiverse ids - and a
 * collection of a few thousand of them would be tens of megabytes to send.
 */

import type { ScryfallCard } from './scryfall';

const FACE_KEYS = ['name', 'mana_cost', 'type_line', 'oracle_text', 'power', 'toughness', 'loyalty', 'flavor_text', 'artist'] as const;
const KEYS = [
  'id', 'oracle_id', 'name', 'mana_cost', 'cmc', 'type_line', 'oracle_text', 'flavor_text', 'power', 'toughness', 'loyalty',
  'colors', 'color_identity', 'keywords', 'rarity', 'set', 'set_name', 'collector_number', 'artist', 'released_at',
  'scryfall_uri', 'produced_mana', 'game_changer', 'finishes', 'prices',
] as const;

const images = (uris?: ScryfallCard['image_uris']) =>
  uris ? { small: uris.small, normal: uris.normal, art_crop: uris.art_crop } : undefined;

export function slimCard(card: ScryfallCard): ScryfallCard {
  const out: Record<string, unknown> = {};
  for (const k of KEYS) if (card[k] !== undefined) out[k] = card[k];
  out.image_uris = images(card.image_uris);
  if (card.card_faces) {
    out.card_faces = card.card_faces.map((f) => {
      const face: Record<string, unknown> = {};
      for (const k of FACE_KEYS) if (f[k] !== undefined) face[k] = f[k];
      face.image_uris = images(f.image_uris);
      return face;
    });
  }
  if (card.legalities?.commander) out.legalities = { commander: card.legalities.commander };
  return out as unknown as ScryfallCard;
}
