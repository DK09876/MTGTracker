/**
 * Talking to Scryfall.
 *
 * Their API is free, unauthenticated and run on donations, and their docs ask
 * for three things in return: identify yourself, leave 50-100ms between
 * requests, and cache what you get rather than re-fetching it. All three are
 * honoured here - the delay is enforced in one place so no call site can
 * forget it, and a card's full payload is stored when it is added to a list
 * so browsing a list never touches the network at all.
 *
 * https://scryfall.com/docs/api
 */

import { DEFAULT_SORT, type Sort } from './sort';

const API = 'https://api.scryfall.com';

const HEADERS = {
  // Scryfall ask for a descriptive agent so they can contact you if a client
  // misbehaves, and they return 403 to clients that send none.
  'User-Agent': 'MTGTracker/0.1 (https://github.com/DK09876/MTGTracker)',
  Accept: 'application/json',
};

/** Scryfall ask for 50-100ms between requests. Serialised so bursts cannot slip past. */
const MIN_GAP_MS = 100;
let lastCall = 0;
let queue: Promise<unknown> = Promise.resolve();

function throttle<T>(work: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const wait = MIN_GAP_MS - (Date.now() - lastCall);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return work();
  };
  // Chain onto the previous call so two concurrent requests still queue.
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}

export interface ScryfallCard {
  id: string;
  oracle_id?: string;
  name: string;
  mana_cost?: string;
  cmc?: number;
  type_line?: string;
  oracle_text?: string;
  flavor_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  colors?: string[];
  color_identity?: string[];
  keywords?: string[];
  rarity?: string;
  set?: string;
  set_name?: string;
  collector_number?: string;
  artist?: string;
  released_at?: string;
  scryfall_uri?: string;
  image_uris?: { small?: string; normal?: string; large?: string; art_crop?: string };
  // Double-faced cards carry their images and text on the faces instead.
  card_faces?: Array<{
    name: string;
    mana_cost?: string;
    type_line?: string;
    oracle_text?: string;
    power?: string;
    toughness?: string;
    loyalty?: string;
    flavor_text?: string;
    artist?: string;
    image_uris?: { small?: string; normal?: string; large?: string; art_crop?: string };
  }>;
  prices?: { usd?: string | null; usd_foil?: string | null; usd_etched?: string | null; eur?: string | null; tix?: string | null };
  legalities?: Record<string, string>;
}

export class ScryfallError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function get<T>(path: string): Promise<T> {
  return request<T>(path);
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await throttle(() => fetch(`${API}${path}`, body === undefined
    ? { headers: HEADERS }
    : { method: 'POST', headers: { ...HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  if (!response.ok) {
    // Scryfall puts a human-readable reason in the body; pass it through so
    // "no cards matched" does not surface as a bare 404.
    let detail = '';
    try {
      const body = (await response.json()) as { details?: string };
      detail = body.details ?? '';
    } catch { /* non-JSON error body */ }
    throw new ScryfallError(detail || `Scryfall returned ${response.status}`, response.status);
  }
  return response.json() as Promise<T>;
}

export interface SearchResult {
  cards: ScryfallCard[];
  totalCards: number;
  hasMore: boolean;
}

/**
 * Full-text card search.
 *
 * Passes the query through untouched so Scryfall's own syntax keeps working -
 * `t:goblin`, `c:rg`, `set:mh3`, `cmc<=3` and the rest. Prefix matching is
 * their job, not ours.
 */
export async function searchCards(query: string, page = 1, sort: Sort = DEFAULT_SORT): Promise<SearchResult> {
  const trimmed = query.trim();
  if (!trimmed) return { cards: [], totalCards: 0, hasMore: false };

  try {
    const body = await get<{ data: ScryfallCard[]; total_cards: number; has_more: boolean }>(
      `/cards/search?q=${encodeURIComponent(trimmed)}&unique=cards&order=${sort.order}&dir=${sort.dir}&page=${page}`,
    );
    return { cards: body.data, totalCards: body.total_cards, hasMore: body.has_more };
  } catch (error) {
    // A search that matches nothing is a 404 from Scryfall, which is an
    // answer rather than a failure.
    if (error instanceof ScryfallError && error.status === 404) {
      return { cards: [], totalCards: 0, hasMore: false };
    }
    throw error;
  }
}

/** One card by its Scryfall id, for refreshing a stored copy. */
export function getCard(id: string): Promise<ScryfallCard> {
  return get<ScryfallCard>(`/cards/${encodeURIComponent(id)}`);
}

/**
 * Card names starting with what has been typed, for the search dropdown.
 *
 * Prefix matching only - "lightnig" finds nothing. Misspellings are caught
 * later, by the translator and then by `findCardNamed`.
 */
export async function autocomplete(prefix: string): Promise<string[]> {
  const trimmed = prefix.trim();
  if (trimmed.length < 2) return [];
  const body = await get<{ data: string[] }>(`/cards/autocomplete?q=${encodeURIComponent(trimmed)}`);
  return body.data;
}

/**
 * The card whose name best matches a loose spelling, or null.
 *
 * Scryfall's fuzzy match is generous - "green ramp" finds Greenbelt Rampager -
 * so this is only safe as a last resort, never as a first guess at what a
 * sentence meant. Too many matches and no match are both null.
 */
export async function findCardNamed(fuzzy: string): Promise<ScryfallCard | null> {
  try {
    return await get<ScryfallCard>(`/cards/named?fuzzy=${encodeURIComponent(fuzzy.trim())}`);
  } catch (error) {
    if (error instanceof ScryfallError && error.status === 404) return null;
    throw error;
  }
}

// --- reading a card ------------------------------------------------------

/** The front face's image, wherever the card happens to keep it. */
export function imageOf(card: ScryfallCard, size: 'small' | 'normal' | 'large' = 'normal'): string | null {
  return card.image_uris?.[size] ?? card.card_faces?.[0]?.image_uris?.[size] ?? null;
}

/** Mana cost, joining both halves of a split or transforming card. */
export function manaCostOf(card: ScryfallCard): string {
  if (card.mana_cost) return card.mana_cost;
  const faces = (card.card_faces ?? []).map((f) => f.mana_cost).filter(Boolean);
  return faces.join(' // ');
}

export function typeLineOf(card: ScryfallCard): string {
  return card.type_line ?? card.card_faces?.map((f) => f.type_line).filter(Boolean).join(' // ') ?? '';
}

/** Which version of a printing: ordinary, foil, or etched foil. */
export type Finish = 'nonfoil' | 'foil' | 'etched';

/**
 * Price in US dollars for this finish, or null when Scryfall has none.
 * Falls back to whichever finish is priced, since a total that skips a card
 * is further off than one using its other finish.
 */
export function priceOf(card: ScryfallCard, finish: Finish = 'nonfoil'): number | null {
  const p = card.prices;
  const usd = finish === 'foil' ? p?.usd_foil ?? p?.usd
    : finish === 'etched' ? p?.usd_etched ?? p?.usd_foil ?? p?.usd
    : p?.usd ?? p?.usd_foil;
  if (!usd) return null;
  const value = Number(usd);
  return Number.isFinite(value) ? value : null;
}

/**
 * Commanders a loose mention could mean - "omnath" is six of them - most
 * played first. Deciding between them is the caller's job (see
 * pickCommander in interpret.ts), which may mean asking. Falls back to the
 * fuzzy name match for spellings the word search misses.
 */
export async function findCommanders(mention: string): Promise<ScryfallCard[]> {
  const words = mention.replace(/["()]/g, ' ').trim();
  if (!words) return [];
  const { cards } = await searchCards(`is:commander ${words} order:edhrec`);
  if (cards.length) return cards;
  const named = await findCardNamed(words);
  return named ? [named] : [];
}

// Scryfall's limit for one collection request.
const COLLECTION_MAX = 75;

/** A way to name one card to Scryfall's collection endpoint. */
export type Identifier = { name: string } | { set: string; collector_number: string };

/**
 * Many cards in as few requests as Scryfall allows. What it cannot find is
 * returned separately rather than failing the rest.
 */
export async function collection(identifiers: Identifier[]): Promise<{ cards: ScryfallCard[]; notFound: Identifier[] }> {
  const cards: ScryfallCard[] = [];
  const notFound: Identifier[] = [];
  for (let i = 0; i < identifiers.length; i += COLLECTION_MAX) {
    const body = await request<{ data: ScryfallCard[]; not_found?: Identifier[] }>(
      '/cards/collection', { identifiers: identifiers.slice(i, i + COLLECTION_MAX) },
    );
    cards.push(...body.data);
    notFound.push(...(body.not_found ?? []));
  }
  return { cards, notFound };
}

/**
 * Cards by exact name.
 *
 * A double-faced card is looked up by its front face: the collection
 * endpoint finds "Delver of Secrets" but not the full
 * "Delver of Secrets // Insectile Aberration".
 */
export async function cardsNamed(names: string[]): Promise<ScryfallCard[]> {
  const fronts = [...new Set(names.map((n) => n.split(' // ')[0].trim()).filter(Boolean))];
  return (await collection(fronts.map((name) => ({ name })))).cards;
}

/** A card's rules text, with both faces of a double-faced card. */
export function oracleTextOf(card: ScryfallCard): string {
  if (card.oracle_text) return card.oracle_text;
  return (card.card_faces ?? [])
    .map((f) => [f.name, f.oracle_text].filter(Boolean).join(': '))
    .join('\n//\n');
}
