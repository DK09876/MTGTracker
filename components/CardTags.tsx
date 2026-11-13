'use client';

/**
 * A card's groups in this deck, in its detail window: the same categories
 * the Tags tab shows (jobs, tags from the card data, ways to win, key cards
 * and your own groups), with who put the card there. Add the card to any of
 * them, take it out, or make a new group with it, and the Tags tab shows the
 * same: grouping works from either place.
 */

import { useEffect, useState } from 'react';

import * as api from '@/lib/api';
import type { Category } from '@/lib/categories-shared';
import type { ScryfallCard } from '@/lib/scryfall';
import { tagKey, type DeckTags } from '@/lib/tags';
import type { TagsView } from '@/lib/tags-tab-shared';

interface Props {
  listId: string;
  card: ScryfallCard;
  /** Kept for the page: after a change, the deck's tags are read again so the card view's dots and filters follow. */
  tags?: DeckTags;
  onChange?: (tags: DeckTags) => void;
}

const KIND: Record<Category['kind'], string> = { job: 'job', tag: 'from the cards', win: 'way to win', key: 'key cards', own: 'group' };
const BY: Record<string, string> = { owner: 'yours', ai: '✦ AI', cards: 'card data' };

export default function CardTags({ listId, card, onChange }: Props) {
  const [view, setView] = useState<TagsView | null>(() => api.peek<TagsView>(api.categoriesPath(listId)) ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    let stop = false;
    api.tagsTab(listId).then((v) => { if (!stop) setView(v); }).catch(() => { if (!stop) setError('Couldn’t read the groups just now'); });
    return () => { stop = true; };
  }, [listId, card.id]);

  const key = tagKey(card);
  const cats = view?.categories ?? [];
  const on = cats.map((c) => ({ c, x: c.cards.find((x) => x.key === key) })).filter((r): r is { c: Category; x: Category['cards'][number] } => !!r.x);
  // The key cards hold only what the plan names; adding there is the Plan tab's job.
  const available = cats.filter((c) => c.kind !== 'key' && !on.some((r) => r.c.id === c.id));

  const run = async (...actions: Array<Record<string, unknown> | ((v: TagsView) => Record<string, unknown> | null)>) => {
    setBusy(true);
    setError(null);
    try {
      let v = view;
      for (const a of actions) {
        const body = typeof a === 'function' ? (v ? a(v) : null) : a;
        if (body) v = await api.tagsTabAct(listId, body);
      }
      setView(v);
      if (onChange) void api.deckTags(listId).then(onChange).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the groups');
    } finally {
      setBusy(false);
    }
  };
  const put = (id: string, yes: boolean) => run({ action: 'card', id, name: card.name, on: yes });

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    await run({ action: 'add', name }, (v) => {
      const made = v.categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
      return made ? { action: 'card', id: made.id, name: card.name, on: true } : null;
    });
    setNewName('');
  };

  return (
    <div className="mb-5 flex flex-col gap-3 text-sm" data-card-groups>
      <p className="font-medium">Groups in this deck</p>
      {!view && !error && <p className="text-[var(--muted)]">Reading the groups…</p>}
      {view && on.length === 0 && <p className="text-[var(--muted)]">In no group yet.</p>}
      {on.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {on.map(({ c, x }) => (
            <li key={c.id} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-2.5 py-0.5 text-xs" title={c.how || undefined}>
              <span className="font-medium">{c.name}</span>
              <span className="text-[var(--muted)]">· {KIND[c.kind]}{x.by !== 'cards' ? ` · ${BY[x.by] ?? x.by}` : ''}</span>
              <button type="button" disabled={busy} onClick={() => put(c.id, false)} aria-label={`Take ${card.name} out of ${c.name}`} className="ml-0.5 opacity-70 hover:opacity-100">✕</button>
            </li>
          ))}
        </ul>
      )}
      {view && (
        <div className="flex flex-wrap items-center gap-2">
          {available.length > 0 && (
            <select aria-label="Add to a group" value="" disabled={busy} onChange={(e) => { if (e.target.value) void put(e.target.value, true); }}
              className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5">
              <option value="">Add to a group…</option>
              {available.map((c) => <option key={c.id} value={c.id}>{c.name} ({KIND[c.kind]})</option>)}
            </select>
          )}
          <form onSubmit={create} className="flex gap-2">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New group" aria-label="New group name" maxLength={60}
              className="w-36 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 outline-none focus:border-[var(--accent)]" />
            <button disabled={busy || !newName.trim()} className="rounded-lg border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--surface-hover)] disabled:opacity-50">Add</button>
          </form>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
