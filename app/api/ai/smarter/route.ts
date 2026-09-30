/**
 * Whether smarter mode can be used: GET says whether the smarter model has
 * been answering; POST asks it something tiny to find out (one request of
 * its own daily allowance). See lib/ai.ts.
 */

import { NextResponse } from 'next/server';

import { checkSmarter, smarterStatus } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(smarterStatus());
}

export async function POST() {
  return NextResponse.json(await checkSmarter());
}
