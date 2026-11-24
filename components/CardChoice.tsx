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
 * misspelt name ("Did you mean…") or a word that begins several names ("Which Kratos?"). The owner's picks are
 * remembered for their profile, so the same words aren't asked again; the page says how it read them, with a way to
 * forget. "None of these" sends nothing: the owner is asked to check the spelling and try again.
 *
 * A card's name in everyday words ("lightning bolt", "last chance", "humility") is never asked: CardSuggestions,
 * above the box, offers it quietly as the owner types. A tap marks it in the box; ✕ says it isn't a card, and is
 * remembered; left alone, the words go as words.
 *
 *   <CardSuggestions text={typed} onText={setTyped} known={deckNames} />
 */

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import CardText, { CardLink } from '@/components/CardText';
import * as api from '@/lib/api';
import { markText, NOT_A_CARD, type CardPick, type CardReading, type NamedChoice, type Suggestion } from '@/lib/card-names';
import { steady } from '@/lib/steady-tap';

const button = 'min-h-10 rounded-full border border-[var(--border)] px-3 text-sm hover:bg-[var(--surface-hover)] disabled:opacity-50';

const heading = (c: NamedChoice) =>
  c.kind === 'typo' ? <>No card is named “{c.mention}”. Did you mean…</>
    : <>Which {c.mention[0].toUpperCase() + c.mention.slice(1)} did you mean?</>;

interface Props {
  choice: NamedChoice;
  /** What the owner wrote, shown under the heading. */
  question?: string;
  onPick: (name: string) => void;
  /** "None of these": nothing is sent. */
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
        {onNone && <button disabled={busy} {...steady(onNone)} className={`${button} mt-3`}>None of these</button>}
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

/**
 * Cards the owner's words may be, offered as they type (see the top of this file): a chip each, above the box. A tap
 * marks the card in the text; ✕ says those words aren't a card, remembered for the profile. Nothing blocks the send.
 */
export function CardSuggestions({ text, onText, known = [], className = '' }: {
  text: string;
  onText: (text: string) => void;
  /** Cards in play here: a name of theirs is the card already, never offered. */
  known?: string[];
  className?: string;
}) {
  // Kept with the text they were read from: once the text changes, they're stale and not shown.
  const [found, setFound] = useState<{ text: string; list: Suggestion[] }>({ text: '', list: [] });
  const [closed, setClosed] = useState<string[]>([]);
  const seq = useRef(0);
  const knownKey = known.join('\n');

  useEffect(() => {
    const mine = ++seq.current;
    // Two words before there's anything to offer; a pause in the typing before asking.
    if (text.trim().split(/\s+/).length < 2 && !/\s$/.test(text)) return;
    const timer = setTimeout(() => {
      api.readCards(text, { known: knownKey ? knownKey.split('\n') : [], typing: true })
        .then((r) => { if (seq.current === mine) setFound({ text, list: r.suggestions }); })
        .catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
  }, [text, knownKey]);

  const list = found.text === text ? found.list.filter((s) => !closed.includes(s.mention.toLowerCase())) : [];
  if (!list.length) return null;
  const close = (s: Suggestion) => {
    setClosed((c) => [...c, s.mention.toLowerCase()]);
    void api.readCards(text, { picks: [{ mention: s.mention, name: NOT_A_CARD, kind: 'suggest' }], typing: true }).catch(() => {});
  };
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`} aria-live="polite">
      {list.map((s) => (
        <span key={`${s.mention}|${s.name}`} className="inline-flex items-center rounded-full border border-[var(--accent)]/45 bg-[color-mix(in_srgb,var(--accent)_12%,var(--background))] text-[13px] shadow-sm">
          <button type="button" {...steady(() => onText(markText(text, [s])))} className="flex min-h-9 items-center gap-1.5 py-1 pl-2.5 pr-2 text-left" title={`Use the card ${s.name}`}>
            <span className="text-[var(--accent)]" aria-hidden>✦</span>
            <span>Card: <b className="font-semibold">{s.name}</b>?</span>
          </button>
          <button type="button" {...steady(() => close(s))} aria-label={`“${s.mention}” isn’t the card ${s.name}`} className="grid min-h-9 min-w-9 place-items-center border-l border-[var(--border)] pr-1 text-[var(--muted)] hover:text-[var(--foreground)]">✕</button>
        </span>
      ))}
    </div>
  );
}
