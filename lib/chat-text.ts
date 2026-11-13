/**
 * Chat's answer text, read for the page (review item 29): the small set of
 * Markdown Chat writes (bold, "- " list lines) and the card names in it.
 * Pure.
 */

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The text split into plain pieces and card names (longest name first, whole names only, any case). */
export function splitNames(text: string, names: string[]): Array<{ text: string; name?: string }> {
  const usable = [...new Set(names.map((n) => n.split(' // ')[0].trim()).filter((n) => n.length >= 3))].sort((a, b) => b.length - a.length);
  if (!usable.length || !text) return text ? [{ text }] : [];
  const re = new RegExp(`(?<![\\p{L}\\p{N}'’])(${usable.map(escape).join('|')})(?![\\p{L}\\p{N}'’])`, 'giu');
  const out: Array<{ text: string; name?: string }> = [];
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > at) out.push({ text: text.slice(at, m.index) });
    out.push({ text: m[0], name: usable.find((n) => n.toLowerCase() === m[0].toLowerCase()) });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/**
 * The text split into plain pieces and the card names the answer marked [[like this]] (review item 30): only
 * marked names are links, so ordinary words that are also card names ("Opt", "Fear") never are. The brackets
 * never show.
 */
export function splitMarked(text: string): Array<{ text: string; name?: string }> {
  // Extra or unmatched brackets never show (round 2, item 12): "[[[[Opt]]]]" is Opt, a lone "[[" is dropped.
  const clean = (t: string) => t.replace(/\[\[+|\]\]+/g, '');
  const out: Array<{ text: string; name?: string }> = [];
  let at = 0;
  for (const m of text.matchAll(/\[\[+([^[\]]{1,120})\]\]+/g)) {
    if (m.index! > at) out.push({ text: clean(text.slice(at, m.index)) });
    out.push({ text: m[1], name: m[1].trim() });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ text: clean(text.slice(at)) });
  return out.filter((p) => p.text);
}

/** Whether the answer marks its card names (newer answers); older ones are matched against known names. */
export const marksNames = (text: string) => /\[\[[^\]]+\]\]/.test(text);

/**
 * Lines grouped into paragraphs and lists ("- ", "* ", "• " or "1." at the start). A heading ("## Picks") reads
 * as a bold line, never with its hashes.
 */
export function blocksOf(text: string): Array<{ list: boolean; lines: string[] }> {
  const out: Array<{ list: boolean; lines: string[] }> = [];
  for (const raw of text.split('\n')) {
    const l = raw.replace(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/, (_, h: string) => `**${h.replace(/\*\*/g, '')}**`);
    const item = /^\s*([-*•]|\d+[.)])\s+/.test(l);
    const line = item ? l.replace(/^\s*([-*•]|\d+[.)])\s+/, '') : l;
    const last = out.at(-1);
    if (last && last.list === item) last.lines.push(line);
    else out.push({ list: item, lines: [line] });
  }
  return out;
}

/** A line split into bold and plain runs; stray asterisks are dropped. */
export function boldRuns(line: string): Array<{ text: string; bold: boolean }> {
  return line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((p) => {
    const bold = /^\*\*[^*]+\*\*$/.test(p);
    return { text: (bold ? p.slice(2, -2) : p).replace(/\*\*/g, ''), bold };
  });
}
