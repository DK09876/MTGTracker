'use client';

/**
 * The second box beside a pasted deck: Mythic Tools' collection-linked
 * list, which says which box each card's copy is in. With it, the deck
 * holds those copies; without it, the deck is only its cards. Closed until
 * asked for, as most pastes come from elsewhere.
 */

import { useState } from 'react';

import Tip from './Tip';
import type { LinkReport } from '@/lib/mythic';

interface Props {
  value: string;
  onChange: (text: string) => void;
}

export default function MythicLinked({ value, onChange }: Props) {
  const [open, setOpen] = useState(!!value);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="self-start text-xs text-[var(--muted)] underline">
        From Mythic Tools? Add its collection-linked list too
      </button>
    );
  }
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="flex items-center gap-1 text-[var(--muted)]">
        Mythic Tools collection-linked list <span className="opacity-70">(optional)</span>
        <Tip label="About the collection-linked list">
          <p>Put the deck list above (Mythic Tools: Export, then the list), and here the collection-linked list.</p>
          <p className="mt-1.5">Each card listed under &ldquo;From&rdquo; a box is taken out of that box and kept with the deck, exactly that copy - foil, language and proxy included.</p>
          <p className="mt-1.5">Import your collection first, so the copies are there to take.</p>
        </Tip>
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={value.trim() ? 6 : 3}
        placeholder={'Cards to get from my collection:\n\nFrom "bulk"\n1x Sol Ring (40k) #250\n…'}
        spellCheck={false}
        className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 font-mono text-xs outline-none focus:border-[var(--accent)]"
      />
    </label>
  );
}

/** One line on what linking did: copies taken, proxies, and lines with no copy to take. */
export function LinkResult({ link }: { link: LinkReport }) {
  return (
    <div role="status" className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
      <p>
        ✓ Took {link.linked} card{link.linked === 1 ? '' : 's'} from your boxes into the deck
        {link.proxiesLinked > 0 && <> ({link.proxiesLinked} prox{link.proxiesLinked === 1 ? 'y' : 'ies'})</>}
        {link.proxiesMarked > 0 && <>, and marked {link.proxiesMarked} as prox{link.proxiesMarked === 1 ? 'y' : 'ies'}</>}.
      </p>
      {link.otherBox.length > 0 && <p className="mt-1 text-xs text-[var(--muted)]">{link.otherBox.length} found in a different box than the list said.</p>}
      {link.notLinked.length > 0 && (
        <details className="mt-1 text-amber-400">
          <summary>⚠ {link.notLinked.length} with no copy left in your collection to take</summary>
          <pre className="mt-1 whitespace-pre-wrap text-xs text-[var(--muted)]">{link.notLinked.join('\n')}</pre>
        </details>
      )}
    </div>
  );
}
