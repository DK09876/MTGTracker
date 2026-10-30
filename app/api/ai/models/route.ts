/**
 * The models the asking profile uses, and what they cost - for Settings and
 * the header's picker.
 *
 *   GET                                  every model, which features use it, today's use and spending
 *   PUT {model, features}                use a model for some features (rules, tagging, search)
 *   PUT {effort}                         how hard Claude thinks on rules and tagging
 *   PUT {caps: {daily?, perProfile?}}    the app's daily spending caps, in dollars
 *   POST {model}                         ask it something tiny (one request)
 */

import { NextResponse } from 'next/server';

import { aiState, chooseEffort, chooseModel, ModelError, setCaps, testModel } from '@/lib/ai';
import { FEATURES, type Feature } from '@/lib/models';
import { profileOf } from '@/lib/profile-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const refused = (error: unknown) => {
  if (error instanceof ModelError) return NextResponse.json({ error: error.message }, { status: 400 });
  throw error;
};

export async function GET(request: Request) {
  return NextResponse.json(aiState(profileOf(request)));
}

export async function PUT(request: Request) {
  const profile = profileOf(request);
  const b = await request.json().catch(() => ({})) as { model?: unknown; features?: unknown; effort?: unknown; caps?: unknown };
  try {
    if (typeof b.model === 'string') {
      const features = Array.isArray(b.features) ? b.features.filter((f): f is Feature => FEATURES.includes(f as Feature)) : [];
      if (!features.length) return NextResponse.json({ error: 'Say which features use it' }, { status: 400 });
      chooseModel(profile, b.model, features);
    }
    if (typeof b.effort === 'string') chooseEffort(profile, b.effort);
    if (b.caps && typeof b.caps === 'object') setCaps(b.caps as Record<string, unknown>);
  } catch (error) {
    return refused(error);
  }
  return NextResponse.json(aiState(profile));
}

export async function POST(request: Request) {
  const b = await request.json().catch(() => ({})) as { model?: unknown };
  try {
    return NextResponse.json(await testModel(profileOf(request), typeof b.model === 'string' ? b.model : ''));
  } catch (error) {
    return refused(error);
  }
}
