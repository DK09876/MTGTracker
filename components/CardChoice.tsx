'use client';

/**
 * Checking the owner's words for cards before they're sent (AGENTS.md, "Reading the owner's words"). A page that sends
 * what the owner typed to an AI calls `check` from useCardCheck first and sends what it returns:
 *
 *   const cards = useCardCheck();
 *   const send = async () => { const text = await cards.check(typed, { known: deckNames }); if (text !== null) go(text); };
 *   ...{cards.panel}
 *
 * `check` reads the text on the server (lib/cards.ts readCards): the cards it's sure of come back marked
 * [[like this]]. Anything it isn't sure of is asked here, with the cards' pictures, before anything is sent: a
 * misspelt name ("Did you mean…"), a word that begins several names ("Which Kratos?"), or a card's name in everyday
 * words ("lightning bolt": the card, or just the words?). The owner's picks are remembered for their profile, so the
 * same words aren't asked again; the page says how it read them, with a way to forget. "None of these" sends
 * nothing: the owner is asked to check the spelling and try again.
 */

import Image from 'next/image';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import CardText, { CardLink } from '@/components/CardText';
import * as api from '@/lib/api';
import { NOT_A_CARD, type CardPick, type CardReading, type NamedChoice } from '@/lib/card-names';
import { steady } from '@/lib/steady-tap';

const button = 'min-h-10 rounded-full border border-[var(--border)] px-3 text-sm hover:bg-[var(--surface-hover)] disabled:opacity-50';

const heading = (c: NamedChoice) =>
  c.kind === 'typo' ? <>No card is named “{c.mention}”. Did you mean…</>
    : c.kind === 'maybe' ? <>“{c.mention}”: the card, or just the words?</>
      : <>Which {c.mention[0].toUpperCase() + c.mention.slice(1)} did you mean?</>;

interface Props {
  choice: NamedChoice;
  /** What the owner wrote, shown under the heading. */
  question?: string;
  onPick: (name: string) => void;
  /** "None of these" (or "Just the words" for a card's name in everyday words). */
  onNone?: () => void;
  onCancel?: () => void;
  busy?: boolean;
  id?: string;
}

export default function CardChoice({ choice: c, question, onPick, onNone, onCancel, busy = false, id = 'which-card' }: Props) {
  return (
    <section id={id} className="mt-5 flex scroll-mt-20 flex-col gap-5 rounded-2xl border border-[var(--accent)]/50 p-4" aria-label="Which card?">
      <div>
        <h2 className="font-medium">{heading(c)}</h2>
        {question && <p className="text-sm text-[var(--muted)]">For: <CardText text={question} /></p>}
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {c.options.map((o) => (
            <button key={o.name} disabled={busy} {...steady(() => onPick(o.name))} className="flex flex-col gap-1 rounded-xl border border-[var(--border)] p-2 text-left text-sm hover:border-[var(--accent)] disabled:opacity-60">
              {o.image && <Image src={o.image} alt="" width={244} height={340} className="w-full rounded-lg" unoptimized />}
              <span>{o.name}</span>
            </button>
          ))}
        </div>
        {onNone && <button disabled={busy} {...steady(onNone)} className={`${button} mt-3`}>{c.kind === 'maybe' ? 'Just the words' : 'None of these'}</button>}
      </div>
      {onCancel && <button onClick={onCancel} className={`${button} self-start`}>Cancel</button>}
    </section>
  );
}

interface Asking {
  reading: CardReading;
  text: string;
  known: string[];
  picks: CardPick[];
  resolve: (text: string | null) => void;
}

/** Check the owner's words before sending them: see the top of this file. */
export function useCardCheck(): {
  check: (text: string, opts?: { known?: string[] }) => Promise<string | null>;
  panel: ReactNode;
  asking: boolean;
} {
  const [asking, setAsking] = useState<Asking | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [readAs, setReadAs] = useState<CardReading['readAs']>([]);

  const check = useCallback(async (text: string, { known = [] }: { known?: string[] } = {}): Promise<string | null> => {
    setNotice(null);
    setReadAs([]);
    asking?.resolve(null);
    setAsking(null);
    let reading: CardReading;
    try {
      reading = await api.readCards(text, { known });
    } catch {
      // The check couldn't run: the words go as typed, with no card attached to them.
      return text;
    }
    if (!reading.choices.length) {
      setReadAs(reading.readAs);
      return reading.text;
    }
    return new Promise<string | null>((resolve) => setAsking({ reading, text, known, picks: [], resolve }));
  }, [asking]);

  const pick = async (name: string) => {
    if (!asking) return;
    const c = asking.reading.choices[0];
    const picks = [...asking.picks, { mention: c.mention, name, kind: c.kind }];
    setBusy(true);
    try {
      const reading = await api.readCards(asking.text, { known: asking.known, picks });
      if (reading.choices.length) setAsking({ ...asking, reading, picks });
      else {
        setAsking(null);
        setReadAs(reading.readAs.filter((r) => !picks.some((p) => p.mention === r.mention)));
        asking.resolve(reading.text);
      }
    } catch {
      setNotice('Couldn’t check the card names just now. Try again in a moment.');
      setAsking(null);
      asking.resolve(null);
    } finally {
      setBusy(false);
    }
  };

  const none = () => {
    if (!asking) return;
    const c = asking.reading.choices[0];
    if (c.kind === 'maybe') { void pick(NOT_A_CARD); return; }
    setNotice(`No card matched “${c.mention}”. Check the spelling and the words, then try again.`);
    setAsking(null);
    asking.resolve(null);
  };

  const cancel = () => {
    asking?.resolve(null);
    setAsking(null);
  };

  const forget = async (mention: string) => {
    setReadAs((r) => r.filter((x) => x.mention !== mention));
    await api.forgetCardPick(mention).catch(() => {});
  };

  // Bring the question into view: it may appear far from the box that was sent.
  useEffect(() => {
    if (asking) setTimeout(() => document.getElementById('which-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  }, [asking]);

  const panel = asking ? (
    <CardChoice choice={asking.reading.choices[0]} question={asking.text} onPick={pick} onNone={none} onCancel={cancel} busy={busy} />
  ) : notice ? (
    <p role="status" className="mt-3 flex items-start gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-sm">
      <span className="flex-1">{notice}</span>
      <button onClick={() => setNotice(null)} aria-label="Close" className="text-[var(--muted)] hover:text-[var(--foreground)]">✕</button>
    </p>
  ) : readAs.length ? (
    <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
      {readAs.map((r) => (
        <span key={r.mention}>
          Read “{r.mention}” as <CardLink name={r.name} />
          {r.remembered && <> · <button onClick={() => forget(r.mention)} className="underline hover:text-[var(--foreground)]">forget</button></>}
        </span>
      ))}
    </p>
  ) : null;

  return { check, panel, asking: !!asking };
}
