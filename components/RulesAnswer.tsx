'use client';

/**
 * One rules answer: the verdict, how sure, the steps with their citations as
 * numbered marks, and the sources - what was cited first, with the quote and
 * a link to where it comes from (the ruling on Scryfall, the rule in the
 * hyperlinked Comprehensive Rules, the wiki page), then everything else that
 * was looked at.
 */

import { useState } from 'react';

import type { Confidence, Source, Turn } from '@/lib/rules/answer';

const CONFIDENCE: Record<Confidence, { icon: string; label: string; tone: string; hint: string }> = {
  certain: { icon: '✓', label: 'Certain', tone: 'text-green-500', hint: 'An official ruling or rule says so outright.' },
  likely: { icon: '≈', label: 'Likely', tone: 'text-amber-400', hint: 'Follows from the rules cited, by clear steps.' },
  unsure: { icon: '?', label: 'Unsure', tone: 'text-red-400', hint: 'The sources do not settle it - check with a judge.' },
};

const KIND_LABEL: Record<Source['kind'], string> = {
  ruling: 'Official ruling', rule: 'Comprehensive Rules', glossary: 'Rules glossary', oracle: 'Card text', wiki: 'MTG Wiki',
};

const LINK_LABEL: Record<Source['kind'], string> = {
  ruling: 'On Scryfall', oracle: 'On Scryfall', rule: 'Read the rule', glossary: 'In the glossary', wiki: 'MTG Wiki',
};

/** "2 cards' Oracle text, 8 official rulings, 12 rules, 3 glossary entries and 1 MTG Wiki page". */
function summary(sources: Source[]): string {
  const n = (k: Source['kind']) => sources.filter((s) => s.kind === k).length;
  const parts = [
    n('oracle') && `${n('oracle')} card${n('oracle') === 1 ? '\'s' : 's\''} Oracle text`,
    n('ruling') && `${n('ruling')} official ruling${n('ruling') === 1 ? '' : 's'}`,
    n('rule') && `${n('rule')} rule${n('rule') === 1 ? '' : 's'}`,
    n('glossary') && `${n('glossary')} glossary entr${n('glossary') === 1 ? 'y' : 'ies'}`,
    n('wiki') && `${n('wiki')} MTG Wiki page${n('wiki') === 1 ? '' : 's'}`,
  ].filter(Boolean) as string[];
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0] ?? 'nothing';
}

/** "1. First. 2. Second." or lines: steps to list. */
function steps(text: string): string[] {
  const lines = text.split(/\n+|\s(?=\d+\.\s)/).map((l) => l.trim()).filter(Boolean);
  return lines.map((l) => l.replace(/^\d+\.\s*/, ''));
}

export default function RulesAnswer({ turn, index, onAsk }: { turn: Turn; index: number; onAsk: (q: string) => void }) {
  const [showAll, setShowAll] = useState(false);
  const { answer, sources } = turn;
  const byId = new Map(sources.map((s) => [s.id, s]));
  // Citations numbered in the order they first appear.
  const order: string[] = [];
  for (const m of `${answer.verdict} ${answer.explanation}`.matchAll(/\[([A-Z]\d+)\]/g)) if (!order.includes(m[1])) order.push(m[1]);
  for (const c of answer.citations) if (!order.includes(c.id)) order.push(c.id);
  const numberOf = (id: string) => order.indexOf(id) + 1;
  const anchor = (id: string) => `t${index}-${id}`;

  const withMarks = (text: string) => text.split(/(\[[A-Z]\d+\])/g).map((part, i) => {
    const m = /^\[([A-Z]\d+)\]$/.exec(part);
    if (!m || !byId.has(m[1])) return <span key={i}>{part}</span>;
    return (
      <a key={i} href={`#${anchor(m[1])}`} title={byId.get(m[1])!.label} className="mx-0.5 rounded bg-[var(--surface-hover)] px-1 align-super text-[10px] font-semibold text-[var(--accent)] no-underline">
        {numberOf(m[1])}
      </a>
    );
  });

  const conf = CONFIDENCE[answer.confidence];
  const cited = order.map((id) => byId.get(id)).filter((s): s is Source => !!s);
  const others = sources.filter((s) => !order.includes(s.id));
  const why = new Map(answer.citations.map((c) => [c.id, c.why]));

  return (
    <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className={`text-xs font-semibold ${conf.tone}`} title={conf.hint}>
        <span aria-hidden>{conf.icon}</span> {conf.label} <span className="font-normal text-[var(--muted)]">· {conf.hint}</span>
      </p>
      <p className="mt-2 text-base font-medium leading-snug">{withMarks(answer.verdict)}</p>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-[var(--foreground)]">
        {steps(answer.explanation).map((s, i) => <li key={i}>{withMarks(s)}</li>)}
      </ol>

      <section className="mt-4 border-t border-[var(--border)] pt-3">
        <h3 className="text-sm font-medium">How this was worked out</h3>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Checked {summary(sources)}{turn.rulesEdition ? `, from the Comprehensive Rules effective ${turn.rulesEdition}` : ''}.
          {cited.length > 0 ? ' The numbered sources below are what the answer rests on - open each to read it where it comes from.' : ' None of them settled it outright.'}
        </p>
      </section>
      {cited.length > 0 && (
        <section className="mt-3">
          <h3 className="text-xs uppercase tracking-wide text-[var(--muted)]">Sources cited</h3>
          <ol className="mt-2 space-y-2">
            {cited.map((s) => <SourceItem key={s.id} id={anchor(s.id)} n={numberOf(s.id)} source={s} why={why.get(s.id)} />)}
          </ol>
        </section>
      )}
      {others.length > 0 && (
        <details className="mt-3" open={showAll} onToggle={(e) => setShowAll((e.target as HTMLDetailsElement).open)}>
          <summary className="cursor-pointer text-xs text-[var(--muted)] hover:text-[var(--foreground)]">
            Also looked at ({others.length}): {[...new Set(others.map((s) => KIND_LABEL[s.kind]))].join(', ')}
          </summary>
          {showAll && (
            <ol className="mt-2 space-y-2">
              {others.map((s) => <SourceItem key={s.id} id={anchor(s.id)} source={s} />)}
            </ol>
          )}
        </details>
      )}

      {answer.followUps.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {answer.followUps.map((f) => (
            <button key={f} onClick={() => onAsk(f)} className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-left text-xs text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]">
              {f}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

function SourceItem({ id, n, source, why }: { id: string; n?: number; source: Source; why?: string }) {
  return (
    <li id={id} className="scroll-mt-24 rounded-lg bg-[var(--background)] px-3 py-2 text-sm">
      <p className="flex flex-wrap items-baseline gap-x-2">
        {n !== undefined && <span className="text-xs font-semibold text-[var(--accent)]">{n}</span>}
        <span className="font-medium">{source.label}</span>
        <span className="text-xs text-[var(--muted)]">{KIND_LABEL[source.kind]}{source.date ? ` · ${source.date}` : ''}</span>
        {source.url && (
          <a href={source.url} target="_blank" rel="noreferrer" className="ml-auto text-xs text-[var(--accent)] underline hover:brightness-110">
            {LINK_LABEL[source.kind]} ↗
          </a>
        )}
      </p>
      {why && <p className="mt-0.5 text-xs text-[var(--muted)]">{why}</p>}
      <p className="oracle mt-1 text-xs leading-relaxed text-[var(--foreground)]/90">{source.text}</p>
    </li>
  );
}
