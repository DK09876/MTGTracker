/**
 * Today's requests left on the profile's tagging model (and Flash-Lite behind
 * a Gemini one), and when they reset - with, for Claude, today's spending.
 */

import { NextResponse } from 'next/server';

import { appModel, currentBudget } from '@/lib/ai';
import { profileOf } from '@/lib/profile-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const profile = profileOf(request);
  return NextResponse.json({ ...currentBudget(profile, 'tagging'), configured: !!appModel(profile, 'tagging') });
}
