'use client';

/**
 * One rules answer: the verdict and how sure, a few plain sentences why,
 * what it assumed, and - collapsed - the working it did to get there, step
 * by step (the question, the objects, their abilities, the rule for each
 * concept, the game event by event, the count checked twice). Then the
 * sources: what was cited first, with the quote and a link to where it comes
 * from, then everything else that was looked at. Citations are numbered marks.
 */

import { useState } from 'react';

import type { Confidence, Source, Turn, Working } from '@/lib/rules/answer';
import { modelInfo } from '@/lib/models';

const CONFIDENCE: Record<Confidence, { icon: string; label: string; tone: string; hint: string }> = {
  certain: { icon: '✓', label: 'Certain', tone: 'text-green-500', hint: 'An official ruling or rule says so outright.' },
  likely: { icon: '≈', label: 'Likely', tone: 'text-amber-400', hint: 'Follows from the rules cited, by clear steps.' },
  unsure: { icon: '?', label: 'Unsure', tone: 'text-red-400', hint: 'The sources do not settle it - check with a judge.' },
};

const KIND_LABEL: Record<Source['kind'], string> = {
  ruling: 'Official ruling', rule: 'Comprehensive Rules', glossary: 'Rules glossary', oracle: 'Card text', wiki: 'MTG Wiki',
};

const modelName = (id: string) => modelInfo(id)?.label ?? id.replace(/^gemini-/, 'Gemini ').replace(/-flash/, ' Flash').replace(/-lite/, '-Lite');

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
  // Citations numbered by importance: the answer ranks them, key sources first.
  const order: string[] = answer.citations.map((c) => c.id);
  for (const m of JSON.stringify(answer).matchAll(/\[([A-Z]\d+)\]/g)) if (!order.includes(m[1])) order.push(m[1]);
  const key = new Set(answer.citations.filter((c) => c.role === 'key').map((c) => c.id));
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
      {answer.looseEnds?.map((l, i) => (
        <p key={i} className="mt-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-[var(--foreground)]">
          <span aria-hidden className="text-amber-400">⚠</span> This answer may have missed something - {l}
        </p>
      ))}
      {turn.check && (
        <p className="mt-1 text-xs text-[var(--muted)]">
          {'failed' in turn.check
            ? <><span aria-hidden className="text-amber-400">⚠</span> Second check did not run: {turn.check.failed}</>
            : /^no changes/i.test(turn.check.changes)
              ? <><span aria-hidden className="text-green-500">✓</span> Second check: no changes</>
              : <><span aria-hidden className="text-[var(--accent)]">↻</span> Second check corrected it: {turn.check.changes}</>}
        </p>
      )}
      {answer.summary && <p className="mt-2 text-sm leading-relaxed">{withMarks(answer.summary)}</p>}
      {!answer.summary && answer.explanation && (
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-[var(--foreground)]">
          {steps(answer.explanation).map((s, i) => <li key={i}>{withMarks(s)}</li>)}
        </ol>
      )}
      {answer.assumptions && answer.assumptions.length > 0 && (
        <div className="mt-3 rounded-lg bg-[var(--background)] px-3 py-2 text-xs">
          <p className="font-medium">Assumed</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[var(--muted)]">
            {answer.assumptions.map((x, i) => <li key={i}>{x}</li>)}
          </ul>
          <p className="mt-1 text-[var(--muted)]">If any of that is wrong, say so in a follow-up.</p>
        </div>
      )}
      {turn.clarifications && turn.clarifications.length > 0 && (
        <p className="mt-2 text-xs text-[var(--muted)]">
          You said: {turn.clarifications.map((c) => `${c.question} ${c.answer}`).join(' · ')}
        </p>
      )}

      {answer.working && (
        <details className="mt-3 rounded-lg border border-[var(--border)] px-3 py-2">
          <summary className="cursor-pointer text-sm text-[var(--muted)] hover:text-[var(--foreground)]">Show the working</summary>
          <WorkingSteps working={answer.working} marks={withMarks} />
        </details>
      )}
      {!answer.working && answer.worksheet && answer.worksheet.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-[var(--muted)] hover:text-[var(--foreground)]">Trigger worksheet - every event, and every object checked</summary>
          <ol className="mt-2 space-y-2 text-xs">
            {answer.worksheet.map((e, i) => (
              <li key={i} className="rounded-lg bg-[var(--background)] px-3 py-2">
                <p className="font-medium">{i + 1}. {e.event}</p>
                <Triggers checks={e.checks} marks={withMarks} />
              </li>
            ))}
          </ol>
        </details>
      )}

      <p className="mt-3 text-xs text-[var(--muted)]">
        Checked {summary(sources)}{turn.rulesEdition ? `, from the Comprehensive Rules effective ${turn.rulesEdition}` : ''}. Answered by {modelName(turn.model)}.
      </p>
      {cited.length > 0 && (
        <section className="mt-3">
          <h3 className="text-xs uppercase tracking-wide text-[var(--muted)]">Sources cited, most important first</h3>
          <ol className="mt-2 space-y-2">
            {cited.map((s) => <SourceItem key={s.id} id={anchor(s.id)} n={numberOf(s.id)} source={s} why={why.get(s.id)} isKey={key.has(s.id)} />)}
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

type Marks = (text: string) => React.ReactNode;

function Triggers({ checks, marks }: { checks: Working['events'][number]['triggers']; marks: Marks }) {
  if (!checks.length) return null;
  return (
    <ul className="mt-1 space-y-0.5">
      {checks.map((c, j) => (
        <li key={j} className="flex gap-2">
          <span aria-hidden className={c.triggers ? 'text-green-500' : 'text-[var(--muted)]'}>{c.triggers ? '✓' : '–'}</span>
          <span>
            <span className="text-[var(--foreground)]">{c.object}</span>
            <span className="text-[var(--muted)]"> · {c.ability}{c.triggers ? ` · ${c.times}×` : ' · does not trigger'} - {marks(c.why)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The steps the answer was worked out in, laid out as the method has them. */
function WorkingSteps({ working: w, marks }: { working: Working; marks: Marks }) {
  const step = (n: number, title: string, body: React.ReactNode) => (
    <li className="rounded-lg bg-[var(--background)] px-3 py-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Step {n} · {title}</p>
      <div className="mt-1 space-y-1">{body}</div>
    </li>
  );
  return (
    <ol className="mt-2 space-y-2 text-xs leading-relaxed">
      {(w.asked || w.setup) && step(1, 'The question', <>
        {w.asked && <p><span className="text-[var(--muted)]">Asked:</span> {marks(w.asked)}</p>}
        {w.setup && <p><span className="text-[var(--muted)]">Setup:</span> {marks(w.setup)}</p>}
      </>)}
      {w.objects.length > 0 && step(2, 'Every object', (
        <ul className="space-y-1">
          {w.objects.map((o, i) => (
            <li key={i}><span className="font-medium">{o.name}</span>{o.what && <span className="text-[var(--muted)]"> - {o.what}</span>}{o.abilities && <span className="block text-[var(--muted)]">{marks(o.abilities)}</span>}</li>
          ))}
        </ul>
      ))}
      {w.abilities.length > 0 && step(3, 'Each ability taken apart', (
        <ul className="space-y-1">
          {w.abilities.map((a, i) => <li key={i}><span className="font-medium">{a.object}</span> · {a.ability}<span className="block text-[var(--muted)]">{marks(a.breakdown)}</span></li>)}
        </ul>
      ))}
      {w.concepts.length > 0 && step(4, 'The rule for each concept', (
        <ul className="space-y-1">
          {w.concepts.map((c, i) => (
            <li key={i}>
              <span className="font-medium">{c.concept}</span>{' '}
              {c.source ? marks(`[${c.source}]`) : <span className="text-amber-400">no source found</span>}
              {c.says && <span className="text-[var(--muted)]"> - {marks(c.says)}</span>}
            </li>
          ))}
        </ul>
      ))}
      {w.start && step(5, 'Starting board', <p>{marks(w.start)}</p>)}
      {w.events.length > 0 && step(6, 'The game, one event at a time', (
        <ol className="space-y-2">
          {w.events.map((e, i) => (
            <li key={i} className="border-l-2 border-[var(--border)] pl-2">
              <p className="font-medium">{i + 1}. {marks(e.what)}</p>
              {e.board && <p><span className="text-[var(--muted)]">Board:</span> {marks(e.board)}</p>}
              {e.checks && <p><span className="text-[var(--muted)]">Automatic checks:</span> {marks(e.checks)}</p>}
              <Triggers checks={e.triggers} marks={marks} />
              {e.notes && <p className="text-[var(--muted)]">Note: {marks(e.notes)}</p>}
            </li>
          ))}
        </ol>
      ))}
      {w.count && step(7, 'Checked a second way', <p>{marks(w.count)}</p>)}
    </ol>
  );
}

function SourceItem({ id, n, source, why, isKey }: { id: string; n?: number; source: Source; why?: string; isKey?: boolean }) {
  return (
    <li id={id} className={`scroll-mt-24 rounded-lg bg-[var(--background)] px-3 py-2 text-sm ${isKey ? 'ring-1 ring-[var(--accent)]/60' : ''}`}>
      <p className="flex flex-wrap items-baseline gap-x-2">
        {n !== undefined && <span className="text-xs font-semibold text-[var(--accent)]">{n}</span>}
        {isKey && <span className="rounded bg-[var(--accent)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#221c08]">Key</span>}
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
