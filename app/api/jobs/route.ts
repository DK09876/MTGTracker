/**
 * GET: the profile's background jobs - running, and finished in the last
 * few minutes - for the header's jobs menu. Tagging jobs on the profile's
 * decks are listed alongside, in the same shape.
 */

import { NextResponse } from 'next/server';

import { access } from '@/lib/auth';
import { listLists } from '@/lib/db';
import { recentJobs, RECENT_MS, type Job } from '@/lib/jobs';
import { requireProfile } from '@/lib/profile-route';
import { currentJob } from '@/lib/tag-job-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  const since = new Date(Date.now() - RECENT_MS).toISOString();
  const tagging: Job[] = listLists(who.profile, 'deck').flatMap((list) => {
    const t = currentJob(list.id);
    if (!t || (t.status !== 'running' && (t.finishedAt ?? '') < since)) return [];
    const proposing = t.params.kind === 'propose';
    return [{
      id: t.id, kind: 'brief' as const, label: proposing ? 'Suggesting tags' : 'Tagging cards', subject: list.name,
      profileId: who.profile, listId: list.id,
      status: t.status === 'running' ? 'running' : t.status === 'done' ? 'done' : t.status === 'interrupted' ? 'interrupted' : 'failed',
      detail: proposing ? 'The model is reading the deck' : t.phase === 'audit' ? 'Checking each tag' : 'Tagging cards',
      done: proposing ? null : t.done, total: proposing ? null : t.total, result: null, error: t.error,
      startedAt: t.startedAt, finishedAt: t.finishedAt,
    }];
  });
  // App-wide work (the card data refresh) is the admins' business; for
  // everyone else it was a "1 running" they never started.
  const admin = !!access(who.profile)?.isAdmin;
  const own = recentJobs(who.profile).filter((j) => j.profileId || admin);
  const jobs = [...own, ...tagging].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  // Only what the menu needs.
  return NextResponse.json({ jobs: jobs.map((j) => Object.fromEntries(Object.entries(j).filter(([k]) => k !== 'result'))) });
}
