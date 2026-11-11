/**
 * A deck's plan - what it is built to do.
 *
 * GET: every part of the plan (value, who set it, how sure, confirmed, how
 * it was worked out), what to look at first, every rule with this deck's
 * setting, the changes to the usual rules, and Claude's proposals.
 * PUT: change any part (deck-plan.ts PlanChange) - changing a part makes
 * it the owner's and confirms it - or confirm one part or the whole plan;
 * keep or drop a detected theme; accept or skip one of Claude's proposals.
 * Confirming the whole plan saves the brief (the draft, if none was
 * written) and unlocks Tune, Chat and the paid Claude steps.
 */

import { NextResponse } from 'next/server';

import { cardsInList, setTagBrief } from '@/lib/db';
import { deckHash } from '@/lib/deck-hash';
import { changePlan, type PlanChange } from '@/lib/deck-plan';
import { acceptBrief, keepTheme, planState, settleProposal, unkeepTheme, type ThemeView } from '@/lib/plan-server';
import { requireList } from '@/lib/profile-route';
import { PROMPT_VERSIONS } from '@/lib/prompt-versions';
import { logOutcome, logShown, quietly } from '@/lib/suggestion-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const state = await planState(owned.list);
  // Claude's proposals as shown, for the suggestion log (once per distinct set).
  quietly(() => {
    const main = cardsInList(id).filter((c) => c.board === 'main');
    logShown(owned.profile, id, 'plan:', [{
      // Proposal keys are "<read id>:<n>": each read's proposals are their own list.
      key: `plan:proposals@${state.proposals[0]?.key.split(':')[0] ?? 'none'}`, task: 'plan', method: 'ai', model: state.proposalsModel, promptVersion: PROMPT_VERSIONS.planRead, deckHash: deckHash(owned.list.commander, main),
      items: state.proposals.map((p) => ({ key: p.key, reasonShown: `${p.label}: ${p.value}${p.why ? ` · ${p.why}` : ''}` })),
    }]);
  });
  return NextResponse.json(state);
}

type Body = PlanChange & { brief?: string; keepTheme?: string; unkeepTheme?: string; settle?: { key: string; status: 'accepted' | 'skipped' }; acceptBrief?: string };

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const { list } = owned;
  const body = await request.json().catch(() => ({})) as Body;
  const { brief, keepTheme: keep, unkeepTheme: unkeep, settle, acceptBrief: claudeBrief, ...change } = body;
  // Claude can't set anything itself: only an accepted proposal is Claude's.
  delete change.by;
  delete change.proposal;
  // Notes written on the page are the owner's, whatever the request says.
  if (change.notes) change.notes = { ...change.notes, by: 'owner' };

  if (typeof brief === 'string') {
    setTagBrief(id, brief.slice(0, 4000));
    if (brief.trim()) changePlan(id, { briefBy: 'yours' });
  }
  if (typeof claudeBrief === 'string' && claudeBrief.trim()) acceptBrief(id, claudeBrief);
  if (settle?.key) {
    const done = await settleProposal(list, settle.key, settle.status === 'skipped' ? 'skipped' : 'accepted');
    if (!done) return NextResponse.json({ error: 'That proposal can’t be used as it is: skip it, or set the part yourself.' }, { status: 400 });
    quietly(() => logOutcome(id, [settle.key], settle.status === 'skipped' ? 'refused' : 'accepted'));
  }
  if (keep || unkeep || change.confirm || change.confirmPart) {
    const now = await planState(list);
    if (keep) {
      const theme = (now.parts.themes.value as ThemeView[]).find((t) => t.id === keep);
      if (theme) keepTheme(list, theme);
    }
    if (unkeep) unkeepTheme(list, unkeep);
    // Confirming what the app detected saves it where a value must be set.
    const bracket = now.parts.bracket.value as { value: number | null; looksLike: number };
    if ((change.confirm || change.confirmPart === 'bracket') && bracket.value === null) changePlan(id, { bracket: bracket.looksLike });
    if (change.confirm || change.confirmPart === 'brief') {
      const text = now.brief.trim() || now.draft.trim();
      if (change.confirm && !text) return NextResponse.json({ error: 'Write a sentence on what the deck does first' }, { status: 400 });
      if (!now.brief.trim() && text) setTagBrief(id, text);
    }
  }
  changePlan(id, change);
  return NextResponse.json(await planState(list));
}
