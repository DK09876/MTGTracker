'use client';

/**
 * Text, shown the app's way (AGENTS.md, "Showing text"): every piece of text the app shows that may name a card -
 * AI answers and reasons, the owner's notes, rules answers, search explanations - goes through here. Always on.
 *
 * - [[Card Name]] is a card: highlighted, its picture on hover (a real mouse), the card popup on a click or tap.
 *   The brackets never show. A name the app doesn't hold yet is looked up when pointed at (lib/card-cache.ts).
 * - Text with no [[marks]] (older answers, the owner's words) links the names its page knows (CardTextContext:
 *   a deck page knows its cards), whole names only.
 * - Mana symbols ({R}{G}) are drawn. `blocks` also reads paragraphs, "- " lists and **bold** (long answers).
 *
 * Only text inside an input box stays plain: it is being edited.
 */

import { createContext, Fragment, useContext, useEffect, useMemo, useState } from 'react';

import CardName from './CardName';
import { openCard } from './CardPopup';
import LookupName from './LookupName';
import SymbolText from './SymbolText';
import { lookCard, useCardState } from '@/lib/card-cache';
import { blocksOf, boldRuns, marksNames, splitMarked, splitNames } from '@/lib/chat-text';
import type { ScryfallCard } from '@/lib/scryfall';

/**
 * What a page knows about cards, for every CardText inside it: cards it already holds by name (a deck's), the names
 * to link in text with no [[marks]], and its own popup (a deck page's has the deck's actions). All optional.
 */
export interface CardTextCards {
  cardOf?: (name: string) => ScryfallCard | undefined;
  names?: string[];
  onOpen?: (card: ScryfallCard) => void;
}
export const CardTextContext = createContext<CardTextCards>({});

/** One card name: the card when known (picture on hover, popup on click), else looked up when pointed at. */
export function CardLink({ name, label = name, className = '' }: { name: string; label?: string; className?: string }) {
  const ctx = useContext(CardTextContext);
  const st = useCardState(name);
  const opener = ctx.onOpen ?? openCard;
  // A card known only by name and picture (a stub kept with an answer) is read in full before its popup opens.
  const open = (c: ScryfallCard) => { if (c.type_line) opener(c); else void fullCard(c).then(opener); };
  // A card the page holds is a plain link; one looked up by name stays a LookupName from first hover to found, so
  // its preview isn't lost when the answer comes in (it shows the card once found).
  const card = ctx.cardOf?.(name);
  // A tap on a name still being looked up opens its card once found (the looking-up link is gone by then).
  const [openWhenFound, setOpenWhenFound] = useState(false);
  useEffect(() => {
    if (!openWhenFound || st.status === 'loading' || st.status === 'idle') return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the tap's wish, answered once the lookup is in
    setOpenWhenFound(false);
    if (st.status === 'found') open(st.card);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once per answer
  }, [openWhenFound, st]);
  if (card) return <CardName name={label} card={card} onOpen={open} className={className} />;
  return <LookupName name={label} state={st} onLook={(retry) => void lookCard(name, retry)} onOpen={open} onTap={() => setOpenWhenFound(true)} />;
}

/**
 * More names for the text inside to link, beside the page's: a list's own cards (Finish's picks, Upgrades'
 * suggestions), which its reasons name without [[marks]] in answers written before the agent context.
 */
export function MoreCardNames({ names, children }: { names: string[]; children: React.ReactNode }) {
  const outer = useContext(CardTextContext);
  const key = names.join('\u0001');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- by the names, not the array
  const value = useMemo(() => ({ ...outer, names: [...(outer.names ?? []), ...names] }), [outer, key]);
  return <CardTextContext.Provider value={value}>{children}</CardTextContext.Provider>;
}

/** A card in full, from a stub that has only its id and name (lib/cards.ts through /api/cards). */
async function fullCard(c: ScryfallCard): Promise<ScryfallCard> {
  const base = process.env.NEXT_PUBLIC_MTG_BASE_PATH ?? '';
  const r: { card?: ScryfallCard } = await fetch(`${base}/api/cards?id=${encodeURIComponent(c.id)}`).then((x) => (x.ok ? x.json() : {})).catch(() => ({}));
  if (r.card) return r.card;
  const s = await lookCard(c.name);
  return s.status === 'found' ? s.card : c;
}

/** Open a card in the app's popup, read in full first when only its id, name and picture are known. */
export function openFullCard(c: ScryfallCard): void {
  if (c.type_line) openCard(c);
  else void fullCard(c).then(openCard);
}

/** Card names in a line, comma-separated, each a CardLink. */
export function CardLinks({ names, className = '' }: { names: string[]; className?: string }) {
  return <>{names.map((n, i) => <Fragment key={`${n}-${i}`}>{i > 0 && ', '}<CardLink name={n} className={className} /></Fragment>)}</>;
}

export default function CardText({ text, blocks = false, names: own }: {
  text: string | null | undefined;
  /** Read paragraphs, lists and bold (a long answer). Default: one inline run, for a reason or a note. */
  blocks?: boolean;
  /** More names to link in unmarked text, beside the page's. */
  names?: string[];
}) {
  const ctx = useContext(CardTextContext);
  const value = text ?? '';
  const marked = useMemo(() => marksNames(value), [value]);
  const names = useMemo(() => (marked ? [] : [...(ctx.names ?? []), ...(own ?? [])]), [marked, ctx.names, own]);
  if (!value) return null;
  const run = (t: string, key: string) => (marked ? splitMarked(t) : splitNames(t, names)).map((p, j) => (
    p.name ? <CardLink key={`${key}-${j}`} name={p.name} label={p.text} /> : <SymbolText key={`${key}-${j}`} text={p.text} />
  ));
  if (!blocks) return <>{run(value, 'r')}</>;
  const inline = (line: string, key: string) => boldRuns(line).map((r, k) => (r.bold
    ? <b key={`${key}-${k}`} className="font-semibold">{run(r.text, `${key}-${k}`)}</b>
    : <Fragment key={`${key}-${k}`}>{run(r.text, `${key}-${k}`)}</Fragment>));
  return (
    <div className="flex flex-col gap-1.5 leading-relaxed" data-card-text>
      {blocksOf(value).map((b, i) => (b.list ? (
        <ul key={i} className="list-disc space-y-1 pl-5">{b.lines.map((l, j) => <li key={j}>{inline(l, `${i}-${j}`)}</li>)}</ul>
      ) : (
        <p key={i} className="whitespace-pre-wrap">{b.lines.map((l, j) => <Fragment key={j}>{j > 0 && '\n'}{inline(l, `${i}-${j}`)}</Fragment>)}</p>
      )))}
    </div>
  );
}
