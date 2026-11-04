/**
 * A starter list from a made-up card pool.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScryfallCard } from './scryfall';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-starter-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.resetModules();
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });

const card = (name: string, extra: Partial<ScryfallCard> & Record<string, unknown>) =>
  ({ id: name, oracle_id: `o-${name}`, name, type_line: 'Instant', color_identity: ['U'], legalities: { commander: 'legal' }, cmc: 2, mana_cost: '{1}{U}', edhrec_rank: 500, ...extra }) as ScryfallCard;

describe('starterList', () => {
  it('fills the roles, then the plan, then Karsten\'s lands - 99 cards in the commander\'s colours', async () => {
    const db = await import('./db');
    const { starterList } = await import('./starter');
    const commander = card('Spell Boss', { type_line: 'Legendary Creature — Wizard', color_identity: ['U', 'R'], oracle_text: 'Whenever you cast an instant or sorcery spell, draw a card.' });
    const pool: ScryfallCard[] = [
      card('Sol Ring', { type_line: 'Artifact', color_identity: [], cmc: 1, mana_cost: '{1}' }),
      card('Command Tower', { type_line: 'Land', color_identity: [], produced_mana: ['U', 'R'] }),
      card('Steam Vents', { type_line: 'Land — Island Mountain', color_identity: ['U', 'R'], produced_mana: ['U', 'R'] }),
      card('Off-colour Bomb', { color_identity: ['G'] }),
      card('Game Changer', { game_changer: true }),
      ...Array.from({ length: 120 }, (_, i) => card(`Spell ${i}`, { mana_cost: i % 2 ? '{1}{U}' : '{1}{R}', color_identity: [i % 2 ? 'U' : 'R'] })),
    ];
    // Some of the pool are ramp, draw and removal.
    db.saveRoles(new Map([
      ['o-Sol Ring', ['ramp']], ...Array.from({ length: 12 }, (_, i) => [`o-Spell ${i}`, ['ramp']] as [string, string[]]),
      ...Array.from({ length: 12 }, (_, i) => [`o-Spell ${20 + i}`, ['draw']] as [string, string[]]),
    ]), 5);
    const s = starterList(commander, 'dk', false, pool);
    const counts = s.lines.map((l) => Number(l.split(' ')[0]));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(99);
    expect(s.spells + s.lands).toBe(99);
    const names = s.lines.map((l) => l.replace(/^\d+ /, ''));
    expect(names).toEqual(expect.arrayContaining(['Sol Ring', 'Command Tower', 'Steam Vents', 'Island', 'Mountain']));
    expect(names).not.toContain('Off-colour Bomb');
    expect(names).not.toContain('Game Changer');
    expect(names).not.toContain('Spell Boss');
    // All ten ramp slots filled from the ramp cards.
    expect(names.filter((n) => /^Spell (\d)$|^Spell 1[01]$/.test(n)).length).toBeGreaterThanOrEqual(9);
  }, 20_000);
});
