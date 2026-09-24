/**
 * Decklists as other sites export them. The first block is a real Moxfield
 * export, trimmed.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { describe, expect, it } from 'vitest';

import { formatDecklist, parseDecklist } from './decklist';

const MOXFIELD = `1x Kratos, God of War (SLD) 2207
1x Alexios, Deimos of Kosmos (ACR) 134 *F*
1x Razorkin Needlehead (PDSK) 153p
1x Lightning Bolt (PF19) 1 *F*
1x Fire Nation Palace (TLA) 268
33x Mountain (ACR) 107`;

describe('parseDecklist', () => {
  it('reads count, name, printing and foil', () => {
    const { entries, unreadable } = parseDecklist(MOXFIELD);
    expect(unreadable).toEqual([]);
    expect(entries.map((e) => ({ quantity: e.quantity, name: e.name, set: e.set, collectorNumber: e.collectorNumber, finish: e.finish, section: e.section }))).toEqual([
      { quantity: 1, name: 'Kratos, God of War', set: 'sld', collectorNumber: '2207', finish: 'nonfoil', section: 'main' },
      { quantity: 1, name: 'Alexios, Deimos of Kosmos', set: 'acr', collectorNumber: '134', finish: 'foil', section: 'main' },
      { quantity: 1, name: 'Razorkin Needlehead', set: 'pdsk', collectorNumber: '153p', finish: 'nonfoil', section: 'main' },
      { quantity: 1, name: 'Lightning Bolt', set: 'pf19', collectorNumber: '1', finish: 'foil', section: 'main' },
      { quantity: 1, name: 'Fire Nation Palace', set: 'tla', collectorNumber: '268', finish: 'nonfoil', section: 'main' },
      { quantity: 33, name: 'Mountain', set: 'acr', collectorNumber: '107', finish: 'nonfoil', section: 'main' },
    ]);
  });

  // A real Moxfield export: odd collector numbers, split cards, etched foils.
  it('reads every line of a full Moxfield export', () => {
    const { entries, unreadable } = parseDecklist(readFileSync(join(__dirname, 'fixtures/hearthhull.txt'), 'utf8'));
    expect(unreadable).toEqual([]);
    expect(entries.reduce((n, e) => n + e.quantity, 0)).toBe(100);
    const at = (name: string) => entries.find((e) => e.name === name)!;
    expect(at('Orcish Lumberjack')).toMatchObject({ set: 'plst', collectorNumber: 'DDL-44' });
    expect(at('Ancient Greenwarden')).toMatchObject({ set: 'pznr', collectorNumber: '178p' });
    expect(at("Assassin's Trophy").finish).toBe('etched');
    expect(at('Hearthhull, the Worldseed').finish).toBe('foil');
    expect(at('Disciple of Freyalise // Garden of Freyalise')).toMatchObject({ collectorNumber: '250', finish: 'foil' });
    expect(at('Summon: Titan')).toMatchObject({ set: 'fin', collectorNumber: '373' });
  });

  it('reads plain lines with or without a count', () => {
    const { entries } = parseDecklist('4 Counterspell\nSol Ring\n2x Island');
    expect(entries.map((e) => [e.quantity, e.name, e.set])).toEqual([
      [4, 'Counterspell', undefined], [1, 'Sol Ring', undefined], [2, 'Island', undefined],
    ]);
  });

  it('keeps a split or double-faced name whole', () => {
    const { entries } = parseDecklist('1 Fire // Ice (MH2) 290\n1 Delver of Secrets // Insectile Aberration');
    expect(entries.map((e) => e.name)).toEqual(['Fire // Ice', 'Delver of Secrets // Insectile Aberration']);
  });

  it('follows section headings, however they are written', () => {
    const text = 'Commander\n1 Fire Lord Azula\n\nDeck\n1 Snap\n\n// Sideboard\n1 Pyroblast\nMAYBEBOARD:\n1 Opt';
    const { entries } = parseDecklist(text);
    expect(entries.map((e) => [e.name, e.section])).toEqual([
      ['Fire Lord Azula', 'commander'], ['Snap', 'main'], ['Pyroblast', 'side'], ['Opt', 'side'],
    ]);
  });

  it('reports what it could not read, and skips comments', () => {
    const { entries, unreadable } = parseDecklist('# my deck\n// notes on the deck\n12\n1 Sol Ring');
    expect(entries.map((e) => e.name)).toEqual(['Sol Ring']);
    expect(unreadable).toEqual(['12']);
  });

  it('writes a deck out as Moxfield exports it, commander first, and reads it back the same', () => {
    const card = (name: string, set: string, collector_number: string) => ({ id: name, name, set, collector_number }) as never;
    const text = formatDecklist(card('Hearthhull, the Worldseed', 'eoc', '1'), [
      { card: card('Sol Ring', 'soc', '128'), quantity: 1 },
      { card: card("Assassin's Trophy", 'acr', '228'), quantity: 1, finish: 'etched' },
      { card: card('Forest', 'eoe', '276'), quantity: 6 },
    ], 'foil');
    expect(text).toBe([
      '1x Hearthhull, the Worldseed (eoc) 1 *F*',
      "1x Assassin's Trophy (acr) 228 *E*",
      '6x Forest (eoe) 276',
      '1x Sol Ring (soc) 128',
    ].join('\n'));
    expect(parseDecklist(text).entries.map((e) => [e.quantity, e.name, e.set, e.collectorNumber, e.finish])).toEqual([
      [1, 'Hearthhull, the Worldseed', 'eoc', '1', 'foil'],
      [1, "Assassin's Trophy", 'acr', '228', 'etched'],
      [6, 'Forest', 'eoe', '276', 'nonfoil'],
      [1, 'Sol Ring', 'soc', '128', 'nonfoil'],
    ]);
  });
});
