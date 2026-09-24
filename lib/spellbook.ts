/**
 * Combos, from Commander Spellbook.
 *
 * Scryfall has no idea what a combo is - no query can find "cards that go
 * infinite with Vivi". Commander Spellbook is the community's combo
 * database, with a documented public API and an MIT-licensed backend.
 *
 * https://backend.commanderspellbook.com/schema/swagger/
 */

const API = 'https://backend.commanderspellbook.com';
const SITE = 'https://commanderspellbook.com';
const TIMEOUT_MS = 10_000;

// Enough to choose from without a wall of four-card combos nobody will build.
const LIMIT = 12;

export interface Combo {
  id: string;
  /** Every card the combo needs, in Spellbook's order. */
  cards: string[];
  /** What it does: "Infinite red mana", "Infinite damage"... */
  produces: string[];
  /** How to assemble and run it, one step per line. */
  steps: string;
  /** Board state it needs beyond the cards, if any. */
  prerequisites: string;
  /** Colour identity as letters, e.g. "UBR". */
  identity: string;
  /** Decks on EDHREC that run it, as Spellbook reports. */
  popularity: number | null;
  /** Rough cost of the pieces, in US dollars, from TCGplayer. */
  price: number | null;
  url: string;
}

export class SpellbookError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

interface Variant {
  id: string;
  uses: Array<{ card: { name: string } }>;
  produces: Array<{ feature: { name: string } }>;
  description?: string;
  easyPrerequisites?: string;
  notablePrerequisites?: string;
  identity?: string;
  popularity?: number | null;
  prices?: { tcgplayer?: string | null };
}

/**
 * Search combos with Spellbook's own syntax - `card:"Vivi Ornitier"`,
 * `coloridentity<=UR`, `result:"infinite mana"`, `legal:commander`.
 */
export async function searchCombos(query: string): Promise<Combo[]> {
  const params = new URLSearchParams({ q: query, ordering: '-popularity', limit: String(LIMIT) });
  let response: Response;
  try {
    response = await fetch(`${API}/variants/?${params}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'MTGTracker/0.1 (https://github.com/DK09876/MTGTracker)' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new SpellbookError('could not reach Commander Spellbook', 502);
  }

  if (!response.ok) {
    // Spellbook explains a bad query as {"q": ["Invalid search query: ..."]}.
    let detail = '';
    try {
      const body = (await response.json()) as { q?: string[] };
      detail = body.q?.join(' ') ?? '';
    } catch { /* non-JSON error body */ }
    throw new SpellbookError(detail || `Commander Spellbook returned ${response.status}`, response.status);
  }

  const body = (await response.json()) as { results?: Variant[] };
  return (body.results ?? []).map(toCombo);
}

export function toCombo(variant: Variant): Combo {
  const price = Number(variant.prices?.tcgplayer);
  return {
    id: variant.id,
    cards: variant.uses.map((u) => u.card.name),
    produces: variant.produces.map((p) => p.feature.name),
    steps: (variant.description ?? '').trim(),
    prerequisites: [variant.easyPrerequisites, variant.notablePrerequisites]
      .map((p) => (p ?? '').trim()).filter(Boolean).join('\n'),
    identity: variant.identity ?? '',
    popularity: variant.popularity ?? null,
    price: Number.isFinite(price) && price > 0 ? price : null,
    url: `${SITE}/combo/${variant.id}`,
  };
}

// --- a whole deck --------------------------------------------------------

export interface DeckList {
  commanders: string[];
  /** The main board, with how many of each. */
  main: Array<{ name: string; quantity: number }>;
}

const body = ({ commanders, main }: DeckList) => JSON.stringify({
  commanders: commanders.map((card) => ({ card })),
  main: main.map(({ name, quantity }) => ({ card: name, quantity })),
});

async function post<T>(path: string, deck: DeckList): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'MTGTracker/0.1 (https://github.com/DK09876/MTGTracker)' },
      body: body(deck),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new SpellbookError('could not reach Commander Spellbook', 502);
  }
  if (!response.ok) throw new SpellbookError(`Commander Spellbook returned ${response.status}`, response.status);
  return response.json() as Promise<T>;
}

/**
 * The combos a deck already has, and those one card away within its
 * commander's colours - with that card named.
 */
export async function combosInDeck(deck: DeckList): Promise<{ included: Combo[]; almost: Array<Combo & { missing: string[] }> }> {
  const { results } = await post<{ results: { included?: Variant[]; almostIncluded?: Variant[] } }>('/find-my-combos', deck);
  const have = new Set([...deck.commanders, ...deck.main.map((c) => c.name)].map((n) => n.split(' // ')[0].toLowerCase()));
  const has = (name: string) => have.has(name.split(' // ')[0].toLowerCase());
  return {
    included: (results.included ?? []).map(toCombo),
    almost: (results.almostIncluded ?? []).map((v) => {
      const combo = toCombo(v);
      return { ...combo, missing: combo.cards.filter((name) => !has(name)) };
    }),
  };
}

/** What Commander Spellbook's bracket estimator makes of a deck. */
export interface BracketReport {
  /** Spellbook's own scale, not the official 1-5 brackets. */
  tag: 'R' | 'S' | 'P' | 'O' | 'C' | 'E' | 'B';
  cards: Array<{ name: string; gameChanger: boolean; massLandDenial: boolean; extraTurn: boolean; banned: boolean }>;
  /** Combos it judged relevant to the bracket. */
  combos: Array<{ cards: string[]; twoCard: boolean; speed: number; produces: string[] }>;
}

export const SPELLBOOK_TAGS: Record<BracketReport['tag'], string> = {
  R: 'Ruthless', S: 'Spicy', P: 'Powerful', O: 'Oddball', C: 'Core', E: 'Exhibition', B: 'Banned',
};

interface Classified {
  card: { name: string };
  gameChanger: boolean;
  massLandDenial: boolean;
  extraTurn: boolean;
  banned: boolean;
}

interface ClassifiedVariant {
  combo: Variant;
  relevant: boolean;
  definitelyTwoCard: boolean;
  speed: number;
}

export async function estimateBracket(deck: DeckList): Promise<BracketReport> {
  const r = await post<{ bracketTag: BracketReport['tag']; cards: Classified[]; combos: ClassifiedVariant[] }>('/estimate-bracket', deck);
  return {
    tag: r.bracketTag,
    cards: r.cards.map((c) => ({
      name: c.card.name, gameChanger: c.gameChanger, massLandDenial: c.massLandDenial, extraTurn: c.extraTurn, banned: c.banned,
    })),
    combos: r.combos.filter((c) => c.relevant).map((c) => ({
      cards: c.combo.uses.map((u) => u.card.name),
      twoCard: c.definitelyTwoCard,
      speed: c.speed,
      produces: c.combo.produces.map((p) => p.feature.name),
    })),
  };
}
