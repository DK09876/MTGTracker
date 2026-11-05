'use client';

/**
 * Someone's profile: their favourite commander's art as banner and picture,
 * their featured deck, and the decks they show others. On your own page you
 * also choose those, your theme, and whether the app moves.
 */

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';

import Avatar from '@/components/Avatar';
import CommanderPicker from '@/components/CommanderPicker';
import * as api from '@/lib/api';
import { identityStyle } from '@/lib/identity';
import { THEME_IDS, THEMES, themeVars, type ThemeId } from '@/lib/themes';

export default function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [page, setPage] = useState<api.PersonPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api.personPage(id).then(setPage).catch((e) => setError(e instanceof Error ? e.message : 'Could not load')), [id]);
  useEffect(() => { void load(); }, [load]);

  if (error) return <p className="mt-8 text-center text-red-400">{error}</p>;
  if (!page) return <p className="mt-8 text-center text-[var(--muted)]">Loading…</p>;
  const { person, commander, featured, decks, self } = page;

  return (
    <div className="flex flex-col gap-8" style={identityStyle(commander?.identity ?? null)}>
      <section data-tour="profile-banner" className="overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)]">
        {/* The favourite commander's art as a banner; without one, a slim band rather than a big grey box. */}
        <div className={`relative ${commander?.art ? 'h-44 sm:h-56' : 'h-20'}`}>
          {commander?.art
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={commander.art} alt="" className="h-full w-full object-cover" />
            : <div className="id-grad h-full w-full opacity-60" />}
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--surface)] via-transparent to-transparent" />
        </div>
        <div className="flex flex-wrap items-end gap-5 px-6 pb-6">
          <div className="-mt-14 rounded-full border-4 border-[var(--surface)] shadow-lg">
            <Avatar art={commander?.art ?? null} name={person.name} size={112} shine />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-3xl font-bold">{person.name}{person.isAdmin && <span className="ml-2 align-middle text-xs font-medium text-[var(--accent)]">admin</span>}</h1>
            <p className="text-sm text-[var(--muted)]">
              {commander ? <>Favourite commander: <span className="text-[var(--foreground)]">{commander.name}</span></> : 'No favourite commander yet'}
              {' · '}{decks.filter((d) => d.public).length} deck{decks.filter((d) => d.public).length === 1 ? '' : 's'} shown
            </p>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_32rem] flex-col gap-6">
          {featured && (
            <section className="flex flex-col gap-3">
              <h2 className="font-display text-xl font-semibold">Featured deck</h2>
              <DeckCard deck={featured} owner={person.id} big />
            </section>
          )}
          <section className="flex flex-col gap-3">
            <h2 className="font-display text-xl font-semibold">{self ? 'Your decks' : 'Decks'}</h2>
            {self && <p className="text-sm text-[var(--muted)]">Decks are private until you make one public, from the deck&apos;s ⋯ menu or here.</p>}
            {decks.length === 0 && <p className="text-sm text-[var(--muted)]">{self ? 'No decks yet.' : 'No decks shown.'}</p>}
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {decks.map((d) => (
                <li key={d.id} className="flex flex-col gap-1.5">
                  <DeckCard deck={d} owner={person.id} />
                  {self && (
                    <button
                      onClick={async () => { await api.setDeckPublic(d.id, !d.public); void load(); }}
                      className="self-start text-xs text-[var(--muted)] hover:text-[var(--foreground)] hover:underline"
                    >
                      {d.public ? 'Make private' : 'Show on my profile'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {!self && page.hidden > 0 && <p className="text-xs text-[var(--muted)]">{page.hidden} more kept private.</p>}
          </section>
        </div>
        {self && <Edit page={page} onChanged={load} />}
      </div>
    </div>
  );
}

function DeckCard({ deck, owner, big = false }: { deck: api.ShownDeck; owner: string; big?: boolean }) {
  return (
    <Link
      href={`/people/${owner}/decks/${deck.id}`}
      style={identityStyle(deck.identity)}
      className={`group relative flex overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)] ${big ? 'h-44' : 'h-28'}`}
    >
      {deck.art
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={deck.art} alt="" className={`absolute inset-0 h-full w-full object-cover opacity-50 transition group-hover:opacity-60 ${big ? 'foil-shine' : ''}`} />
        : <div className="id-grad absolute inset-0 opacity-30" />}
      <div className="absolute inset-0 bg-gradient-to-t from-[var(--surface)] via-[var(--surface)]/40 to-transparent" />
      <div className="relative mt-auto p-3">
        <p className={`font-display font-bold ${big ? 'text-2xl' : 'text-lg'}`}>{deck.name}</p>
        <p className="text-xs text-[var(--muted)]">{deck.commander ?? 'No commander'} · {deck.cards} cards{!deck.public ? ' · private' : ''}</p>
      </div>
    </Link>
  );
}

function Edit({ page, onChanged }: { page: api.PersonPage; onChanged: () => void }) {
  const [style, setStyle] = useState<api.StyleAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.profileStyle().then(setStyle).catch(() => {}); }, []);
  const change = async (c: Parameters<typeof api.setProfileStyle>[0]) => {
    setError(null);
    try {
      setStyle(await api.setProfileStyle(c));
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    }
  };
  if (!style) return null;
  const identity = style.style.commander?.identity ?? null;

  return (
    <aside data-tour="profile-edit" className="flex min-w-0 flex-[1_1_20rem] flex-col gap-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="font-display text-lg font-semibold">Edit your profile</h2>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Favourite commander <span className="font-normal text-[var(--muted)]">· your picture</span></p>
        <CommanderPicker
          value={style.style.commander ? { id: style.style.commander.id, name: style.style.commander.name, typeLine: '', image: null } : null}
          onChange={(c) => change({ commanderId: c?.id ?? null })}
        />
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Featured deck</span>
        <select
          value={style.style.featuredDeck ?? ''}
          onChange={(e) => change({ featuredDeck: e.target.value || null })}
          className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5"
        >
          <option value="">None</option>
          {page.decks.map((d) => <option key={d.id} value={d.id}>{d.name}{d.public ? '' : ' (private - shown only to you)'}</option>)}
        </select>
      </label>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">App theme</p>
        {THEME_IDS.map((t: ThemeId) => {
          const v = themeVars(t, identity);
          return (
            <button
              key={t}
              onClick={() => change({ theme: t })}
              aria-pressed={style.style.theme === t}
              className={`flex items-center gap-3 rounded-xl border px-2.5 py-2 text-left ${style.style.theme === t ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-[var(--border)] hover:bg-[var(--surface-hover)]'}`}
            >
              <span aria-hidden className="h-8 w-8 shrink-0 rounded-lg border border-black/20" style={{ background: `linear-gradient(135deg, ${v['--c1']}, ${v['--c2']} 50%, ${v['--background']} 51%, ${v['--surface']})` }} />
              <span>
                <span className="block text-sm font-medium">{THEMES[t].label}</span>
                <span className="block text-xs text-[var(--muted)]">{t === 'commander' && !identity ? 'Pick a favourite commander first' : THEMES[t].hint}</span>
              </span>
            </button>
          );
        })}
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={style.style.motion} onChange={(e) => change({ motion: e.target.checked })} className="mt-1" />
        <span>Living background and foil shine <span className="block text-xs text-[var(--muted)]">Always off if your device asks for less motion.</span></span>
      </label>
    </aside>
  );
}
