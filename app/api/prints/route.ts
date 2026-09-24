/** Every printing of a card, for the printing picker: `?oracleId=`. */

import { NextResponse } from 'next/server';

import { imageOf, printingsOf } from '@/lib/scryfall';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const oracleId = new URL(request.url).searchParams.get('oracleId') ?? '';
  if (!/^[0-9a-f-]{36}$/.test(oracleId)) return NextResponse.json({ error: 'oracleId required' }, { status: 400 });
  try {
    const cards = await printingsOf(oracleId);
    return NextResponse.json({
      printings: cards.map((c) => ({
        id: c.id,
        set: c.set,
        setName: c.set_name,
        collectorNumber: c.collector_number,
        released: c.released_at,
        finishes: c.finishes ?? ['nonfoil'],
        image: imageOf(c, 'small'),
        prices: { usd: c.prices?.usd ?? null, usd_foil: c.prices?.usd_foil ?? null, usd_etched: c.prices?.usd_etched ?? null },
      })),
    });
  } catch (error) {
    console.error('[prints] failed', error);
    return NextResponse.json({ error: 'Could not reach Scryfall' }, { status: 502 });
  }
}
