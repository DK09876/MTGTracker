/**
 * Reading a collection export: the CSVs Mythic Tools, ManaBox, Moxfield,
 * Deckbox and TCGplayer write, or a plain list ("4 Opt (m21) 59 *F*"), and
 * finding each card on Scryfall - by its Scryfall id if the file has one,
 * then by set and collector number, then by name.
 *
 * Every app names its columns differently; each column is found by any of
 * the names it goes by. A box or binder column (ManaBox's "Binder Name",
 * Mythic Tools' "Container Name") sorts cards into boxes; otherwise they go
 * where the import was asked to put them. Language, condition, proxies and
 * the altered/signed/misprint marks are kept on each copy (copy-variant.ts).
 */

import { parseVariant, variantKey } from './copy-variant';
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
  /** Box or binder, when the file says. */
  kind?: 'box' | 'binder';
  /** Language, condition, proxy...: copy-variant.ts. '' for a plain copy. */
  variant: string;
  purchasePrice?: number | null;
  /** The line as written, to report one that could not be found. */
  line: string;
}

export type Format = 'Mythic Tools' | 'ManaBox' | 'Moxfield' | 'Deckbox' | 'TCGplayer' | 'CSV' | 'text';

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
  // TCGplayer's "Simple Name" drops "(Borderless)" and the like; Mythic
  // Tools' "English Name" is the name a Japanese card is found by.
  name: ['simple name', 'english name', 'name', 'card name', 'card'],
  setCode: ['set code', 'edition code', 'set_code', 'setcode'],
  setMaybe: ['edition', 'set'],
  number: ['collector number', 'card number', 'collector_number', 'number', 'cn'],
  scryfallId: ['scryfall id', 'scryfall_id', 'scryfallid'],
  foil: ['foil', 'printing', 'finish'],
  location: ['container name', 'binder name', 'binder', 'location', 'box', 'folder'],
  kind: ['container type', 'binder type'],
  proxy: ['proxy'],
  language: ['language', 'lang'],
  condition: ['condition'],
  altered: ['altered', 'altered art'],
  signed: ['signed'],
  misprint: ['misprint'],
  purchasePrice: ['purchase price (usd)', 'purchase price', 'purchase price (eur)', 'price bought'],
};

const LANGUAGE_CODES: Record<string, string> = {
  english: 'en', japanese: 'ja', french: 'fr', german: 'de', italian: 'it', spanish: 'es', portuguese: 'pt', russian: 'ru',
  korean: 'ko', 'chinese simplified': 'zhs', 'simplified chinese': 'zhs', 'chinese traditional': 'zht', 'traditional chinese': 'zht',
  phyrexian: 'ph', hebrew: 'he', latin: 'la', 'ancient greek': 'grc', arabic: 'ar', sanskrit: 'sa',
};
/** "ja", "Japanese", "JP" - as Scryfall's code. */
function languageOf(value: string): string {
  const v = value.trim().toLowerCase().replace(/[()]/g, '');
  if (!v) return 'en';
  if (LANGUAGE_CODES[v]) return LANGUAGE_CODES[v];
  if (v === 'jp') return 'ja';
  if (v === 'cs' || v === 'zh') return 'zhs';
  if (v === 'ct') return 'zht';
  return /^[a-z]{2,3}$/.test(v) ? v : 'en';
}

const CONDITIONS: Record<string, string> = {
  'near mint': 'NM', mint: 'M', 'lightly played': 'LP', 'slightly played': 'LP', excellent: 'LP', 'moderately played': 'MP',
  played: 'MP', good: 'MP', 'heavily played': 'HP', poor: 'DMG', damaged: 'DMG',
};
function conditionOf(value: string): string {
  const v = value.trim().toLowerCase().replace(/_/g, ' ');
  return CONDITIONS[v] ?? v.toUpperCase();
}

const yes = (v: string) => /^(true|yes|y|1)$/i.test(v.trim());

function formatOf(headers: string[]): Format {
  if (headers.includes('container name') || headers.includes('container type')) return 'Mythic Tools';
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
  text = text.replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const table = firstLine.includes(',') ? parseCsv(text) : [];
  const headers = table[0]?.map((h) => h.trim().toLowerCase()) ?? [];
  if (headers.some((h) => COLUMNS.name.includes(h))) {
    const col = (names: string[]) => names.map((n) => headers.indexOf(n)).find((i) => i >= 0) ?? -1;
    const at = {
      quantity: col(COLUMNS.quantity), name: col(COLUMNS.name), setCode: col(COLUMNS.setCode), setMaybe: col(COLUMNS.setMaybe),
      number: col(COLUMNS.number), scryfallId: col(COLUMNS.scryfallId), foil: col(COLUMNS.foil),
      location: col(COLUMNS.location), kind: col(COLUMNS.kind), proxy: col(COLUMNS.proxy), language: col(COLUMNS.language),
      condition: col(COLUMNS.condition), altered: col(COLUMNS.altered), signed: col(COLUMNS.signed), misprint: col(COLUMNS.misprint),
      purchasePrice: col(COLUMNS.purchasePrice),
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
      const maybeSet = get(at.setMaybe);
      const set = (get(at.setCode) || (/^[a-z0-9]{2,6}$/i.test(maybeSet) ? maybeSet : '')).toLowerCase() || undefined;
      const kind = get(at.kind).toLowerCase();
      const paid = Number.parseFloat(get(at.purchasePrice).replace(/[^0-9.]/g, ''));
      rows.push({
        quantity, name, set, number: get(at.number) || undefined, scryfallId: get(at.scryfallId) || undefined,
        finish: finishOf(get(at.foil)), location: get(at.location) || location,
        kind: kind === 'binder' || kind === 'box' ? kind : undefined,
        variant: variantKey({
          language: languageOf(get(at.language)), condition: conditionOf(get(at.condition)), proxy: yes(get(at.proxy)),
          altered: yes(get(at.altered)), signed: yes(get(at.signed)), misprint: yes(get(at.misprint)),
        }),
        purchasePrice: Number.isFinite(paid) && paid > 0 ? paid : null,
        line,
      });
    }
    return { rows, unreadable, format: formatOf(headers) };
  }

  const { entries, unreadable } = parseDecklist(text);
  return {
    rows: entries.filter((e) => e.section !== 'skip').map((e) => ({
      quantity: e.quantity, name: e.name, set: e.set, number: e.collectorNumber, finish: e.finish, location,
      variant: variantKey({ proxy: e.proxy }), line: e.line,
    })),
    unreadable,
    format: 'text',
  };
}

type Lookup = (identifiers: Identifier[]) => Promise<{ cards: ScryfallCard[] }>;

const front = (name: string) => name.split(' // ')[0].trim().toLowerCase();

/** Find each row's card: the exact printing where the file says, by name where it does not or Scryfall does not know it. */
export async function resolveRows(rows: ImportRow[], lookup: Lookup): Promise<{
  items: Array<{
    card: ScryfallCard; quantity: number; finish: Finish; location: string;
    kind?: 'box' | 'binder'; variant: string; purchasePrice?: number | null;
  }>;
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
    items: rows.filter((r) => found.has(r)).map((r) => ({
      card: found.get(r)!, quantity: r.quantity, finish: r.finish, location: r.location,
      kind: r.kind, variant: r.variant, purchasePrice: r.purchasePrice,
    })),
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
export function toCsv(rows: Array<{
  card: ScryfallCard; quantity: number; finish: Finish; location: string; variant?: string; purchasePrice?: number | null;
}>): string {
  const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = ['Name,Set code,Collector number,Foil,Quantity,Scryfall ID,Binder Name,Language,Condition,Proxy,Altered,Signed,Misprint,Purchase price'];
  for (const r of rows) {
    const v = parseVariant(r.variant ?? '');
    lines.push([r.card.name, r.card.set ?? '', r.card.collector_number ?? '', r.finish === 'nonfoil' ? 'normal' : r.finish,
      String(r.quantity), r.card.id, r.location, v.language, v.condition, String(v.proxy), String(v.altered), String(v.signed),
      String(v.misprint), r.purchasePrice ? String(r.purchasePrice) : ''].map(q).join(','));
  }
  return lines.join('\n') + '\n';
}
