/**
 * Tune for a deck. It waits for the deck's plan, which every suggestion reads.
 *
 * GET ?intent=&symptom=: the suggestions for one intent (lib/tune.ts), your
 * changes and what they would do to the deck.
 * POST {action, ...}:
 *   stage {items}          suggestions into your changes (cuts stop at 100)
 *   unstage {keys}         out of your changes, a swap as a pair
 *   dismiss / undismiss {keys}
 *   save {section, items}  the cards to add into a section, for later
 *   clear                  empty your changes
 *   apply {cutsTo?}        move the cards; cuts to the section for cards that came out
 *   undo {undo}            put back exactly what an apply moved; staged changes stay
 *   keep {cardId, keep}    ★ keep a card (Claude's "keep this")
 *   pile {choice}          for a pile: 'fill' to 100, or the 'best' 100 from everything
 *   finishPicks {choice?, showRules?}  Finish the deck: picks from the rules or Claude, remembered per deck
 *   verdict {id, verdict}  how a fix went; "worse" stages undoing it
 *   propose {intent, title, why, items}  Claude's changes from Chat, waiting in Tune
 *   reason {key, chip?, text?}  why a dismissed suggestion was refused (the suggestion log)
 *
 * Every suggestion shown, and what became of it, goes to the suggestion log
 * (lib/suggestion-log.ts) when the profile shares it.
 */

import { NextResponse } from 'next/server';

import { addCardToList, cardsInList } from '@/lib/db';
import { setKeep } from '@/lib/deck-roles';
import { requireList, requirePlan } from '@/lib/profile-route';
import { getCard } from '@/lib/scryfall';
import { hasBoard } from '@/lib/sections';
import { recorded, takeSnapshot } from '@/lib/deck-history';
import { applyChanges, ref, stage, tuneState, undoApply, unstage, type UndoMoves } from '@/lib/tune';
import { INTENTS, SYMPTOMS, type Intent, type Suggestion, type Symptom } from '@/lib/tune-shared';
import { PROMPT_VERSIONS } from '@/lib/prompt-versions';
import { newKey, tuneStore, updateTune } from '@/lib/tune-store';
import { clearOutcome, closeAll, logOutcome, logReason, quietly, REASON_CHIPS, type ReasonChip } from '@/lib/suggestion-log';
import { logTuneView } from '@/lib/tune-log';
import { localCards } from '@/lib/card-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const intentOf = (v: unknown): Intent | undefined => (INTENTS.some((i) => i.id === v) ? v as Intent : undefined);
const symptomOf = (v: unknown): Symptom | undefined => (SYMPTOMS.some((s) => s.id === v) ? v as Symptom : undefined);
const keysOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string').slice(0, 300) : []);
const itemsOf = (v: unknown): Suggestion[] => (Array.isArray(v) ? v.filter((i): i is Suggestion => !!i && typeof i === 'object' && typeof (i as Suggestion).key === 'string').slice(0, 120) : []);

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const locked = requirePlan(id);
  if (locked) return locked;
  const q = new URL(request.url).searchParams;
  const state = await tuneState(owned.list, owned.profile, { intent: intentOf(q.get('intent')), symptom: symptomOf(q.get('symptom')) });
  // What was shown, for the suggestion log: written once per distinct group.
  logTuneView(owned.list, owned.profile, state.intent, state.groups);
  return NextResponse.json(state);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const { list, profile } = owned;
  const b = await request.json().catch(() => ({})) as Record<string, unknown>;
  // Chat can hand Tune a proposal at any time; everything else in Tune waits for the confirmed plan.
  const locked = b.action === 'propose' ? null : requirePlan(id);
  if (locked) return locked;
  switch (b.action) {
    case 'stage': {
      const items = itemsOf(b.items);
      const done = await stage(list, profile, items);
      // Accepted: the suggestions that made it into Your changes.
      const now = tuneStore(id).changes;
      const staged = new Set([...now.add, ...now.cut].map((x) => x.from).filter((x): x is string => !!x));
      quietly(() => logOutcome(id, items.map((i) => i.key).filter((k) => staged.has(k)), 'accepted'));
      return NextResponse.json(done);
    }
    case 'unstage': {
      const keys = keysOf(b.keys);
      // The keys may be staged entries' own keys: the suggestions they came from are open again.
      const was = tuneStore(id).changes;
      const from = [...was.add, ...was.cut].filter((x) => keys.includes(x.key) || (!!x.from && keys.includes(x.from))).map((x) => x.from).filter((x): x is string => !!x);
      unstage(id, keys);
      quietly(() => clearOutcome(id, [...new Set([...keys, ...from])]));
      return NextResponse.json({ ok: true });
    }
    case 'dismiss':
    case 'undismiss': {
      const keys = keysOf(b.keys);
      updateTune(id, (s) => { s.dismissed = b.action === 'dismiss' ? [...new Set([...s.dismissed, ...keys])] : s.dismissed.filter((k) => !keys.includes(k)); });
      quietly(() => (b.action === 'dismiss' ? logOutcome(id, keys, 'refused') : clearOutcome(id, keys)));
      return NextResponse.json({ ok: true });
    }
    case 'reason': {
      // An optional reason for a refusal: one tap, or a line in the owner's words (kept on the Pi, never exported).
      const key = typeof b.key === 'string' ? b.key : '';
      const chip = REASON_CHIPS.includes(b.chip as ReasonChip) ? b.chip as ReasonChip : null;
      const text = typeof b.text === 'string' ? b.text.slice(0, 600) : null;
      if (!key || (!chip && !text)) return NextResponse.json({ error: 'Pick a reason or write one' }, { status: 400 });
      let saved = false;
      quietly(() => { saved = logReason(id, key, chip, text); });
      return NextResponse.json({ ok: true, saved });
    }
    case 'save': {
      const section = typeof b.section === 'string' ? b.section : '';
      if (!section || section === 'main' || !hasBoard(id, section)) return NextResponse.json({ error: 'Pick a section' }, { status: 400 });
      const have = new Set(cardsInList(id).map((c) => c.card.name));
      let saved = 0;
      for (const item of itemsOf(b.items)) {
        if (!item.add || have.has(item.add.name)) continue;
        const card = await getCard(item.add.id).catch(() => null) ?? localCards([item.add.name])[0];
        if (!card) continue;
        addCardToList(id, card, item.add.quantity ?? 1, 'nonfoil', section);
        have.add(card.name);
        saved += 1;
        quietly(() => logOutcome(id, [item.key], 'accepted'));
      }
      return NextResponse.json({ saved });
    }
    case 'clear':
      updateTune(id, (s) => { s.changes = { add: [], cut: [] }; });
      return NextResponse.json({ ok: true });
    case 'apply': {
      const cutsTo = typeof b.cutsTo === 'string' && b.cutsTo !== 'main' && hasBoard(id, b.cutsTo) ? b.cutsTo : undefined;
      // A snapshot first: applying Tune's changes is a bulk change.
      takeSnapshot(id, 'Before applying Tune changes', { profile: owned.profile }, true);
      const { result } = await recorded(id, { profile: owned.profile }, 'tune', 'Applied Tune changes', () => applyChanges(list, cutsTo as Parameters<typeof applyChanges>[1]));
      // The deck moved on: whatever was shown and left untouched was ignored.
      quietly(() => closeAll(id, 'tune:'));
      return NextResponse.json(result);
    }
    case 'undo': {
      const undo = b.undo as UndoMoves | undefined;
      if (!undo || !Array.isArray(undo.moves)) return NextResponse.json({ error: 'Nothing to undo' }, { status: 400 });
      const { result } = await recorded(id, { profile: owned.profile }, 'undo', 'Undid Tune changes', () => undoApply(list, { moves: undo.moves.slice(0, 400) }));
      return NextResponse.json(result);
    }
    case 'keep': {
      const card = cardsInList(id).find((c) => c.card.id === b.cardId)?.card;
      if (!card) return NextResponse.json({ error: 'No such card in the deck' }, { status: 400 });
      setKeep(id, card.oracle_id ?? card.id, b.keep !== false);
      // Claude's "keep this", accepted.
      if (typeof b.key === 'string' && b.keep !== false) quietly(() => logOutcome(id, [b.key as string], 'accepted'));
      return NextResponse.json({ ok: true });
    }
    case 'finishPicks':
      updateTune(id, (s) => {
        if (b.choice === 'rules' || b.choice === 'claude') s.finishPicks = b.choice;
        if (typeof b.showRules === 'boolean') s.finishShowRules = b.showRules;
      });
      return NextResponse.json({ ok: true });
    case 'pile':
      updateTune(id, (s) => { s.pile = b.choice === 'fill' || b.choice === 'best' ? b.choice : null; });
      return NextResponse.json({ ok: true });
    case 'verdict': {
      const verdict = b.verdict === 'better' || b.verdict === 'same' || b.verdict === 'worse' ? b.verdict : null;
      let undo: Suggestion[] = [];
      updateTune(id, (s) => {
        const entry = s.log.find((l) => l.id === b.id);
        if (!entry || !verdict) return;
        entry.verdict = verdict;
        if (verdict === 'worse') {
          const all = cardsInList(id);
          undo = entry.swaps.map((sw) => {
            const back = all.find((c) => c.card.name === sw.cut && c.board !== 'main')?.card;
            const out = all.find((c) => c.card.name === sw.add && c.board === 'main')?.card;
            return back && out ? { key: newKey(`undo:${entry.id}`), add: { id: back.id, name: back.name, cmc: back.cmc ?? 0, manaCost: '', typeLine: back.type_line ?? '', image: null }, cut: { id: out.id, name: out.name, cmc: out.cmc ?? 0, manaCost: '', typeLine: out.type_line ?? '', image: null }, why: `Undoing a fix that made things worse: ${sw.cut} back for ${sw.add}` } : null;
          }).filter((x): x is NonNullable<typeof x> => !!x) as Suggestion[];
        }
      });
      const done = undo.length ? await stage(list, profile, undo) : { staged: 0, capped: 0 };
      return NextResponse.json({ ok: true, staged: done.staged });
    }
    case 'propose': {
      const intent = intentOf(b.intent) ?? 'swaps';
      // The cards as the suggestion shows them, from the deck or the card data: Chat only sends names and ids.
      const all = cardsInList(id);
      const full = (r: Suggestion['add']) => {
        if (!r) return undefined;
        const card = all.find((c) => c.card.id === r.id)?.card ?? localCards([r.name])[0];
        return card ? { ...ref(card, { where: r.where ?? null, from: all.find((c) => c.card.id === card.id)?.board }), quantity: r.quantity ?? 1 } : undefined;
      };
      const items = itemsOf(b.items).map((i) => ({ ...i, key: `chat:${i.key}`, add: full(i.add), cut: full(i.cut) })).filter((i) => i.add || i.cut);
      if (!items.length) return NextResponse.json({ error: 'Nothing to send' }, { status: 400 });
      updateTune(id, (s) => {
        const group = { key: newKey('chat'), title: typeof b.title === 'string' ? b.title.slice(0, 120) : `From Chat · ${items.length}`, why: typeof b.why === 'string' ? b.why.slice(0, 300) : 'Claude proposed these in Chat.', source: 'claude' as const, items, model: null, promptVersion: PROMPT_VERSIONS.chat, round: new Date().toISOString() };
        // Chat's groups stack up to three; the latest Tune ideas stay first.
        s.proposals[intent] = [...(s.proposals[intent] ?? []).filter((g) => !g.key.startsWith('chat-')).slice(0, 1), group, ...(s.proposals[intent] ?? []).filter((g) => g.key.startsWith('chat-')).slice(0, 2)];
      });
      return NextResponse.json({ ok: true, intent });
    }
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
}
