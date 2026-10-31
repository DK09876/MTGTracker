/**
 * Mana symbols, from the Mana font (Andrew Gioia, MIT) - the real symbols,
 * drawn as text, so a list of hundreds of costs renders instantly and works
 * with Scryfall unreachable.
 */

/** Split "{2}{W}{U}" into ["2","W","U"]. Anything unbracketed is ignored. */
export function parseManaCost(cost: string): string[] {
  return Array.from(cost.matchAll(/\{([^}]+)\}/g), (m) => m[1]);
}

/** The Mana font's classes for one symbol: "W" -> "ms-w", "W/U" -> "ms-wu ms-split", "T" -> "ms-tap". */
export function symbolClass(symbol: string): string {
  const s = symbol.toLowerCase();
  if (s === 't') return 'ms-tap';
  if (s === 'q') return 'ms-untap';
  if (s === '½' || s === 'h') return 'ms-1-2';
  if (s === '∞') return 'ms-infinity';
  const plain = s.replace(/\//g, '');
  // Two-part hybrids ({W/U}, {2/W}) are drawn split; phyrexian ({W/P}) is one symbol.
  const split = s.includes('/') && !s.endsWith('/p');
  return `ms-${plain}${split ? ' ms-split' : ''}`;
}

export default function ManaCost({ cost, size = 16 }: { cost?: string; size?: number }) {
  if (!cost) return null;
  const symbols = parseManaCost(cost);
  if (!symbols.length) return null;

  return (
    <span className="inline-flex items-center gap-[2px] align-middle" style={{ fontSize: size * 0.82 }} role="img" aria-label={`Mana cost ${cost}`}>
      {symbols.map((symbol, i) => (
        <i key={`${symbol}-${i}`} title={`{${symbol}}`} aria-hidden className={`ms ms-cost ms-shadow ${symbolClass(symbol)}`} />
      ))}
    </span>
  );
}

/** A colour identity ("WUBRG" letters) as mana symbols; colourless as {C}. */
export function IdentitySymbols({ identity, size = 16 }: { identity: string; size?: number }) {
  const letters = identity ? identity.split('') : ['C'];
  return (
    <span className="inline-flex items-center gap-[3px] align-middle" style={{ fontSize: size * 0.82 }} role="img" aria-label={`Colours ${identity || 'colourless'}`}>
      {letters.map((l) => <i key={l} aria-hidden className={`ms ms-cost ms-shadow ms-${l.toLowerCase()}`} />)}
    </span>
  );
}
