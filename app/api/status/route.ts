/**
 * GET: how the app stands, for the update banner and the deploy script
 * (handoff 9, Part B): this build's id, whether a deploy is under way, and how
 * many background jobs are running; which database it has open (a hash of
 * the path) and how many profiles it holds. No profile needed: nothing in it
 * is anyone's, and the deploy script asks it from the same machine.
 */

import { NextResponse } from 'next/server';

import { database } from '@/lib/db';
import { runningCount } from '@/lib/jobs';
import { taggingRunning } from '@/lib/tag-job-server';
import { buildId, databaseId, updatingSince } from '@/lib/updating';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  // The database: a hash of its path (not the path) and how many profiles it holds, so a deploy can tell the new
  // version opened the real one and not a fresh empty file.
  const profiles = (database().get('SELECT COUNT(*) AS n FROM profiles') as { n: number } | null)?.n ?? 0;
  return NextResponse.json({ build: buildId(), updating: updatingSince(), running: runningCount() + taggingRunning(), db: databaseId(), profiles }, { headers: { 'Cache-Control': 'no-store' } });
}
