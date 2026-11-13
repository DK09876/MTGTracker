/**
 * GET: how the app stands, for the update banner and the deploy script
 * (handoff 9, Part B): this build's id, whether a deploy is under way, and how
 * many background jobs are running. No profile needed: nothing in it is
 * anyone's, and the deploy script asks it from the same machine.
 */

import { NextResponse } from 'next/server';

import { runningCount } from '@/lib/jobs';
import { taggingRunning } from '@/lib/tag-job-server';
import { buildId, updatingSince } from '@/lib/updating';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ build: buildId(), updating: updatingSince(), running: runningCount() + taggingRunning() }, { headers: { 'Cache-Control': 'no-store' } });
}
