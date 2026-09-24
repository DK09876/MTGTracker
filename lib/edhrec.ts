/**
 * What a commander's decks actually play, from EDHREC. Off unless switched on.
 *
 * EDHREC has no public API, and its terms of use forbid automated requests
 * to the site. This reads the JSON behind its commander pages, which is
 * undocumented and may change or be blocked without notice. It is here
 * because it is the best source there is for "cards that work well with this
 * commander", and it only runs when MTG_EDHREC=on is set deliberately.
 *
 * To keep the footprint small it asks for each commander at most once a day,
 * and a failure is remembered for an hour rather than retried every search.
 *
 * Linking to a commander's EDHREC page is always on: a person following a
 * link is how the site is meant to be used.
 */

const DATA = 'https://json.edhrec.com/pages/commanders';
const SITE = 'https://edhrec.com/commanders';
const TIMEOUT_MS = 8_000;
const FRESH_MS = 24 * 60 * 60 * 1000;
const FAILED_MS = 60 * 60 * 1000;

export interface CardStats {
  /** Decks with this commander that run the card. */
  decks: number;
  /** decks as a share of the commander's decks that could run it, 0-1. */
  inclusion: number;
  /** How much more this commander's decks run it than other decks do, -1 to 1. */
  synergy: number;
}

/** What EDHREC knows about one commander's decks. */
export interface CommanderPage {
  /** Decks EDHREC has seen for this commander. */
  decks: number;
  /** Card name -> how its decks use it. */
  stats: Map<string, CardStats>;
  /** EDHREC's own lists - High Synergy Cards, Top Cards, Creatures... - in its order. */
  sections: Array<{ header: string; names: string[] }>;
}

export const edhrecEnabled = () => /^(1|on|true|yes)$/i.test(process.env.MTG_EDHREC ?? '');

/** EDHREC's URL name for a card: "Atraxa, Praetors' Voice" -> "atraxa-praetors-voice". */
export function edhrecSlug(name: string): string {
  return name.split(' // ')[0]
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export const edhrecUrl = (commander: string) => `${SITE}/${edhrecSlug(commander)}`;

const cache = new Map<string, { at: number; page: CommanderPage | null }>();

/** One commander's EDHREC page, or null when EDHREC has nothing or cannot be reached. */
export async function commanderPage(commander: string): Promise<CommanderPage | null> {
  const slug = edhrecSlug(commander);
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < (hit.page ? FRESH_MS : FAILED_MS)) return hit.page;

  let page: CommanderPage | null = null;
  try {
    const response = await fetch(`${DATA}/${slug}.json`, {
      headers: { Accept: 'application/json', 'User-Agent': 'MTGTracker/0.1 (https://github.com/DK09876/MTGTracker)' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // A commander EDHREC has never seen is a 403 from their storage, not a 404.
    if (response.ok) page = parseCommanderPage(await response.json());
  } catch {
    page = null;
  }
  cache.set(slug, { at: Date.now(), page });
  return page;
}

interface CardView {
  name?: string;
  synergy?: number;
  num_decks?: number;
  potential_decks?: number;
}

interface PageBody {
  container?: {
    json_dict?: {
      card?: { num_decks?: number };
      cardlists?: Array<{ header?: string; cardviews?: CardView[] }>;
    };
  };
}

export function parseCommanderPage(body: unknown): CommanderPage | null {
  const dict = (body as PageBody)?.container?.json_dict;
  const lists = dict?.cardlists;
  if (!Array.isArray(lists)) return null;

  const stats = new Map<string, CardStats>();
  const sections: CommanderPage['sections'] = [];
  for (const list of lists) {
    const names: string[] = [];
    for (const view of list.cardviews ?? []) {
      if (!view.name || !view.potential_decks) continue;
      names.push(view.name);
      if (!stats.has(view.name)) {
        stats.set(view.name, {
          decks: view.num_decks ?? 0,
          inclusion: (view.num_decks ?? 0) / view.potential_decks,
          synergy: view.synergy ?? 0,
        });
      }
    }
    if (names.length) sections.push({ header: list.header ?? 'Cards', names });
  }
  if (!stats.size) return null;
  return { decks: dict?.card?.num_decks ?? 0, stats, sections };
}
