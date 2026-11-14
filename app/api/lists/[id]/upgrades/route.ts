/**
 * Upgrades (lib/upgrades.ts): what would make a finished deck better, from
 * the owner's cards or to buy, and what each card replaces. One conversation
 * per deck.
 *
 * GET: the view: the settings, the latest list with the owner's choices, the
 * searches of the round running now.
 * POST {action, ...}:
 *   settings {count?, sources?}   how many (5, 10, 20) and where from ("both" | "mine" | "buy"); kept per deck
 *   find {rerun?, message?}       ask Claude in the background: the first list, or the owner's marks and words
 *   choices {choices}             Swap in / Rethink / Not for me, reasons, "Maybeboard instead"; replaced whole
 *   unskip {name}                 take a card off the deck's "Not for me" list
 *   apply                         the swaps, after a snapshot
 *   undo                          put every row back as it was
 *   reset                         start over
 */

import { NextResponse } from 'next/server';

import { claudeCall, ModelError } from '@/lib/ai';
import { recorded, takeSnapshot } from '@/lib/deck-history';
import { latestJob, startJob } from '@/lib/jobs';
import { requireList, requirePlan } from '@/lib/profile-route';
import { TRIM_MODELS } from '@/lib/trim-shared';
import { applyUpgrades, resetUpgrades, runUpgrades, setUpgradeChoices, setUpgrades, undoUpgrades, unskipUpgrade, upgradesView } from '@/lib/upgrades';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_KEY = 'No Claude key is set on the server, so Claude can’t be asked. The free list from the deck’s numbers works without one.';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  return NextResponse.json(await upgradesView(owned.list, owned.profile));
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const locked = requirePlan(id);
  if (locked) return locked;
  const { list, profile } = owned;
  const b = await request.json().catch(() => ({})) as Record<string, unknown>;
  if ((b.action === 'unskip' || b.action === 'apply') && latestJob('upgrades', id)?.status === 'running') {
    return NextResponse.json({ error: 'Claude is working on this list: wait for the round to finish' }, { status: 409 });
  }
  try {
    switch (b.action) {
      case 'settings':
        setUpgrades(id, { count: b.count, sources: b.sources });
        break;
      case 'find': {
        if (!process.env.ANTHROPIC_API_KEY || profile === 'tour') return NextResponse.json({ error: NO_KEY }, { status: 503 });
        if (latestJob('upgrades', id)?.status === 'running') return NextResponse.json({ error: 'Claude is already working on this list' }, { status: 409 });
        // Every AI step on the deck pages runs on Opus.
        const model = TRIM_MODELS.opus.id;
        const call = claudeCall(model, { profile, feature: 'upgrades', label: list.name });
        startJob({ kind: 'upgrades', label: 'Looking for upgrades', subject: list.name, profileId: profile, listId: id, errorLevel: (e) => (e instanceof ModelError ? 'warn' : 'error') },
          ({ progress }) => runUpgrades(call, model, list, profile, { rerun: b.rerun === true, message: typeof b.message === 'string' ? b.message : '' }, progress));
        break;
      }
      case 'choices':
        setUpgradeChoices(id, b.choices);
        break;
      case 'unskip':
        if (typeof b.name !== 'string') return NextResponse.json({ error: 'Which card?' }, { status: 400 });
        unskipUpgrade(id, b.name);
        break;
      case 'apply':
        takeSnapshot(id, 'Before applying upgrades', { profile }, true);
        await recorded(id, { profile }, 'tune', 'Applied upgrades', () => applyUpgrades(list, profile));
        break;
      case 'undo':
        await recorded(id, { profile }, 'undo', 'Undid the upgrades', () => undoUpgrades(list));
        break;
      case 'reset':
        resetUpgrades(id);
        break;
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not do that' }, { status: 400 });
  }
  return NextResponse.json(await upgradesView(list, profile));
}
