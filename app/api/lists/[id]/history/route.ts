/**
 * A deck's history: its changes, newest first, and its snapshots.
 *
 *   GET                         {changes, snapshots}
 *   GET ?compare=<snapshot id>  what changed since that snapshot
 *   POST {action}               undo | restore-before {changeId} |
 *                               snapshot {name} | restore-snapshot {id} |
 *                               rename-snapshot {id, name} | delete-snapshot {id}
 */

import { NextResponse } from 'next/server';

import { listProfiles } from '@/lib/db';
import {
  changes, compareSnapshot, countLine, deleteSnapshot, renameSnapshot, restoreBefore, restoreSnapshot, snapshots, takeSnapshot, undoLast,
} from '@/lib/deck-history';
import { requireList } from '@/lib/profile-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const compare = new URL(request.url).searchParams.get('compare');
  if (compare) {
    const diff = compareSnapshot(id, compare);
    if (!diff) return NextResponse.json({ error: 'No such snapshot' }, { status: 404 });
    return NextResponse.json({ diff, summary: countLine(diff) });
  }
  const limit = Math.min(500, Math.max(1, Number(new URL(request.url).searchParams.get('limit')) || 200));
  const names = new Map(listProfiles().map((p) => [p.id, p.name]));
  return NextResponse.json({
    changes: changes(id, limit).map((c) => ({ ...c, who: c.profileId ? names.get(c.profileId) ?? c.profileId : null })),
    snapshots: snapshots(id),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  let b: { action?: string; changeId?: string; id?: string; name?: string };
  try { b = await request.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const who = { profile: owned.profile };
  switch (b.action) {
    case 'undo': {
      const change = await undoLast(id, who);
      return change ? NextResponse.json({ change }) : NextResponse.json({ error: 'Nothing to undo' }, { status: 409 });
    }
    case 'restore-before': {
      if (!b.changeId) return NextResponse.json({ error: 'changeId required' }, { status: 400 });
      const change = await restoreBefore(id, b.changeId, who);
      return change ? NextResponse.json({ change }) : NextResponse.json({ error: 'That change can no longer be restored' }, { status: 409 });
    }
    case 'snapshot':
      return NextResponse.json({ snapshot: takeSnapshot(id, b.name ?? '', who) });
    case 'restore-snapshot': {
      if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
      const change = await restoreSnapshot(id, b.id, who);
      return NextResponse.json({ change });
    }
    case 'rename-snapshot':
      if (!b.id || !renameSnapshot(id, b.id, b.name ?? '')) return NextResponse.json({ error: 'A snapshot needs a name' }, { status: 400 });
      return NextResponse.json({ ok: true });
    case 'delete-snapshot':
      if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
      deleteSnapshot(id, b.id);
      return NextResponse.json({ ok: true });
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
}
