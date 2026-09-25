'use client';

/**
 * A card's tags in this deck, in its detail window: what it carries, why
 * the model put each one there, and a way to add or take off any of them -
 * or make a new tag on the spot.
 */

import { useState } from 'react';

import * as api from '@/lib/api';
import type { ScryfallCard } from '@/lib/scryfall';
import { tagKey, tagsByCard, type DeckTags } from '@/lib/tags';

interface Props {
  listId: string;
  card: ScryfallCard;
  tags: DeckTags;
  onChange: (tags: DeckTags) => void;
}

export default function CardTags({ listId, card, tags, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  const key = tagKey(card);
  const on = tagsByCard(tags).get(key) ?? [];
  const onIds = new Set(on.map(({ tag }) => tag.id));
  const available = tags.tags.filter((t) => t.status === 'accepted' && !onIds.has(t.id));
  const takenOff = tags.cardTags.filter((l) => l.key === key && !l.on)
    .map((l) => tags.tags.find((t) => t.id === l.tagId && t.status === 'accepted'))
    .filter((t) => !!t);

  const run = async (work: () => Promise<DeckTags>) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await work());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the tags');
    } finally {
      setBusy(false);
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    await run(async () => {
      const made = await api.createTag(listId, { name });
      setNewName('');
      return api.setCardTag(listId, key, made.created, true);
    });
  };

  return (
    <div className="mb-5 flex flex-col gap-3 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-medium">Tags in this deck</p>
        {on.some(({ link }) => link.source === 'ai') && (
          <p className="text-xs text-[var(--muted)]">✦ added by the model</p>
        )}
      </div>

      {on.length === 0 && <p className="text-[var(--muted)]">No tags yet.</p>}
      {on.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {on.map(({ tag, link }) => (
            <li key={tag.id} className="flex items-start gap-2">
              <span
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
                style={{ background: `${tag.color}26`, color: tag.color }}
                title={tag.description}
              >
                {link.source === 'ai' && <span aria-label="added by the model">✦</span>}
                {tag.name}
                <button
                  disabled={busy}
                  onClick={() => run(() => api.setCardTag(listId, key, tag.id, false))}
                  aria-label={`Take ${tag.name} off ${card.name}`}
                  className="ml-0.5 opacity-70 hover:opacity-100"
                >
                  ✕
                </button>
              </span>
              {link.reason && <span className="pt-0.5 text-xs text-[var(--muted)]">{link.reason}</span>}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {available.length > 0 && (
          <select
            aria-label="Add a tag"
            value=""
            disabled={busy}
            onChange={(e) => e.target.value && run(() => api.setCardTag(listId, key, e.target.value, true))}
            className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5"
          >
            <option value="">Add a tag…</option>
            {available.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <form onSubmit={create} className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New tag"
            aria-label="New tag name"
            maxLength={60}
            className="w-36 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 outline-none focus:border-[var(--accent)]"
          />
          <button disabled={busy || !newName.trim()} className="rounded-lg border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--surface-hover)] disabled:opacity-50">
            Add
          </button>
        </form>
      </div>
      {takenOff.length > 0 && (
        <p className="text-xs text-[var(--muted)]">
          You took off {takenOff.map((t) => t.name).join(', ')} — the model won&apos;t put {takenOff.length === 1 ? 'it' : 'them'} back.
        </p>
      )}
      {error && <p className="text-red-400">{error}</p>}
    </div>
  );
}
