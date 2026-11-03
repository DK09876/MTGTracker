/**
 * Admins only. GET: everyone, with whether they are an admin, have a
 * password, and how many lists they keep.
 * POST {id, action}: 'admin' or 'unadmin'; 'reset' clears a password (and
 * signs them out everywhere); 'remove' deletes a profile with no lists.
 */

import { NextResponse } from 'next/server';

import { access, endSessionsFor, everyone, setAdmin, setPassword } from '@/lib/auth';
import { database, listLists } from '@/lib/db';
import { requireAdmin } from '@/lib/profile-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const people = () => everyone().map((p) => ({ ...p, lists: listLists(p.id).length }));

export async function GET(request: Request) {
  const who = requireAdmin(request);
  if (who instanceof NextResponse) return who;
  return NextResponse.json({ people: people() });
}

export async function POST(request: Request) {
  const who = requireAdmin(request);
  if (who instanceof NextResponse) return who;
  const body = await request.json().catch(() => ({})) as { id?: string; action?: string };
  const target = body.id ? access(body.id) : null;
  if (!target) return NextResponse.json({ error: 'No such person' }, { status: 404 });
  if (target.id === who.profile && body.action !== 'admin') return NextResponse.json({ error: 'Change your own profile from your profile page' }, { status: 400 });
  switch (body.action) {
    case 'admin': setAdmin(target.id, true); break;
    case 'unadmin': setAdmin(target.id, false); break;
    case 'reset': setPassword(target.id, null); endSessionsFor(target.id); break;
    case 'remove':
      if (listLists(target.id).length) return NextResponse.json({ error: `${target.name} still has lists - they need to go first` }, { status: 400 });
      database().run('DELETE FROM profiles WHERE id = ?', [target.id]);
      endSessionsFor(target.id);
      break;
    default: return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
  return NextResponse.json({ people: people() });
}
