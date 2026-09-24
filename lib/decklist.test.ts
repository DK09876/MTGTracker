/**
 * Decklists as other sites export them. The first block is a real Moxfield
 * export, trimmed.
 */

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
    expect(entries.map((e) => ({ quantity: e.quantity, name: e.name, set: e.set, collectorNumber: e.collectorNumber, foil: e.foil, section: e.section }))).toEqual([
      { quantity: 1, name: 'Kratos, God of War', set: 'sld', collectorNumber: '2207', foil: false, section: 'main' },
      { quantity: 1, name: 'Alexios, Deimos of Kosmos', set: 'acr', collectorNumber: '134', foil: true, section: 'main' },
      { quantity: 1, name: 'Razorkin Needlehead', set: 'pdsk', collectorNumber: '153p', foil: false, section: 'main' },
      { quantity: 1, name: 'Lightning Bolt', set: 'pf19', collectorNumber: '1', foil: true, section: 'main' },
      { quantity: 1, name: 'Fire Nation Palace', set: 'tla', collectorNumber: '268', foil: false, section: 'main' },
      { quantity: 33, name: 'Mountain', set: 'acr', collectorNumber: '107', foil: false, section: 'main' },
    ]);
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

  it('writes a deck out in the format it reads back', () => {
    const card = (name: string, set: string, collector_number: string) => ({ id: name, name, set, collector_number }) as never;
    const text = formatDecklist(card('Kratos, God of War', 'sld', '2207'), [
      { card: card('Sol Ring', 'soc', '128'), quantity: 1 },
      { card: card('Mountain', 'acr', '107'), quantity: 33 },
    ]);
    expect(text).toBe('Commander\n1 Kratos, God of War (SLD) 2207\n\nDeck\n33 Mountain (ACR) 107\n1 Sol Ring (SOC) 128');
    const back = parseDecklist(text).entries;
    expect(back.map((e) => [e.section, e.quantity, e.name, e.set, e.collectorNumber])).toEqual([
      ['commander', 1, 'Kratos, God of War', 'sld', '2207'],
      ['main', 33, 'Mountain', 'acr', '107'],
      ['main', 1, 'Sol Ring', 'soc', '128'],
    ]);
  });
});
