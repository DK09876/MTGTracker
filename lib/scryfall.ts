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
  prices?: { usd?: string | null; usd_foil?: string | null; eur?: string | null; tix?: string | null };
  legalities?: Record<string, string>;
}

export class ScryfallError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function get<T>(path: string): Promise<T> {
  const response = await throttle(() => fetch(`${API}${path}`, { headers: HEADERS }));
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
export async function searchCards(query: string, page = 1): Promise<SearchResult> {
  const trimmed = query.trim();
  if (!trimmed) return { cards: [], totalCards: 0, hasMore: false };

  try {
    const body = await get<{ data: ScryfallCard[]; total_cards: number; has_more: boolean }>(
      `/cards/search?q=${encodeURIComponent(trimmed)}&unique=cards&order=name&page=${page}`,
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

/** Price in US dollars, or null when Scryfall has none for this printing. */
export function priceOf(card: ScryfallCard): number | null {
  const usd = card.prices?.usd ?? card.prices?.usd_foil;
  if (!usd) return null;
  const value = Number(usd);
  return Number.isFinite(value) ? value : null;
}
