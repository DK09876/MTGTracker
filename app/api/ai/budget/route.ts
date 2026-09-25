/**
 * Today's free requests left on each tagging model, and when they reset.
 * The same for everyone: the app shares one key.
 */

import { NextResponse } from 'next/server';

import { currentBudget } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ...currentBudget(), configured: !!process.env.GEMINI_API_KEY });
}
