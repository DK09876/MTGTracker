'use client';

/**
 * "Which Omnath did you mean?" - asked when a name fits several commanders
 * equally well, rather than guessing. Picking one carries the search on.
 */

import Image from 'next/image';

import ManaCost from './ManaCost';
import type { CommanderRef } from '@/lib/interpret';

interface Props {
  mention: string;
  options: CommanderRef[];
  onPick: (name: string) => void;
}

export default function CommanderChoice({ mention, options, onPick }: Props) {
  return (
    <div className="mt-6">
      <p className="font-medium">Which {mention.replace(/^./, (c) => c.toUpperCase())} did you mean?</p>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {options.map((option) => (
          <button
            key={option.name}
            onClick={() => onPick(option.name)}
            className="flex flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] text-left hover:border-[var(--accent)]"
          >
            {option.image && (
              <Image src={option.image} alt="" width={146} height={204} className="w-full" unoptimized />
            )}
            <span className="flex items-start justify-between gap-2 p-2 text-sm">
              <span className="min-w-0 font-medium">{option.name}</span>
              <ManaCost cost={option.manaCost} size={13} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
