/** A price on a button before an AI step runs: "about 6¢", with ", estimated" until this deck has run it. Pure. */
export const price = (c: { usd: number; measured: boolean }) =>
  `about ${c.usd < 0.995 ? `${Math.max(1, Math.round(c.usd * 100))}¢` : `$${c.usd.toFixed(2)}`}${c.measured ? '' : ', estimated'}`;
