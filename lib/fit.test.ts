/**
 * Commander fit, from made-up cards.
 */

import { describe, expect, it } from 'vitest';

import { fitOf, fitProfile, popularity } from './fit';
import type { ScryfallCard } from './scryfall';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) => ({ id: name, name, type_line, oracle_text, ...extra }) as ScryfallCard;
const azula = card('Fire Lord Azula', 'Legendary Creature — Human Noble', 'Whenever you cast a spell while Fire Lord Azula is attacking, copy that spell.');
const ulalek = card('Ulalek, Fused Atrocity', 'Legendary Creature — Eldrazi', 'Whenever you cast an Eldrazi spell, you may pay {C}{C}. If you do, copy all spells you control.');

describe('fit', () => {
  it('reads what a commander cares about and matches cards that do it', () => {
    const p = fitProfile(azula)!;
    expect(p.themes.map((t) => t.name)).toContain('attacking');
    expect(fitOf(card('Opt', 'Instant', 'Scry 1. Draw a card.'), fitProfile(card('X', 'Legendary Creature', 'Magecraft — Whenever you cast or copy an instant or sorcery spell, draw a card.'))).matches).toContain('instants and sorceries');
    const eldrazi = fitProfile(ulalek)!;
    expect(eldrazi.types).toContain('Eldrazi');
    expect(fitOf(card('Artisan of Kozilek', 'Creature — Eldrazi', 'Annihilator 2'), eldrazi).score).toBeGreaterThan(0);
    expect(fitOf(card('Llanowar Elves', 'Creature — Elf Druid', '{T}: Add {G}.'), eldrazi).score).toBe(0);
  });

  it('ranks popularity from Scryfall\'s rank', () => {
    expect(popularity(card('Sol Ring', 'Artifact', '', { edhrec_rank: 1 }))).toBe(1);
    expect(popularity(card('Obscure', 'Artifact', '', { edhrec_rank: 30_000 }))).toBeLessThan(0.1);
    expect(popularity(card('Unranked', 'Artifact', ''))).toBe(0);
  });
});
