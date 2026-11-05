'use client';

/**
 * How many Game Changers the deck runs against the bracket it aims for, with
 * the cards; flagged when there are more than the bracket allows. Shown on
 * Cards and Plan when the deck has any.
 */

import Tip from './Tip';
import { gameChangerLine } from '@/lib/brackets';

interface Props {
  names: string[];
  bracket: number | null;
  /** Where to set the bracket, when it isn't shown next to this. */
  onPlan?: () => void;
}

export default function GameChangerLine({ names, bracket, onPlan }: Props) {
  if (!names.length) return null;
  const { text, over } = gameChangerLine(names.length, bracket);
  return (
    <div className={`mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-3 py-2 text-sm ${over ? 'border-[#ffb4a8]/50 bg-[#ffb4a8]/[0.05]' : 'border-[var(--border)] bg-[var(--surface)]'}`}>
      <span className="inline-flex items-center gap-0.5 rounded-md border border-[#f08bb4]/60 px-1.5 text-[10px] font-bold leading-[18px] text-[#f5a3c4]"><span aria-hidden>◆</span> GC</span>
      <span className={over ? 'font-semibold text-[#ffb4a8]' : ''}>{text}{over ? ': too many for that bracket' : ''}</span>
      <Tip label="About Game Changers">
        Game Changers are cards on Wizards&apos; list that push a deck toward the higher brackets. Brackets 1 and 2 allow none, bracket 3 up to three, and 4 and 5 any number.
      </Tip>
      <span className="min-w-0 flex-[1_1_16rem] text-xs text-[var(--muted)]">{names.join(', ')}</span>
      {onPlan && <button onClick={onPlan} className="text-xs text-[var(--accent)] hover:underline">{bracket === null ? 'Set the bracket' : 'Change the bracket'}</button>}
    </div>
  );
}
