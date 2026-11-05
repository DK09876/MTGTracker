/**
 * A deck's plan - what it is built to do.
 *
 * GET: the brief (or a draft of one), the main and second style as detected
 * and as chosen, every role's range, the cards it wins with, and whether
 * the plan is confirmed.
 * PUT {brief?, style?, style2?, targets?, confirm?}: change any of it;
 * confirm saves the brief (the draft, if none was written) and unlocks the
 * AI steps.
 */

import { NextResponse } from 'next/server';

import { cardsInList, deckTags, setTagBrief } from '@/lib/db';
import { changePlan, draftFromCards, planFor, type PlanChange } from '@/lib/deck-plan';
import { deckRoles } from '@/lib/deck-roles';
import { requireList } from '@/lib/profile-route';
import { STYLES, VALUE } from '@/lib/styles';
import { FINISHING } from '@/lib/build';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function read(id: string, commander: Parameters<typeof planFor>[2]) {
  const main = cardsInList(id).filter((c) => c.board === 'main');
  const tags = deckTags(id);
  const plan = planFor(id, tags.brief, commander, main);
  // How it wins: cards tagged as a win condition, then the finisher roles.
  const winTags = new Set(tags.tags.filter((t) => t.kind === 'wincon').map((t) => t.id));
  const winKeys = new Set(tags.cardTags.filter((t) => t.on && winTags.has(t.tagId)).map((t) => t.key));
  const pool = commander ? [{ card: commander }, ...main] : main;
  const tagged = pool.filter((c) => winKeys.has(c.card.oracle_id ?? c.card.id)).map((c) => c.card.name);
  const roles = await deckRoles(id, main).catch(() => []);
  const finishers = roles.filter((r) => FINISHING.includes(r.id)).flatMap((r) => r.cards);
  const wins = { tagged, finishers: [...new Set(finishers)].filter((n) => !tagged.includes(n)).sort() };
  const draft = plan.draft || (plan.brief ? '' : draftFromCards(commander, plan.style, plan.style2, [...tagged, ...wins.finishers]));
  // Theme packages: the owner's tags (not win conditions or pets), each with a size and how full it is.
  const inMain = new Set(main.map((c) => c.card.oracle_id ?? c.card.id));
  const packages = tags.tags.filter((t) => t.status === 'accepted' && t.kind !== 'wincon' && !/^(pets?|fun|favou?rites?)$/i.test(t.name))
    .map((t) => ({ tagId: t.id, name: t.name, kind: t.kind, size: plan.packages[t.id] ?? 8, count: tags.cardTags.filter((ct) => ct.on && ct.tagId === t.id && inMain.has(ct.key)).length }));
  return {
    ...plan,
    draft,
    style: plan.style.id,
    style2: plan.style2?.id ?? null,
    wins,
    packages,
    styles: [...STYLES, VALUE].map((s) => ({ id: s.id, label: s.label, note: s.note, cards: plan.detected.support[s.id] ?? 0 })),
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  return NextResponse.json(await read(id, owned.list.commander));
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = requireList(request, id);
  if (owned instanceof NextResponse) return owned;
  const body = await request.json().catch(() => ({})) as PlanChange & { brief?: string };
  if (typeof body.brief === 'string') setTagBrief(id, body.brief.slice(0, 4000));
  if (body.confirm) {
    const now = await read(id, owned.list.commander);
    const brief = now.brief.trim() || now.draft.trim();
    if (!brief) return NextResponse.json({ error: 'Write a sentence on what the deck does first' }, { status: 400 });
    if (!now.brief.trim()) setTagBrief(id, brief);
  }
  changePlan(id, { style: body.style, style2: body.style2, targets: body.targets, confirm: body.confirm, flip: body.flip, packages: body.packages });
  return NextResponse.json(await read(id, owned.list.commander));
}
