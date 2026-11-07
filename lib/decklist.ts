/**
 * Reading a decklist pasted from elsewhere.
 *
 * The common export shapes all come down to one card per line:
 *
 *   1x Kratos, God of War (SLD) 2207        Moxfield, Archidekt
 *   1 Lightning Bolt (PF19) 1 *F*           foil (*E* for etched, *P* a proxy)
 *   33 Mountain                             MTGO, plain text
 *   Sol Ring                                no count means one
 *
 * with optional section headings - "Commander", "Deck", "Sideboard" - which
 * Arena and Moxfield write as a bare line, sometimes with a colon or `//`.
 * Sideboard and maybeboard cards keep their board; tokens are skipped. A
 * line that cannot be read is reported rather than dropped.
 *
 * Other sites' extras are read too: MTGO's "SB: 1 Name" goes to the
 * sideboard; Moxfield's "#Ramp" / "#!Ramp" tags and Archidekt's "[Ramp]"
 * categories become the card's tags (a category naming a board or a card
 * type is not a tag); "*CMDR*" and "*CMPN*" mark the commander and the
 * companion; "^Have^" labels are dropped; and type headings like
 * "Creatures (30)" are not cards.
 *
 * The set code and collector number pin the exact printing, so a card
 * imported from a Secret Lair list keeps its Secret Lair art and price.
 */

import type { Finish, ScryfallCard } from './scryfall';

/** Where a card goes: the commander, one of a deck's boards, its companion, or nowhere (tokens). */
export type Section = 'commander' | 'main' | 'side' | 'maybe' | 'companion' | 'skip' | 'own';

/**
 * A deck's sections. Main is the deck, and only main (plus the commander)
 * counts towards 100. Every deck also has a sideboard and a maybeboard, and
 * the owner can add their own, whose ids start with "s-" (sections.ts).
 */
export type Board = 'main' | 'side' | 'maybe' | `s-${string}`;

export interface Entry {
  quantity: number;
  name: string;
  /** Set code, lower-cased, when the line gave one. */
  set?: string;
  collectorNumber?: string;
  finish: Finish;
  /** Marked "*P*": a proxy stands in for the card (Mythic Tools, Moxfield). */
  proxy?: boolean;
  section: Section;
  /** The card's tags or categories as the list gave them, e.g. Moxfield's "#Ramp". */
  tags: string[];
  /** For section 'own': the name of the deck's own section the card was listed under ("// Wishlist"). */
  own?: string;
  /** The line as written, for reporting a card that could not be found. */
  line: string;
}

const HEADINGS: Array<[RegExp, Section]> = [
  [/^commanders?$/, 'commander'],
  [/^(deck|main ?deck|main ?board|mainboard|main)$/, 'main'],
  [/^(sideboard|side ?board|side)$/, 'side'],
  // A companion starts outside the game: it is kept with the sideboard, marked as the companion.
  [/^(companions?)$/, 'companion'],
  [/^(maybe ?board|maybeboard|maybe|considering)$/, 'maybe'],
  [/^(tokens?|attractions?|stickers?)$/, 'skip'],
];

// Card-type headings some sites group a list under: still the main deck.
const TYPE_HEADING = /^(creatures?|instants?|sorcery|sorceries|artifacts?|enchantments?|planeswalkers?|lands?|battles?|spells?|other|nonland|non-land)$/;

// "1x Name (SET) 123 *F*" - count, name, then optional printing and markers.
const LINE = /^(?:(\d+)\s*x?\s+)?(.+?)(?:\s+\(([A-Za-z0-9]{2,6})\)(?:\s+([A-Za-z0-9★†-]+))?)?((?:\s+\*[A-Za-z]+\*)*)\s*$/;

// Categories that say where a card goes or what type it is: not tags.
const NOT_A_TAG = /^(commanders?|companions?|deck|main ?(deck|board)?|side ?board|maybe ?board|considering|tokens?|creatures?|lands?|instants?|sorcery|sorceries|artifacts?|enchantments?|planeswalkers?|battles?|other)$/i;

/** Tags written after the card: " #Ramp #!Card Draw" (Moxfield, TappedOut). */
function splitTags(text: string): { rest: string; tags: string[] } {
  const at = text.search(/\s#/);
  if (at < 0) return { rest: text, tags: [] };
  const tags = text.slice(at).split(/\s#!?/).map((t) => t.trim()).filter(Boolean);
  return { rest: text.slice(0, at), tags };
}

export function parseDecklist(text: string): { entries: Entry[]; unreadable: string[] } {
  const entries: Entry[] = [];
  const unreadable: string[] = [];
  let section: Section = 'main';
  let own: string | undefined;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    // "// Commander", "Commander:", "SIDEBOARD" - a heading, not a card.
    const heading = line.replace(/^\/\/\s*/, '').replace(/:$/, '').replace(/\s*\(\d+\)$/, '').trim().toLowerCase();
    const match = HEADINGS.find(([pattern]) => pattern.test(heading));
    if (match) { section = match[1]; own = undefined; continue; }
    if (TYPE_HEADING.test(heading)) { if (section === 'commander') section = 'main'; continue; }
    // "// Wishlist" - one of the deck's own sections, as this app exports them.
    const ownHeading = line.match(/^\/\/\s*Section:\s*(.+)$/i);
    if (ownHeading) { section = 'own'; own = ownHeading[1].trim(); continue; }
    if (line.startsWith('//')) continue;

    // MTGO marks sideboard lines one by one; Archidekt adds [categories] and ^labels^.
    const sb = /^SB:\s*/i.test(line);
    // Archidekt names a card's board among its categories: [Commander{top}], [Maybeboard{noDeck}].
    const categories = (line.match(/\[([^\]]*)\]/)?.[1] ?? '').split(',').map((c) => c.replace(/\{[^}]*\}/g, '').trim()).filter(Boolean);
    const tagged = categories.map((c) => c.toLowerCase());
    const { rest, tags: written } = splitTags(line.replace(/^SB:\s*/i, '').replace(/\s*\^[^^]*\^/g, '').replace(/\s*\[[^\]]*\]/g, '').trim());
    const card = rest.trim();
    const markers = (card.match(/\*[A-Za-z]+\*/g) ?? []).map((m) => m.toUpperCase());
    const board: Section | null = sb || tagged.includes('sideboard') ? 'side' : tagged.includes('maybeboard') ? 'maybe'
      : tagged.includes('commander') || markers.includes('*CMDR*') ? 'commander'
        : tagged.includes('companion') || markers.includes('*CMPN*') ? 'companion' : null;
    const parts = card.match(LINE);
    const name = parts?.[2]?.trim();
    if (!parts || !name || /^\d+$/.test(name)) {
      unreadable.push(line);
      continue;
    }
    entries.push({
      quantity: parts[1] ? Math.max(1, Number(parts[1])) : 1,
      name,
      set: parts[3]?.toLowerCase(),
      collectorNumber: parts[4],
      finish: /\*E\*/i.test(parts[5] ?? '') ? 'etched' : /\*F\*/i.test(parts[5] ?? '') ? 'foil' : 'nonfoil',
      ...(/\*P\*/i.test(parts[5] ?? '') ? { proxy: true } : {}),
      section: board ?? section,
      ...(section === 'own' && !board && own ? { own } : {}),
      tags: [...new Set([...categories, ...written].filter((t) => !NOT_A_TAG.test(t)))],
      line,
    });
  }
  return { entries, unreadable };
}

const MARKER: Record<Finish, string> = { nonfoil: '', foil: ' *F*', etched: ' *E*' };

const lineFor = (card: ScryfallCard, quantity: number, finish: Finish = 'nonfoil', proxy = false) =>
  `${quantity}x ${card.name}`
  + (card.set && card.collector_number ? ` (${card.set.toLowerCase()}) ${card.collector_number}` : '')
  + MARKER[finish] + (proxy ? ' *P*' : '');

/**
 * A deck written out as Moxfield exports it - one flat list, `1x Name (set)
 * number *F*` - so the same text imports here and anywhere else, and
 * copying it out and pasting it back changes nothing. The commander is the
 * first line: that is where an import looks for it. Sideboard and
 * maybeboard follow under their own headings, only when they hold cards.
 * A card marked as a proxy keeps "*P*".
 */
export function formatDecklist(
  commander: ScryfallCard | null,
  cards: Array<{ card: ScryfallCard; quantity: number; finish?: Finish; board?: Board; proxies?: number }>,
  commanderFinish: Finish = 'nonfoil',
  opts: {
    /** The deck's tags: each card's are written after it, "#Ramp", as Moxfield does. */
    tags?: { tags: Array<{ id: string; name: string; status?: string }>; cardTags: Array<{ key: string; tagId: string; on: boolean }> };
    /** The deck's own sections, written after the rest under "// Section: Name". */
    sections?: Array<{ id: string; name: string }>;
  } = {},
): string {
  const tagName = new Map((opts.tags?.tags ?? []).filter((t) => (t.status ?? 'accepted') === 'accepted').map((t) => [t.id, t.name]));
  const tagsOf = new Map<string, string[]>();
  for (const ct of opts.tags?.cardTags ?? []) {
    const name = ct.on ? tagName.get(ct.tagId) : undefined;
    if (name) tagsOf.set(ct.key, [...(tagsOf.get(ct.key) ?? []), name]);
  }
  const withTags = (card: ScryfallCard, text: string) => {
    const t = tagsOf.get(card.oracle_id ?? card.id) ?? [];
    return t.length ? `${text} ${t.map((x) => `#${x}`).join(' ')}` : text;
  };
  const lines = (board: Board) => cards
    .filter((c) => (c.board ?? 'main') === board)
    .sort((a, b) => a.card.name.localeCompare(b.card.name))
    .map(({ card, quantity, finish, proxies }) => withTags(card, lineFor(card, quantity, finish, !!proxies)));
  const out = [...(commander ? [withTags(commander, lineFor(commander, 1, commanderFinish))] : []), ...lines('main')];
  for (const [board, heading] of [['side', 'SIDEBOARD:'], ['maybe', 'MAYBEBOARD:']] as const) {
    const rows = lines(board);
    if (rows.length) out.push('', heading, ...rows);
  }
  for (const own of (opts.sections ?? []).filter((x) => x.id.startsWith('s-'))) {
    const rows = lines(own.id as Board);
    if (rows.length) out.push('', `// Section: ${own.name}`, ...rows);
  }
  return out.join('\n');
}
