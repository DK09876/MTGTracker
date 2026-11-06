'use client';

/** A game being played: the life counter, full screen. A finished game goes to its page. */

import { useRouter } from 'next/navigation';
import { use, useEffect, useState } from 'react';

import LifeCounter from '@/components/LifeCounter';
import * as api from '@/lib/api';

export default function PlayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [game, setGame] = useState<api.Game | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.game(id).then(({ game: g }) => {
      if (g.status === 'done') router.replace(`/games/${id}`);
      else setGame(g);
    }).catch((e: Error) => setError(e.message));
  }, [id, router]);
  if (error) return <p className="text-sm text-red-300">{error}</p>;
  if (!game) return <p className="text-sm text-[var(--muted)]">Loading the game…</p>;
  return <LifeCounter game={game} />;
}
