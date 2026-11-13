/**
 * The suggestion log (lib/suggestion-log.ts).
 *
 * GET: your own sharing setting. For an admin, also the log's totals, accept
 *   rates by task, method, model, prompt version and rank, and the reasons
 *   given; ?method=ai|code for one kind only. ?export=1 (admin only) downloads every event as JSON with
 *   profiles and decks as opaque ids and no typed reasons.
 * POST {share}: turn logging of your own suggestions and choices on or off.
 */

import { NextResponse } from 'next/server';

import { requireAdmin, requireProfile } from '@/lib/profile-route';
import { exportLog, rates, reasons, rows, setShare, shareOn, totals } from '@/lib/suggestion-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  const share = shareOn(who.profile);
  if (new URL(request.url).searchParams.get('export') === '1') {
    const admin = requireAdmin(request);
    if (admin instanceof NextResponse) return admin;
    return new NextResponse(JSON.stringify({ exportedAt: new Date().toISOString(), ...exportLog() }, null, 1), {
      headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="suggestion-log-${new Date().toISOString().slice(0, 10)}.json"` },
    });
  }
  const admin = requireAdmin(request);
  if (admin instanceof NextResponse) return NextResponse.json({ share });
  const m = new URL(request.url).searchParams.get('method');
  const method = m === 'ai' || m === 'code' ? m : undefined;
  const events = rows(method);
  return NextResponse.json({ share, admin: { method: method ?? 'all', totals: totals(), rates: rates(events), reasons: reasons(events) } });
}

export async function POST(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  const body = await request.json().catch(() => ({})) as { share?: unknown };
  if (typeof body.share !== 'boolean') return NextResponse.json({ error: 'Say on or off' }, { status: 400 });
  setShare(who.profile, body.share);
  return NextResponse.json({ share: shareOn(who.profile) });
}
