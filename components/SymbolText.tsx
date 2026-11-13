/**
 * Claude's words with mana symbols drawn: "a {R}{R} 2/2" shows the symbols
 * the way card costs do. Anything in braces that isn't a mana symbol stays
 * as typed.
 */

import ManaCost from './ManaCost';

const SYMBOLS = /((?:\{(?:[WUBRGCSXYZTQE]|\d{1,2}|½|∞|[WUBRGC2]\/[WUBRGCP])\})+)/i;

export default function SymbolText({ text }: { text: string }) {
  if (!text.includes('{')) return <>{text}</>;
  const parts = text.split(SYMBOLS);
  return <>{parts.map((p, i) => (i % 2 ? <ManaCost key={i} cost={p} size={14} /> : p))}</>;
}
