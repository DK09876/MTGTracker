/**
 * The model every AI feature uses. GET: each model, whether the server has
 * its key, today's requests and whether it last answered. PUT { model }:
 * use it. POST { model }: ask it something tiny (one of its requests).
 */

import { NextResponse } from 'next/server';

import { chooseModel, ModelError, modelStatuses, testModel } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const modelIn = async (request: Request) => {
  const b = await request.json().catch(() => ({})) as { model?: unknown };
  return typeof b.model === 'string' ? b.model : '';
};

export async function GET() {
  return NextResponse.json({ models: modelStatuses() });
}

export async function PUT(request: Request) {
  try {
    chooseModel(await modelIn(request));
  } catch (error) {
    if (error instanceof ModelError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
  return NextResponse.json({ models: modelStatuses() });
}

export async function POST(request: Request) {
  try {
    return NextResponse.json({ models: await testModel(await modelIn(request)) });
  } catch (error) {
    if (error instanceof ModelError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
