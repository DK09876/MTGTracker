'use client';

/** What an import did: how much came in, and every line that did not. */

import type { ImportSummary } from '@/lib/import-into';

export default function ImportResult({ result, applied = true }: { result: ImportSummary; applied?: boolean }) {
  const problems = [...result.missing, ...result.unreadable];
  return (
    <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm">
      {applied && <p>
        Imported {result.copies} card{result.copies === 1 ? '' : 's'}
        {result.added !== result.copies && <> ({result.added} different)</>}
        {result.commander && <>, with {result.commander} as commander</>}.
        {result.skipped > 0 && <span className="text-[var(--muted)]"> Left out {result.skipped} from the sideboard or maybeboard.</span>}
      </p>}
      {problems.length > 0 && (
        <div className={applied ? 'mt-2 text-amber-400' : 'text-amber-400'}>
          <p>Couldn&apos;t find {problems.length} line{problems.length === 1 ? '' : 's'}:</p>
          <ul className="mt-1 list-disc pl-5 font-mono text-xs">
            {problems.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
