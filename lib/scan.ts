/**
 * Making sense of what OCR reads off a card.
 *
 * The scanner reads two strips: the name bar, and the small print in the
 * bottom-left corner. Cards since 2015 print the collector number and set
 * code there - "263/281 U" over "C21 • EN" on older frames, "U 0091" over
 * "EOC • EN" on newer ones - which pins down the exact printing. Older cards
 * have neither, and the name alone has to do.
 *
 * OCR is noisy: a bullet read as "*", "O" for "0", stray marks at the ends.
 * These functions are forgiving about that, and pure, so they are tested on
 * the kind of text Tesseract actually produces.
 */

export interface BottomLine {
  number?: string;
  set?: string;
}

// Languages printed after the set code.
const LANGS = 'EN|JP|JA|DE|FR|IT|ES|SP|PT|RU|KO|ZH|CS|CT|PH';
// "C21 • EN", "EOC * EN", "M21-EN" - a code of 3-5 letters and digits, a separator, a language.
// OCR turns the bullet into «, », *, +, · and the like, so anything but a letter or digit goes.
const SET_LANG = new RegExp(`\\b([A-Z0-9]{3,5})\\s*[^A-Z0-9\\s]{0,2}\\s*(?:${LANGS})\\b`);
// "263/281", "0091", "U 0091" - the first run of up to four digits, with an optional total.
// Not digits inside a code like "C21": no letter or digit may touch it.
const NUMBER = /(?:^|[^\dA-Z])(\d{1,4})(?:\s*\/\s*\d{1,4})?(?![\dA-Z])/;

/** Collector number and set code from the bottom-left small print. */
export function readBottomLine(text: string): BottomLine {
  // OCR mistakes worth undoing: O for 0 inside numbers, bullets as odd marks.
  const cleaned = text.toUpperCase().replace(/(?<=\d)O|O(?=\d)/g, '0');
  const out: BottomLine = {};
  const set = SET_LANG.exec(cleaned);
  if (set && /[A-Z]/.test(set[1])) out.set = set[1].toLowerCase();
  // The number is on the line before the set code; with a set read, only there.
  const number = NUMBER.exec(set ? cleaned.slice(0, set.index) : cleaned);
  if (number) out.number = String(Number.parseInt(number[1], 10));
  return out;
}

/** A card name as read: letters, spaces and the punctuation names use, trimmed of noise at the ends. */
export function cleanName(text: string): string {
  return text
    .replace(/[|_~`^"“”‘]/g, '')
    .replace(/[^A-Za-zÀ-ÿ0-9 ,'’\-:!?./]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[^A-Za-zÀ-ÿ]+|[^A-Za-zÀ-ÿ!?]+$/g, '')
    .trim();
}

/**
 * The line of a name strip that is the name. The strip also catches the
 * frame's art above and the edge below, which OCR reads as short junk
 * ("Ny", "00 0 2", "( a"): the name is the line with the most letters in
 * real words.
 */
export function bestNameLine(text: string): string {
  let best = '';
  let bestScore = 0;
  for (const raw of text.split('\n')) {
    // A stray letter at either end is a mark on the frame read as one ("O Delver of Secrets").
    const line = cleanName(raw).replace(/^[B-HJ-Zb-z]\s+/, '').replace(/\s+[A-Za-z]$/, '');
    const words = line.split(' ').filter((w) => /[A-Za-z]{2,}/.test(w) && /[aeiouyAEIOUY]/.test(w));
    const score = words.reduce((n, w) => n + w.replace(/[^A-Za-z]/g, '').length, 0);
    if (score > bestScore) {
      bestScore = score;
      best = line;
    }
  }
  return bestScore >= 3 ? best : '';
}

/** How alike two names are, 0 to 1, ignoring case and punctuation. */
export function similarity(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  const prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (x[i - 1] === y[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return 1 - prev[y.length] / Math.max(x.length, y.length);
}

/** Whether a read name plausibly is this card: close to its name or a face's. */
export function nameMatches(read: string, cardName: string): boolean {
  if (!read) return false;
  return [cardName, ...cardName.split(' // ')].some((n) => similarity(read, n) >= 0.6);
}
