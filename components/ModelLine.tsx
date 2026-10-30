'use client';

/** The model a feature uses, with a link to change it (the header's picker, or Settings). */

import Link from 'next/link';
import { useEffect, useState } from 'react';

import * as api from '@/lib/api';
import type { Feature } from '@/lib/models';
import { shortLabel } from './ModelMenu';

export default function ModelLine({ feature }: { feature: Feature }) {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    const read = () => api.aiState().then((s) => setLabel(s.models.find((m) => m.chosenFor.includes(feature))?.label ?? null)).catch(() => {});
    read();
    window.addEventListener(api.AI_CHANGED, read);
    return () => window.removeEventListener(api.AI_CHANGED, read);
  }, [feature]);
  return (
    <p className="text-sm text-[var(--muted)]">
      Model: <span className="text-[var(--foreground)]">{label ? shortLabel(label) : '…'}</span>
      {' · '}
      <span className="text-xs">change it from the header, or in </span>
      <Link href="/settings" className="text-xs underline hover:text-[var(--foreground)]">Settings</Link>
    </p>
  );
}
