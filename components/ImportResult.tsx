'use client';

/** What an import did: how much came in, and every line that did not. */

import type { ImportSummary } from '@/lib/import-into';

export default function ImportResult({ result, applied = true, onDropProblems }: {
  result: ImportSummary;
  applied?: boolean;
  /** When nothing was saved: save again without the lines that failed. */
  onDropProblems?: () => void;
}) {
  const problems = [...result.missing, ...result.unreadable];
  return (
    <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm">
      {applied && <p>
        Imported {result.copies} card{result.copies === 1 ? '' : 's'}
        {result.added !== result.copies && <> ({result.added} different)</>}
        {result.commander && <>, with {result.commander} as commander</>}.
        {result.outvoted && <span className="block text-amber-300">The list named {result.outvoted} as its commander; the one you picked stays, and {result.outvoted} is in the deck instead.</span>}
        {result.skipped > 0 && <span className="text-[var(--muted)]"> Left out {result.skipped} token{result.skipped === 1 ? '' : 's'}.</span>}
      </p>}
      {problems.length > 0 && (
        <div className={applied ? 'mt-2 text-amber-400' : 'text-amber-400'}>
          <p>Couldn&apos;t find {problems.length} line{problems.length === 1 ? '' : 's'}{applied ? ' - everything else came in' : ''}:</p>
          <ul className="mt-1 list-disc pl-5 font-mono text-xs">
            {problems.map((line) => <li key={line}>{line}</li>)}
          </ul>
          {onDropProblems && (
            <button onClick={onDropProblems} className="mt-2 rounded-lg border border-amber-400/40 px-3 py-1 text-xs text-amber-200 hover:bg-amber-400/10">
              Save without {problems.length === 1 ? 'this line' : `these ${problems.length} lines`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
