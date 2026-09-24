/**
 * Reading a decklist pasted from elsewhere.
 *
 * The common export shapes all come down to one card per line:
 *
 *   1x Kratos, God of War (SLD) 2207        Moxfield, Archidekt
 *   1 Lightning Bolt (PF19) 1 *F*           with a foil marker
 *   33 Mountain                             MTGO, plain text
 *   Sol Ring                                no count means one
 *
 * with optional section headings - "Commander", "Deck", "Sideboard" - which
 * Arena and Moxfield write as a bare line, sometimes with a colon or `//`.
 * Anything in a sideboard or maybeboard is kept apart, since it is not in
 * the deck. A line that cannot be read is reported rather than dropped.
 *
 * The set code and collector number pin the exact printing, so a card
 * imported from a Secret Lair list keeps its Secret Lair art and price.
 */

import type { ScryfallCard } from './scryfall';

export type Section = 'commander' | 'main' | 'side';

export interface Entry {
  quantity: number;
  name: string;
  /** Set code, lower-cased, when the line gave one. */
  set?: string;
  collectorNumber?: string;
  foil: boolean;
  section: Section;
  /** The line as written, for reporting a card that could not be found. */
  line: string;
}

const HEADINGS: Array<[RegExp, Section]> = [
  [/^commanders?$/, 'commander'],
  [/^(deck|main ?deck|main ?board|mainboard|main)$/, 'main'],
  [/^(sideboard|side ?board|maybe ?board|maybeboard|considering|companion|tokens?)$/, 'side'],
];

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
    if (line.startsWith('//')) continue;

    const parts = line.match(LINE);
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
      foil: /\*F\*/i.test(parts[5] ?? ''),
      section,
      line,
    });
  }
  return { entries, unreadable };
}

const lineFor = (card: ScryfallCard, quantity: number) =>
  `${quantity} ${card.name}${card.set && card.collector_number ? ` (${card.set.toUpperCase()}) ${card.collector_number}` : ''}`;

/**
 * A deck written out in the same format it is read in - Moxfield's - so it
 * can be edited as text and saved back, or copied to another site. Printings
 * are kept, so a round trip changes nothing.
 */
export function formatDecklist(commander: ScryfallCard | null, cards: Array<{ card: ScryfallCard; quantity: number }>): string {
  const main = [...cards]
    .sort((a, b) => a.card.name.localeCompare(b.card.name))
    .map(({ card, quantity }) => lineFor(card, quantity));
  if (!commander) return main.join('\n');
  return ['Commander', lineFor(commander, 1), '', 'Deck', ...main].join('\n');
}
