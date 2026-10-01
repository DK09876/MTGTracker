'use client';

/** The model AI features use, with a link to change it in Settings. */

import Link from 'next/link';
import { useEffect, useState } from 'react';

import * as api from '@/lib/api';

export default function ModelLine() {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => { api.modelStatuses().then((ms) => setLabel(ms.find((m) => m.chosen)?.label ?? null)).catch(() => {}); }, []);
  return (
    <p className="text-sm text-[var(--muted)]">
      Model: <span className="text-[var(--foreground)]">{label ?? '…'}</span>
      {' · '}
      <Link href="/settings" className="underline hover:text-[var(--foreground)]">Change</Link>
      <span className="text-xs"> (for every AI feature)</span>
    </p>
  );
}
