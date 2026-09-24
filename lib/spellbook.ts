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
