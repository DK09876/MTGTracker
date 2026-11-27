/**
 * Which card something dragged in from another site is (a deck's Cards tab takes drops): Scryfall's pictures carry the
 * card's id (cards.scryfall.io/normal/front/a/b/<id>.jpg, and EDHREC's pictures are Scryfall's), and a Scryfall card
 * page its set and collector number (scryfall.com/card/<set>/<number>/<name>). Reads every form a browser hands over
 * (the link, the plain text, the HTML of a dragged picture), first match wins. Pure.
 */

export type DroppedCard = { id: string } | { set: string; number: string };

const ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** A Scryfall card behind one URL, or null. */
export function cardInUrl(raw: string): DroppedCard | null {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }
  const host = url.hostname.toLowerCase();
  if (host === 'scryfall.com' || host === 'www.scryfall.com') {
    const m = url.pathname.match(/^\/card\/([^/]+)\/([^/]+)/);
    if (m) return { set: decodeURIComponent(m[1]).toLowerCase(), number: decodeURIComponent(m[2]) };
    return null;
  }
  // The picture servers (cards.scryfall.io, the older c1.scryfall.com files) and the API (api.scryfall.com/cards/<id>).
  if (host.endsWith('scryfall.io') || host.endsWith('scryfall.com')) {
    const id = url.pathname.match(ID)?.[0];
    return id ? { id: id.toLowerCase() } : null;
  }
  return null;
}

/** The card in a drop: its links, then any link or picture address in its text or HTML. */
export function cardInDrop(data: { uriList?: string; text?: string; html?: string }): DroppedCard | null {
  const candidates = [
    ...(data.uriList ?? '').split(/\r?\n/).filter((l) => l && !l.startsWith('#')),
    ...(data.text ?? '').split(/\s+/),
    ...Array.from((data.html ?? '').matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi), (m) => m[1].replace(/&amp;/g, '&')),
  ];
  for (const c of candidates) {
    const card = cardInUrl(c);
    if (card) return card;
  }
  return null;
}
