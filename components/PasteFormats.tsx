'use client';

/** "What can I paste?" - an ⓘ beside a decklist box, listing the shapes parseDecklist reads. */

import Tip from './Tip';
import { DECKLIST_EXAMPLE } from '@/lib/deck-links';

export default function PasteFormats() {
  return (
    <Tip label="What you can paste">
      <p className="font-semibold">What you can paste</p>
      <pre className="mt-1.5 rounded-lg bg-black/25 px-2 py-1.5 font-mono text-[11px] leading-snug">{DECKLIST_EXAMPLE}</pre>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
        <li>Boards by heading: Commander, Deck, Sideboard, Maybeboard (also &ldquo;SIDEBOARD:&rdquo; or &ldquo;// Sideboard&rdquo;).</li>
        <li>A printing as <code>(SET) number</code>; <code>*F*</code> for foil, <code>*E*</code> for etched. No count means one.</li>
        <li>Archidekt&apos;s <code>[Categories]</code> place cards on their board; other categories aren&apos;t kept as tags yet.</li>
        <li>MTGO&apos;s <code>SB:</code> lines, and type headings like &ldquo;Creatures (30)&rdquo;, are read too. Tokens are left out.</li>
        <li>A line that isn&apos;t a card is listed after, so you can fix it.</li>
      </ul>
    </Tip>
  );
}
