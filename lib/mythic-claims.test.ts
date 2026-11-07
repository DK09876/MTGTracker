/**
 * Two Mythic Tools decks whose exports claim the same single copy - real
 * double-claims from the owner's own exports (lib/fixtures/mythic): Myr
 * Convert, Skrelv's Hive and Akroma's Will are in both SCRY TIL THEY DIE
 * and I'm just a girl, where they are proxies; Esper Sentinel is in SCRY
 * and Odd and Ends, and was moved to SCRY. The deck whose line is not a
 * proxy gets the real copy whatever the order; otherwise the first deck
 * keeps it. A real database in a temporary file; Scryfall is stood in for.
 */

import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Identifier, ScryfallCard } from './scryfall';

vi.setConfig({ testTimeout: 60_000 });

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures/mythic', name), 'utf8');
const DECKS = {
  scry: { name: 'SCRY TIL THEY DIE', list: fixture('scry.list.txt'), linked: fixture('scry.linked.txt') },
  girl: { name: "I'm just a girl", list: fixture('girl.list.txt'), linked: fixture('girl.linked.txt') },
  odd: { name: 'Odd and Ends (Copy from @WotC)', list: fixture('odd.list.txt'), linked: fixture('odd.linked.txt') },
};
// Only the contested copies are in the collection: every other line just has nothing to link.
const CSV = fixture('claims.csv');

// Every printing the exports name, as a card; each list's first line is its commander.
const cards = new Map<string, ScryfallCard>();
const commanders = new Set(Object.values(DECKS).map((d) => d.list.match(/^\d+ (.+?) \(/)![1]));
function remember(name: string, set: string, number: string) {
  const key = `${set.toLowerCase()}|${number}`;
  if (cards.has(key)) return;
  cards.set(key, {
    id: `${set.toLowerCase()}-${number}`, oracle_id: `o-${name}`, name, set: set.toLowerCase(), collector_number: number,
    type_line: commanders.has(name) ? 'Legendary Creature — Human' : /^(Mountain|Plains|Island|Swamp|Forest)$/.test(name) ? `Basic Land — ${name}` : 'Artifact',
    legalities: { commander: 'legal' }, prices: { usd: '1.00', usd_foil: '2.00' }, finishes: ['nonfoil', 'foil', 'etched'],
  } as ScryfallCard);
}
for (const d of Object.values(DECKS)) {
  for (const m of d.list.matchAll(/^\d+ (.+?) \(([A-Z0-9]+)\) (\S+)/gm)) remember(m[1], m[2], m[3]);
  for (const m of d.linked.matchAll(/^\d+x (.+?) \(([a-z0-9]+)\) #(\S+)/gm)) {
    const english = m[1].match(/\(([^()]+)\)$/)?.[1];
    remember(english && /[^\x20-\x7E]/.test(m[1]) ? english : m[1], m[2], m[3]);
  }
}
remember('Esper Sentinel', 'mh2', '12');

const lookup = async (identifiers: Identifier[]) => ({
  cards: identifiers.map((id) => ('set' in id ? cards.get(`${id.set.toLowerCase()}|${id.collector_number}`)
    : 'name' in id ? [...cards.values()].find((c) => c.name.toLowerCase() === id.name.toLowerCase()) : undefined))
    .filter((c): c is ScryfallCard => !!c),
  notFound: [],
});

vi.mock('./scryfall', async (original) => ({
  ...(await original<typeof import('./scryfall')>()),
  collection: (identifiers: Identifier[]) => lookup(identifiers),
}));

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-claims-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

/** Import the collection, then the decks in this order; answers where each contested card's copies went. */
async function importInOrder(order: Array<keyof typeof DECKS>) {
  const db = await import('./db');
  db.addProfile('dk', 'DK');
  const run = await import('./collection-import-run');
  const mythic = await import('./mythic');
  const col = await import('./collection');
  await run.runCollectionImport('dk', CSV, { mode: 'replace', lookup });
  const results = await mythic.importMythicDecks('dk', order.map((k) => DECKS[k]));
  const ids = Object.fromEntries(order.map((k, i) => [k, results[i].list.id])) as Record<keyof typeof DECKS, string>;
  // "Myr Convert" → {scry: 'real', girl: 'proxy copy'}, from what each deck holds.
  const held = (card: string) => Object.fromEntries(order.map((k) => {
    const h = col.ownership({ id: ids[k] }).cards.find((x) => x.name === card);
    const copies = (h?.pulledCopies ?? []).map((p) => (p.variant.split(',').includes('proxy') ? 'proxy copy' : `real ${p.set}#${p.number} from ${p.fromLocation}`));
    return [k, copies.length ? copies.join(' + ') : h?.status ?? 'not in deck'];
  }));
  return { held, results, ids, col };
}

describe('two decks claiming one copy', () => {
  for (const order of [['scry', 'girl', 'odd'], ['girl', 'odd', 'scry'], ['odd', 'girl', 'scry']] as const) {
    it(`gives the real copy to the deck whose line is not a proxy (${order.join(', ')})`, async () => {
      const { held } = await importInOrder([...order]);
      for (const card of ['Myr Convert', "Skrelv's Hive", "Akroma's Will"]) {
        expect(held(card).scry).toMatch(/^real /);
        expect(held(card).girl).toBe('proxy copy');
      }
    });
  }

  it('gives Esper Sentinel to SCRY in any order: its export is the only one that still claims it', async () => {
    for (const order of [['scry', 'odd'], ['odd', 'scry']] as const) {
      const { held } = await importInOrder([...order]);
      expect(held('Esper Sentinel').scry).toBe('real sld#2123 from bulk');
      // The Play binder's other printing is still free for Odd and Ends.
      expect(held('Esper Sentinel').odd).toBe('in-box');
      vi.resetModules();
      rmSync(dir, { recursive: true, force: true });
      dir = mkdtempSync(join(tmpdir(), 'mtg-claims-'));
      vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
    }
  });

  // Odd and Ends' export from before the move, when it still named the copy.
  const before = DECKS.odd.linked.replace('From "bulk"\n', 'From "bulk"\n1x Esper Sentinel (sld) #2123 FOIL\n').replace(/^Available in my collection \(not yet linked\):\n1x Esper Sentinel \(sld\) #2123 FOIL\n/m, 'Available in my collection (not yet linked):\n');
  for (const [first, second] of [['scry', 'odd'], ['odd', 'scry']] as const) {
    it(`keeps first-come when neither line is a proxy: ${first} first gets Esper Sentinel`, async () => {
      DECKS.odd.linked = before;
      try {
        const { held, results } = await importInOrder([first, second]);
        expect(held('Esper Sentinel')[first]).toBe('real sld#2123 from bulk');
        // The second deck finds the copy gone from bulk and takes the other one, from the Play binder, saying so.
        expect(held('Esper Sentinel')[second]).toMatch(/from Play$/);
        expect(results[1].link?.otherBox.some((l) => l.includes('Esper Sentinel'))).toBe(true);
      } finally {
        DECKS.odd.linked = fixture('odd.linked.txt');
      }
    });
  }

  it('marks a proxy line as a proxy when the only real copy is claimed by a deck still to come', async () => {
    // Without the bulk proxy copies, I'm just a girl, first, would take the real copies SCRY's lines name.
    const csv = CSV.split('\n').filter((l) => !(/Myr Convert|Skrelv/.test(l) && l.includes(',false,false,false,true,'))).join('\n');
    const db = await import('./db');
    db.addProfile('dk', 'DK');
    const run = await import('./collection-import-run');
    const mythic = await import('./mythic');
    const col = await import('./collection');
    await run.runCollectionImport('dk', csv, { mode: 'replace', lookup });
    const [girl, scry] = await mythic.importMythicDecks('dk', [DECKS.girl, DECKS.scry]);
    for (const card of ['Myr Convert', "Skrelv's Hive"]) {
      expect(col.ownership({ id: scry.list.id }).cards.find((h) => h.name === card)?.status).toBe('in-deck');
      expect(col.ownership({ id: girl.list.id }).cards.find((h) => h.name === card)?.status).toBe('proxy');
    }
    expect(girl.link?.yielded.length).toBe(2);
  });
});
