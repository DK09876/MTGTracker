/**
 * Mana symbols, drawn rather than fetched.
 *
 * Scryfall hosts an SVG per symbol, but a cost is half a dozen of them and a
 * list is hundreds of costs - that is a lot of requests for something that is
 * a coloured circle with a letter in it. These are drawn from the token text
 * so a list renders instantly and works with Scryfall unreachable.
 */

const COLORS: Record<string, { bg: string; fg: string }> = {
  W: { bg: '#f8f2dd', fg: '#2b2718' },
  U: { bg: '#a5cfeb', fg: '#0d2b3e' },
  B: { bg: '#3f3a39', fg: '#ded7d3' },
  R: { bg: '#e9998a', fg: '#43140d' },
  G: { bg: '#9cceac', fg: '#0f3019' },
  C: { bg: '#c4bcb0', fg: '#2b2620' },
};

const GENERIC = { bg: '#3a342b', fg: '#ded5c6' };

/** Split "{2}{W}{U}" into ["2","W","U"]. Anything unbracketed is ignored. */
export function parseManaCost(cost: string): string[] {
  return Array.from(cost.matchAll(/\{([^}]+)\}/g), (m) => m[1]);
}

function styleFor(symbol: string) {
  const plain = symbol.replace(/\//g, '');
  if (COLORS[plain]) return COLORS[plain];
  // Hybrid and phyrexian ({W/U}, {2/R}, {G/P}) take the first colour present.
  const colour = plain.split('').find((c) => COLORS[c]);
  return colour ? COLORS[colour] : GENERIC;
}

export default function ManaCost({ cost, size = 16 }: { cost?: string; size?: number }) {
  if (!cost) return null;
  const symbols = parseManaCost(cost);
  if (!symbols.length) return null;

  return (
    <span className="inline-flex items-center gap-[2px] align-middle" aria-label={`Mana cost ${cost}`}>
      {symbols.map((symbol, i) => {
        const { bg, fg } = styleFor(symbol);
        // Hybrids need both letters, so they get a wider pill.
        const label = symbol.replace('/', '');
        return (
          <span
            key={`${symbol}-${i}`}
            title={`{${symbol}}`}
            style={{
              background: bg,
              color: fg,
              width: label.length > 1 ? size * 1.35 : size,
              height: size,
              fontSize: size * 0.62,
              borderRadius: size,
            }}
            className="inline-flex items-center justify-center font-bold leading-none shadow-sm"
          >
            {label}
          </span>
        );
      })}
    </span>
  );
}
