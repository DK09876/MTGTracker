/**
 * Reading a collection export: the CSVs ManaBox, Moxfield, Deckbox and
 * TCGplayer write, or a plain list ("4 Opt (m21) 59 *F*"), and finding each
 * card on Scryfall - by its Scryfall id if the file has one, then by set and
 * collector number, then by name.
 *
 * Every app names its columns differently; each column is found by any of
 * the names it goes by. A box or binder column (ManaBox's "Binder Name")
 * sorts cards into boxes; otherwise they go where the import was asked to
 * put them. Proxies in a Moxfield export are left out.
 */

import { parseDecklist } from './decklist';
import type { Finish, Identifier, ScryfallCard } from './scryfall';

export interface ImportRow {
  quantity: number;
  name: string;
  set?: string;
  number?: string;
  scryfallId?: string;
  finish: Finish;
  location: string;
  /** The line as written, to report one that could not be found. */
  line: string;
}

export type Format = 'ManaBox' | 'Moxfield' | 'Deckbox' | 'TCGplayer' | 'CSV' | 'text';

/** CSV rows, with quoted fields ("Borrowing 100,000 Arrows") and doubled quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}

const COLUMNS = {
  quantity: ['quantity', 'count', 'qty', 'amount'],
  // TCGplayer's "Simple Name" drops "(Borderless)" and the like.
  name: ['simple name', 'name', 'card name', 'card'],
  setCode: ['set code', 'edition code', 'set_code', 'setcode'],
  setMaybe: ['edition', 'set'],
  number: ['collector number', 'card number', 'collector_number', 'number', 'cn'],
  scryfallId: ['scryfall id', 'scryfall_id', 'scryfallid'],
  foil: ['foil', 'printing', 'finish'],
  location: ['binder name', 'binder', 'location', 'box', 'folder'],
  proxy: ['proxy'],
};

function formatOf(headers: string[]): Format {
  if (headers.includes('manabox id') || headers.includes('binder name')) return 'ManaBox';
  if (headers.includes('simple name') || headers.includes('sku')) return 'TCGplayer';
  if (headers.includes('edition code') && headers.includes('tradelist count')) return 'Deckbox';
  if (headers.includes('tradelist count')) return 'Moxfield';
  return 'CSV';
}

function finishOf(value: string | undefined): Finish {
  const v = (value ?? '').trim().toLowerCase();
  if (v.includes('etched')) return 'etched';
  if (v === 'true' || v === 'yes' || v === '1' || v.includes('foil') && !v.includes('non')) return 'foil';
  return 'nonfoil';
}

/** The cards a file lists, where they go, and lines that could not be read. */
export function readCollectionFile(text: string, location = ''): { rows: ImportRow[]; unreadable: string[]; format: Format } {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const table = firstLine.includes(',') ? parseCsv(text) : [];
  const headers = table[0]?.map((h) => h.trim().toLowerCase()) ?? [];
  if (headers.some((h) => COLUMNS.name.includes(h))) {
    const col = (names: string[]) => names.map((n) => headers.indexOf(n)).find((i) => i >= 0) ?? -1;
    const at = {
      quantity: col(COLUMNS.quantity), name: col(COLUMNS.name), setCode: col(COLUMNS.setCode), setMaybe: col(COLUMNS.setMaybe),
      number: col(COLUMNS.number), scryfallId: col(COLUMNS.scryfallId), foil: col(COLUMNS.foil),
      location: col(COLUMNS.location), proxy: col(COLUMNS.proxy),
    };
    const rows: ImportRow[] = [];
    const unreadable: string[] = [];
    for (const cells of table.slice(1)) {
      const get = (i: number) => (i >= 0 ? cells[i]?.trim() ?? '' : '');
      const line = cells.join(',');
      const name = get(at.name);
      const quantity = at.quantity >= 0 ? Number.parseInt(get(at.quantity), 10) : 1;
      if (!name || !Number.isFinite(quantity) || quantity <= 0) {
        unreadable.push(line);
        continue;
      }
      if (/^(true|yes|1)$/i.test(get(at.proxy))) continue;
      const maybeSet = get(at.setMaybe);
      const set = (get(at.setCode) || (/^[a-z0-9]{2,6}$/i.test(maybeSet) ? maybeSet : '')).toLowerCase() || undefined;
      rows.push({
        quantity, name, set, number: get(at.number) || undefined, scryfallId: get(at.scryfallId) || undefined,
        finish: finishOf(get(at.foil)), location: get(at.location) || location, line,
      });
    }
    return { rows, unreadable, format: formatOf(headers) };
  }

  const { entries, unreadable } = parseDecklist(text);
  return {
    rows: entries.filter((e) => e.section !== 'skip').map((e) => ({
      quantity: e.quantity, name: e.name, set: e.set, number: e.collectorNumber, finish: e.finish, location, line: e.line,
    })),
    unreadable,
    format: 'text',
  };
}

type Lookup = (identifiers: Identifier[]) => Promise<{ cards: ScryfallCard[] }>;

const front = (name: string) => name.split(' // ')[0].trim().toLowerCase();

/** Find each row's card: the exact printing where the file says, by name where it does not or Scryfall does not know it. */
export async function resolveRows(rows: ImportRow[], lookup: Lookup): Promise<{
  items: Array<{ card: ScryfallCard; quantity: number; finish: Finish; location: string }>;
  missing: string[];
  /** Lines whose printing did not match their name - a typo'd number - found by name instead. */
  byName: string[];
}> {
  const found = new Map<ImportRow, ScryfallCard>();
  const mismatched = new Set<ImportRow>();
  const exact = (r: ImportRow): Identifier | null =>
    r.scryfallId ? { id: r.scryfallId } : r.set && r.number ? { set: r.set, collector_number: r.number } : null;

  // Exact printings first, all in as few requests as Scryfall allows.
  const precise = rows.filter((r) => exact(r));
  if (precise.length) {
    const unique = [...new Map(precise.map((r) => [JSON.stringify(exact(r)), exact(r)!])).values()];
    const { cards } = await lookup(unique);
    const byId = new Map(cards.map((c) => [c.id, c]));
    const byPrint = new Map(cards.map((c) => [`${c.set}|${c.collector_number}`.toLowerCase(), c]));
    for (const r of precise) {
      const card = r.scryfallId ? byId.get(r.scryfallId) : byPrint.get(`${r.set}|${r.number}`.toLowerCase());
      // The printing must be the card the line names: "Lotus Cobra (zen) 139"
      // is Murasa Pyromancer, and importing that silently would be wrong.
      if (card && sameCard(card, r.name)) found.set(r, card);
      else if (card) mismatched.add(r);
    }
  }
  // Then by name: rows without a printing, and printings Scryfall did not know.
  const byName = rows.filter((r) => !found.has(r));
  if (byName.length) {
    const names = [...new Set(byName.map((r) => front(r.name)))];
    const { cards } = await lookup(names.map((name) => ({ name })));
    const map = new Map(cards.map((c) => [front(c.name), c]));
    for (const r of byName) {
      const card = map.get(front(r.name));
      if (card) found.set(r, card);
    }
  }
  return {
    items: rows.filter((r) => found.has(r)).map((r) => ({ card: found.get(r)!, quantity: r.quantity, finish: r.finish, location: r.location })),
    missing: rows.filter((r) => !found.has(r)).map((r) => r.line),
    byName: rows.filter((r) => mismatched.has(r) && found.has(r)).map((r) => r.line),
  };
}

/** Whether a card is the one a line names: its full name, or either face of a double-faced card. */
function sameCard(card: ScryfallCard, name: string): boolean {
  const wanted = name.trim().toLowerCase();
  const names = [card.name, ...card.name.split(' // '), ...(card.card_faces?.map((f) => f.name) ?? [])].map((n) => n.trim().toLowerCase());
  return names.includes(wanted) || names.includes(front(wanted));
}

/** The collection as a CSV that ManaBox, Moxfield and this app can read back. */
export function toCsv(rows: Array<{ card: ScryfallCard; quantity: number; finish: Finish; location: string }>): string {
  const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = ['Name,Set code,Collector number,Foil,Quantity,Scryfall ID,Binder Name'];
  for (const r of rows) {
    lines.push([r.card.name, r.card.set ?? '', r.card.collector_number ?? '', r.finish === 'nonfoil' ? 'normal' : r.finish,
      String(r.quantity), r.card.id, r.location].map(q).join(','));
  }
  return lines.join('\n') + '\n';
}
