/**
 * Today's free requests left on the model in use (and Flash-Lite behind it), and when they reset.
 * The same for everyone: the app shares one key.
 */

import { NextResponse } from 'next/server';

import { appModel, currentBudget } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ...currentBudget(), configured: !!appModel() });
}
