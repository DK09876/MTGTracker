/**
 * Reading a decklist pasted from elsewhere.
 *
 * The common export shapes all come down to one card per line:
 *
 *   1x Kratos, God of War (SLD) 2207        Moxfield, Archidekt
 *   1 Lightning Bolt (PF19) 1 *F*           foil (*E* for etched)
 *   33 Mountain                             MTGO, plain text
 *   Sol Ring                                no count means one
 *
 * with optional section headings - "Commander", "Deck", "Sideboard" - which
 * Arena and Moxfield write as a bare line, sometimes with a colon or `//`.
 * Sideboard and maybeboard cards keep their board; tokens are skipped. A
 * line that cannot be read is reported rather than dropped.
 *
 * Other sites' extras are read past: MTGO's "SB: 1 Name" goes to the
 * sideboard, Archidekt's "[Ramp]" categories and "^Have^" labels are
 * dropped, and type headings like "Creatures (30)" are not cards.
 *
 * The set code and collector number pin the exact printing, so a card
 * imported from a Secret Lair list keeps its Secret Lair art and price.
 */

import type { Finish, ScryfallCard } from './scryfall';

/** Where a card goes: the commander, one of a deck's boards, its companion, or nowhere (tokens). */
export type Section = 'commander' | 'main' | 'side' | 'maybe' | 'companion' | 'skip';

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
  section: Section;
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

export function parseDecklist(text: string): { entries: Entry[]; unreadable: string[] } {
  const entries: Entry[] = [];
  const unreadable: string[] = [];
  let section: Section = 'main';

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    // "// Commander", "Commander:", "SIDEBOARD" - a heading, not a card.
    const heading = line.replace(/^\/\/\s*/, '').replace(/:$/, '').replace(/\s*\(\d+\)$/, '').trim().toLowerCase();
    const match = HEADINGS.find(([pattern]) => pattern.test(heading));
    if (match) { section = match[1]; continue; }
    if (TYPE_HEADING.test(heading)) { if (section === 'commander') section = 'main'; continue; }
    if (line.startsWith('//')) continue;

    // MTGO marks sideboard lines one by one; Archidekt adds [categories] and ^labels^.
    const sb = /^SB:\s*/i.test(line);
    // Archidekt names a card's board among its categories: [Commander{top}], [Maybeboard{noDeck}].
    const tagged = (line.match(/\[([^\]]*)\]/)?.[1] ?? '').toLowerCase().split(',').map((c) => c.replace(/\{[^}]*\}/g, '').trim());
    const board: Section | null = sb || tagged.includes('sideboard') ? 'side' : tagged.includes('maybeboard') ? 'maybe' : tagged.includes('commander') ? 'commander' : null;
    const card = line.replace(/^SB:\s*/i, '').replace(/\s*\^[^^]*\^/g, '').replace(/\s*\[[^\]]*\]/g, '').trim();
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
      section: board ?? section,
      line,
    });
  }
  return { entries, unreadable };
}

const MARKER: Record<Finish, string> = { nonfoil: '', foil: ' *F*', etched: ' *E*' };

const lineFor = (card: ScryfallCard, quantity: number, finish: Finish = 'nonfoil') =>
  `${quantity}x ${card.name}`
  + (card.set && card.collector_number ? ` (${card.set.toLowerCase()}) ${card.collector_number}` : '')
  + MARKER[finish];

/**
 * A deck written out as Moxfield exports it - one flat list, `1x Name (set)
 * number *F*` - so the same text imports here and anywhere else, and
 * copying it out and pasting it back changes nothing. The commander is the
 * first line: that is where an import looks for it. Sideboard and
 * maybeboard follow under their own headings, only when they hold cards.
 */
export function formatDecklist(
  commander: ScryfallCard | null,
  cards: Array<{ card: ScryfallCard; quantity: number; finish?: Finish; board?: Board }>,
  commanderFinish: Finish = 'nonfoil',
): string {
  const lines = (board: Board) => cards
    .filter((c) => (c.board ?? 'main') === board)
    .sort((a, b) => a.card.name.localeCompare(b.card.name))
    .map(({ card, quantity, finish }) => lineFor(card, quantity, finish));
  const out = [...(commander ? [lineFor(commander, 1, commanderFinish)] : []), ...lines('main')];
  for (const [board, heading] of [['side', 'SIDEBOARD:'], ['maybe', 'MAYBEBOARD:']] as const) {
    const rows = lines(board);
    if (rows.length) out.push('', heading, ...rows);
  }
  return out.join('\n');
}
