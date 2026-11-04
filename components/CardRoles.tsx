'use client';

/**
 * A card's roles in this deck, in its card view: the ones it fills, from
 * Scryfall's tags, and a way to correct them for this deck - add a role it
 * fills here, or take off one that does not apply. Corrections show as
 * "yours" and count everywhere the deck's roles do.
 */

import { useEffect, useState } from 'react';

import * as api from '@/lib/api';
import type { ScryfallCard } from '@/lib/scryfall';

export default function CardRoles({ listId, card }: { listId: string; card: ScryfallCard }) {
  const oracleId = card.oracle_id ?? card.id;
  const [roles, setRoles] = useState<api.CardRole[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.cardRoles(listId, oracleId).then((r) => { if (!cancelled) setRoles(r); }).catch(() => { if (!cancelled) setError('Could not read its roles'); });
    return () => { cancelled = true; };
  }, [listId, oracleId]);

  if (error) return <p className="text-xs text-red-400">{error}</p>;
  if (!roles) return <p className="text-xs text-[var(--muted)]">Reading its roles…</p>;
  const has = roles.filter((r) => r.has);

  const change = async (role: api.CardRole, next: boolean) => {
    try {
      // Back to Scryfall's word when that is what was picked.
      setRoles(await api.correctRole(listId, oracleId, role.id, next === role.scryfall ? null : next));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change it');
    }
  };

  return (
    <section className="flex flex-col gap-2" data-tour="card-roles">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">Roles in this deck</h3>
        <button onClick={() => setEditing((e) => !e)} className="text-xs text-[var(--accent)] hover:underline">{editing ? 'Done' : 'Correct'}</button>
      </div>
      {!editing ? (
        has.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {has.map((r) => (
              <li key={r.id} className="rounded-full border border-[var(--border)] px-2.5 py-0.5 text-xs">
                {r.label}{r.corrected && <span className="ml-1 text-[var(--accent)]">· yours</span>}
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-[var(--muted)]">No basic role. Correct it if it does a job here - protection, ramp, a finisher.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-[var(--muted)]">Tick what it does in this deck. Changes count on Health, Build, cuts and suggestions.</p>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3">
            {roles.map((r) => (
              <li key={r.id}>
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={r.has} onChange={(e) => change(r, e.target.checked)} />
                  <span className={r.corrected ? 'text-[var(--accent)]' : ''}>{r.label}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
