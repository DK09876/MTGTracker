import { describe, expect, it } from 'vitest';

import { parseCsv, readCollectionFile, resolveRows, toCsv } from './collection-import';
import type { Identifier, ScryfallCard } from './scryfall';

const MANABOX = `Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price,Misprint,Altered,Condition,Language,Purchase price currency,Binder Name,Binder Type
Sol Ring,c21,Commander 2021,263,normal,uncommon,2,1,sol-c21,1.2,false,false,near_mint,en,USD,Artifacts,binder
"Borrowing 100,000 Arrows",a25,Masters 25,43,foil,uncommon,1,2,,0.3,false,false,near_mint,en,USD,,`;

const MOXFIELD = `"Count","Tradelist Count","Name","Edition","Condition","Language","Foil","Tags","Last Modified","Collector Number","Alter","Proxy","Purchase Price"
"1","0","Opt","m21","Near Mint","English","foil","","2026-01-01","59","False","False",""
"1","0","Mana Crypt","2xm","Near Mint","English","","","2026-01-01","270","False","True",""`;

const TCGPLAYER = `Quantity,Name,Simple Name,Set,Card Number,Set Code,Printing,Condition,Language,Rarity,Product ID,SKU
3,Lightning Bolt (Borderless),Lightning Bolt,Secret Lair,1,SLD,Normal,Near Mint,English,Rare,1,2`;

describe('parseCsv', () => {
  it('handles quoted commas, doubled quotes and CRLF', () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\r\n')).toEqual([['a', 'b, c', 'say "hi"'], ['1', '2', '3']]);
  });
});

describe('readCollectionFile', () => {
  it('reads ManaBox, with binders as boxes and Scryfall ids', () => {
    const { rows, format } = readCollectionFile(MANABOX, 'Unsorted box');
    expect(format).toBe('ManaBox');
    expect(rows).toEqual([
      expect.objectContaining({ quantity: 2, name: 'Sol Ring', set: 'c21', number: '263', scryfallId: 'sol-c21', finish: 'nonfoil', location: 'Artifacts' }),
      expect.objectContaining({ quantity: 1, name: 'Borrowing 100,000 Arrows', set: 'a25', finish: 'foil', location: 'Unsorted box' }),
    ]);
  });

  it('reads Moxfield, leaving out proxies', () => {
    const { rows, format } = readCollectionFile(MOXFIELD);
    expect(format).toBe('Moxfield');
    expect(rows).toEqual([expect.objectContaining({ name: 'Opt', set: 'm21', number: '59', finish: 'foil' })]);
  });

  it('reads TCGplayer by its plain names and set codes', () => {
    const { rows, format } = readCollectionFile(TCGPLAYER);
    expect(format).toBe('TCGplayer');
    expect(rows).toEqual([expect.objectContaining({ quantity: 3, name: 'Lightning Bolt', set: 'sld', number: '1', finish: 'nonfoil' })]);
  });

  it('reads a plain list the way decks are written', () => {
    const { rows, format } = readCollectionFile('4 Opt (M21) 59 *F*\n1x Sol Ring\n', 'Binder');
    expect(format).toBe('text');
    expect(rows).toEqual([
      expect.objectContaining({ quantity: 4, name: 'Opt', set: 'm21', number: '59', finish: 'foil', location: 'Binder' }),
      expect.objectContaining({ quantity: 1, name: 'Sol Ring', finish: 'nonfoil' }),
    ]);
  });
});

describe('resolveRows', () => {
  const card = (id: string, name: string, set: string, number: string) => ({ id, name, set, collector_number: number }) as ScryfallCard;
  const known = [card('sol-c21', 'Sol Ring', 'c21', '263'), card('opt-m21', 'Opt', 'm21', '59'), card('opt-xln', 'Opt', 'xln', '65')];
  const lookup = async (ids: Identifier[]) => ({
    cards: ids.flatMap((id) => {
      const hit = 'id' in id ? known.find((c) => c.id === id.id)
        : 'set' in id ? known.find((c) => c.set === id.set && c.collector_number === id.collector_number)
          : known.find((c) => c.name.toLowerCase() === id.name);
      return hit ? [hit] : [];
    }),
  });

  it('uses the Scryfall id, then set and number, then the name, and reports what is left', async () => {
    const { rows } = readCollectionFile(`${MANABOX}\n`);
    const extra = readCollectionFile('2 Opt (m21) 59\n1 Opt (zzz) 9\n1 Not A Card').rows;
    const { items, missing } = await resolveRows([...rows, ...extra], lookup);
    expect(items.map((i) => [i.card.id, i.quantity])).toEqual([['sol-c21', 2], ['opt-m21', 2], ['opt-m21', 1]]);
    expect(missing).toEqual([expect.stringContaining('Borrowing'), '1 Not A Card']);
  });

  it('does not trust a set and number that are a different card', async () => {
    const { rows } = readCollectionFile('1 Sol Ring (m21) 59\n');
    const { items, byName } = await resolveRows(rows, lookup);
    expect(items.map((i) => i.card.id)).toEqual(['sol-c21']);
    expect(byName).toEqual(['1 Sol Ring (m21) 59']);
  });

  it('writes a CSV it can read back', () => {
    const csv = toCsv([{ card: known[0], quantity: 2, finish: 'foil', location: 'Artifacts' }]);
    expect(readCollectionFile(csv).rows).toEqual([
      expect.objectContaining({ name: 'Sol Ring', quantity: 2, finish: 'foil', location: 'Artifacts', scryfallId: 'sol-c21' }),
    ]);
  });
});
