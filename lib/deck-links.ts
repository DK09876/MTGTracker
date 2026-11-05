/**
 * A deck from a link: Archidekt, public or unlisted. Moxfield links are
 * recognised but not fetched: Moxfield's bot protection refuses apps like
 * this one (tested 2026-11-04: 403 to Node's fetch from the Pi and the Mac),
 * and we do not try to get around that - the owner is told how to copy the
 * list from Moxfield instead.
 *
 * The link is fetched once, when the owner pastes their own deck's link -
 * never crawled - and turned into the decklist text the importer already
 * reads, with its sections (Commander, Deck, Sideboard, Maybeboard),
 * printings and foils. A private deck, a missing one, or a site that says
 * no comes back as a plain message saying how to copy the list instead.
 */

export type DeckSite = 'moxfield' | 'archidekt';

export interface DeckLink { site: DeckSite; id: string; url: string }

export interface LinkedDeck {
  site: DeckSite;
  name: string;
  /** The deck as decklist text, in sections. */
  text: string;
}

export class DeckLinkError extends Error {}

const UA = 'MTGTracker/0.1 (personal deck app; fetches a deck when its owner pastes the link)';

/** A Moxfield or Archidekt deck link, or null for anything else. */
export function parseDeckLink(text: string): DeckLink | null {
  const t = text.trim();
  // With or without https:// - people paste both.
  const mox = t.match(/^(?:https?:\/\/)?(?:www\.)?moxfield\.com\/decks\/([A-Za-z0-9_-]{6,})/i);
  if (mox) return { site: 'moxfield', id: mox[1], url: t };
  const arch = t.match(/^(?:https?:\/\/)?(?:www\.)?archidekt\.com\/(?:api\/)?decks\/(\d+)/i);
  if (arch) return { site: 'archidekt', id: arch[1], url: t };
  return null;
}

/**
 * What the deck box holds: a link, a list, both, or nothing - so the page
 * can ask the owner to keep one rather than guess.
 */
export function readDeckBox(text: string): { kind: 'empty' | 'list' | 'link' | 'both' | 'links' | 'unknown-link'; link: DeckLink | null } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const urls = lines.filter((l) => /^https?:\/\//i.test(l) || /^(www\.)?[a-z0-9-]+\.(com|net|org|io)\//i.test(l));
  if (!lines.length) return { kind: 'empty', link: null };
  if (!urls.length) return { kind: 'list', link: null };
  if (urls.length > 1) return { kind: 'links', link: null };
  if (lines.length > 1) return { kind: 'both', link: null };
  const link = parseDeckLink(urls[0]);
  return link ? { kind: 'link', link } : { kind: 'unknown-link', link: null };
}

const finishMark = (foil: boolean, etched: boolean) => (etched ? ' *E*' : foil ? ' *F*' : '');
const line = (n: number, name: string, set?: string, cn?: string, mark = '') =>
  `${n} ${name}${set && cn ? ` (${set.toLowerCase()}) ${cn}` : ''}${mark}`;

function sections(parts: Array<[string, string[]]>): string {
  return parts.filter(([, lines]) => lines.length).map(([title, lines]) => `${title}\n${lines.join('\n')}`).join('\n\n');
}

interface MoxCard { quantity: number; isFoil?: boolean; isEtched?: boolean; card: { name: string; set?: string; cn?: string } }
type MoxBoard = { cards?: Record<string, MoxCard> };

/** Moxfield's deck JSON as decklist text. */
export function fromMoxfield(data: { name?: string; boards?: Record<string, MoxBoard> }): LinkedDeck {
  const board = (key: string) => Object.values(data.boards?.[key]?.cards ?? {})
    .map((c) => line(c.quantity, c.card.name, c.card.set, c.card.cn, finishMark(!!c.isFoil, !!c.isEtched)));
  return {
    site: 'moxfield',
    name: data.name?.trim() || 'Moxfield deck',
    text: sections([
      ['Commander', board('commanders')],
      ['Deck', board('mainboard')],
      ['Sideboard', board('sideboard')],
      ['Companion', board('companions')],
      ['Maybeboard', board('maybeboard')],
    ]),
  };
}

interface ArchCard {
  quantity: number;
  categories?: string[] | null;
  modifier?: string;
  card: { collectorNumber?: string; edition?: { editioncode?: string }; oracleCard: { name: string } };
}

/** Archidekt's deck JSON as decklist text: each card's first category decides its board. */
export function fromArchidekt(data: { name?: string; categories?: Array<{ name: string; includedInDeck: boolean }>; cards?: ArchCard[] }): LinkedDeck {
  const inDeck = new Map((data.categories ?? []).map((c) => [c.name.toLowerCase(), c.includedInDeck]));
  const groups: Record<'commander' | 'main' | 'side' | 'maybe', string[]> = { commander: [], main: [], side: [], maybe: [] };
  for (const c of data.cards ?? []) {
    const first = (c.categories?.[0] ?? '').toLowerCase();
    const where = first === 'commander' ? 'commander'
      : /maybe/.test(first) ? 'maybe'
        : /\bside/.test(first) ? 'side'
          : inDeck.get(first) === false ? 'maybe' : 'main';
    const mod = (c.modifier ?? '').toLowerCase();
    groups[where].push(line(c.quantity, c.card.oracleCard.name, c.card.edition?.editioncode, c.card.collectorNumber, finishMark(mod === 'foil', mod === 'etched')));
  }
  return {
    site: 'archidekt',
    name: data.name?.trim() || 'Archidekt deck',
    text: sections([['Commander', groups.commander], ['Deck', groups.main], ['Sideboard', groups.side], ['Maybeboard', groups.maybe]]),
  };
}

/** Moxfield links are not read (see the top of this file); this says what to do instead. */
export const MOXFIELD_REFUSES = 'Moxfield links aren\'t supported. On Moxfield, open the deck and use Export → Copy for MTGO, then paste the list here.';

const HOW_TO_COPY: Record<DeckSite, string> = {
  moxfield: 'On Moxfield, open the deck, then More → Export → Copy for MTGO, and paste the list here instead.',
  archidekt: 'On Archidekt, open the deck, then Export → Text, and paste the list here instead.',
};

/** Fetch a deck from its link, once. */
export async function fetchDeckLink(link: DeckLink, fetcher: typeof fetch = fetch): Promise<LinkedDeck> {
  const api = link.site === 'moxfield'
    ? `https://api2.moxfield.com/v3/decks/all/${encodeURIComponent(link.id)}`
    : `https://archidekt.com/api/decks/${encodeURIComponent(link.id)}/`;
  let res: Response;
  try {
    res = await fetcher(api, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new DeckLinkError(`Couldn't reach ${link.site === 'moxfield' ? 'Moxfield' : 'Archidekt'} just now. ${HOW_TO_COPY[link.site]}`);
  }
  if (res.status === 404) throw new DeckLinkError(`That deck wasn't found - it may be private or deleted. ${HOW_TO_COPY[link.site]}`);
  if (!res.ok) throw new DeckLinkError(`${link.site === 'moxfield' ? 'Moxfield' : 'Archidekt'} didn't share that deck (${res.status}). ${HOW_TO_COPY[link.site]}`);
  const data = await res.json().catch(() => null);
  if (!data) throw new DeckLinkError(`That link didn't give back a deck. ${HOW_TO_COPY[link.site]}`);
  const deck = link.site === 'moxfield' ? fromMoxfield(data) : fromArchidekt(data);
  if (!deck.text.trim()) throw new DeckLinkError(`That deck has no cards. ${HOW_TO_COPY[link.site]}`);
  return deck;
}

/**
 * The decklist text a deck box stands for: the list itself, or the deck its
 * link points at (fetched now). A box with both, or two links, is an error
 * that asks the owner to keep one.
 */
export async function deckText(box: string, fetcher: typeof fetch = fetch): Promise<{ text: string; name: string | null; site: DeckSite | null }> {
  const read = readDeckBox(box);
  if (read.kind === 'both') throw new DeckLinkError('There is a link and a list here. Remove one of them - the deck comes from the link or from the list, not both.');
  if (read.kind === 'links') throw new DeckLinkError('There are two links here. Keep the one for this deck.');
  if (read.kind === 'unknown-link') throw new DeckLinkError('That link is not one I can read (Archidekt links are). Paste the list instead.');
  if (read.kind === 'link' && read.link!.site === 'moxfield') throw new DeckLinkError(MOXFIELD_REFUSES);
  if (read.kind === 'link') {
    const deck = await fetchDeckLink(read.link!, fetcher);
    return { text: deck.text, name: deck.name, site: deck.site };
  }
  return { text: box, name: null, site: null };
}

/**
 * What a pasted list can hold, shown as the box's placeholder: the boards
 * by heading, and a printing or foil on a line. Other shapes read too - see
 * parseDecklist.
 */
export const DECKLIST_EXAMPLE = [
  'Commander',
  '1 Kratos, God of War',
  '',
  'Deck',
  '1x Sol Ring (SOC) 128',
  '1 Lightning Bolt *F*',
  '33 Mountain',
  '',
  'Sideboard',
  '1 Blasphemous Act',
  '',
  'Maybeboard',
  '1 Lightning Greaves',
].join('\n');
