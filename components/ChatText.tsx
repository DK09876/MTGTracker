'use client';

/**
 * An answer's text in Chat (review item 29): bold and lists drawn as such,
 * so no asterisks show, and every card name the answer's look-ups, its
 * proposals or the deck know is a card link with hover and click (a tap on a
 * phone opens it). Matched at render, so older chats get it too.
 */

import { Fragment, useMemo } from 'react';

import CardName from './CardName';
import LookupName from './LookupName';
import type { LookupState } from '@/lib/card-lookup';
import SymbolText from './SymbolText';
import { blocksOf, boldRuns, marksNames, splitMarked, splitNames } from '@/lib/chat-text';
import type { ScryfallCard } from '@/lib/scryfall';

export default function ChatText({ text, names, cardOf, onOpen, lookup }: {
  text: string;
  /** The names to link. */
  names: string[];
  /** A card by name: the deck's full card, or one with its id and picture. */
  cardOf: (name: string) => ScryfallCard | undefined;
  onOpen: (card: ScryfallCard) => void;
  /** A marked name the app couldn't find: looked up on hover or tap (item 39). */
  lookup?: { state: (name: string) => LookupState<ScryfallCard>; look: (name: string, retry?: boolean) => void };
}) {
  const blocks = useMemo(() => blocksOf(text), [text]);
  // Newer answers mark their card names [[like this]]: only those link. Older ones are matched against known names.
  const marked = useMemo(() => marksNames(text), [text]);
  const inline = (line: string, key: string) => boldRuns(line).map((run, k) => {
    const pieces = (marked ? splitMarked(run.text) : splitNames(run.text, names)).map((p, j) => {
      const card = p.name ? cardOf(p.name) : undefined;
      if (card) return <CardName key={j} name={p.text} card={card} onOpen={onOpen} />;
      // A name the answer marked that matched no card stays a link that looks the card up when pointed at.
      if (marked && p.name && lookup) {
        const st = lookup.state(p.name);
        return st.status === 'found' ? <CardName key={j} name={p.text} card={st.card} onOpen={onOpen} />
          : <LookupName key={j} name={p.text} state={st} onLook={(retry) => lookup.look(p.name!, retry)} onOpen={onOpen} />;
      }
      return <SymbolText key={j} text={p.text} />;
    });
    return run.bold ? <b key={`${key}-${k}`} className="font-semibold">{pieces}</b> : <Fragment key={`${key}-${k}`}>{pieces}</Fragment>;
  });
  return (
    <div className="flex flex-col gap-1.5 text-sm leading-relaxed" data-chat-text>
      {blocks.map((b, i) => (b.list ? (
        <ul key={i} className="list-disc space-y-1 pl-5">{b.lines.map((l, j) => <li key={j}>{inline(l, `${i}-${j}`)}</li>)}</ul>
      ) : (
        <p key={i} className="whitespace-pre-wrap">{b.lines.map((l, j) => <Fragment key={j}>{j > 0 && '\n'}{inline(l, `${i}-${j}`)}</Fragment>)}</p>
      )))}
    </div>
  );
}
