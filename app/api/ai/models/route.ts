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

import { aiState, chooseAppModel, chooseMode, ModelError, setCaps, testModel } from '@/lib/ai';
import type { AiArea, AiMode, Feature } from '@/lib/models';
import { profileOf, requireAdmin, requireProfile } from '@/lib/profile-route';

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
  const who = requireProfile(request);
  if (who instanceof NextResponse) return who;
  const { profile } = who;
  const b = await request.json().catch(() => ({})) as { area?: unknown; mode?: unknown; caps?: unknown; app?: unknown };
  // The caps and the app's own models are for admins.
  if (b.caps !== undefined || b.app !== undefined) {
    const admin = requireAdmin(request);
    if (admin instanceof NextResponse) return admin;
  }
  try {
    // {area, mode}: this profile's Regular or Smart on one page.
    if (typeof b.area === 'string' && typeof b.mode === 'string') chooseMode(profile, b.area as AiArea, b.mode as AiMode);
    if (b.caps && typeof b.caps === 'object') setCaps(b.caps as Record<string, unknown>);
    // {app: {feature: {regular?, smart?}}}: which model each mode uses on each step.
    if (b.app && typeof b.app === 'object') {
      for (const [feature, byMode] of Object.entries(b.app as Record<string, Record<string, unknown>>)) {
        for (const [mode, id] of Object.entries(byMode ?? {})) {
          if (typeof id === 'string') chooseAppModel(id, feature as Feature, mode as AiMode);
        }
      }
    }
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
