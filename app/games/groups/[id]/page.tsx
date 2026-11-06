'use client';

/**
 * A playgroup: its stats (who wins, which decks win, whether going first
 * matters), its games, and its people.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useCallback, useEffect, useState } from 'react';

import EmptyState from '@/components/EmptyState';
import { clock, SeatAvatar, shortDate, WinRate } from '@/components/GameBits';
import MoreMenu from '@/components/MoreMenu';
import * as api from '@/lib/api';
import { formatDuration } from '@/lib/game-play';
import { winRate } from '@/lib/game-stats';

type Tab = 'stats' | 'games' | 'players';
const TABS: Array<{ id: Tab; label: string }> = [{ id: 'stats', label: 'Stats' }, { id: 'games', label: 'Games' }, { id: 'players', label: 'Players' }];

export default function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('stats');
  // "?tab=games" opens that tab; read in the browser, as the address's query is not passed to this page when built.
  useEffect(() => {
    const fromLink = () => {
      const asked = new URLSearchParams(window.location.search).get('tab');
      if (TABS.some((t) => t.id === asked)) setTab(asked as Tab);
    };
    fromLink();
  }, []);
  const [players, setPlayers] = useState<number | undefined>();
  const [page, setPage] = useState<api.GroupPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);

  const load = useCallback(() => api.playgroup(id, players).then(setPage).catch((e: Error) => setError(e.message)), [id, players]);
  useEffect(() => { load(); }, [load]);

  const pick = (t: Tab) => {
    setTab(t);
    window.history.replaceState(null, '', `?tab=${t}`);
  };

  if (error && !page) return <p className="text-sm text-red-300">{error}</p>;
  if (!page) return <p className="text-sm text-[var(--muted)]">Loading…</p>;
  const { group, games, live } = page;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <Link href="/games" className="text-sm text-[var(--muted)] hover:text-[var(--foreground)]">← Games</Link>
        <div className="flex flex-wrap items-center gap-3">
          {renaming ? (
            <form className="flex gap-2" onSubmit={async (e) => {
              e.preventDefault();
              const name = new FormData(e.currentTarget).get('name') as string;
              await api.renamePlaygroup(id, name).catch((err: Error) => setError(err.message));
              setRenaming(false);
              load();
            }}>
              <input name="name" defaultValue={group.name} autoFocus maxLength={60} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 font-display text-xl font-bold" />
              <button type="submit" className="btn-go rounded-full px-4 text-sm font-semibold">Save</button>
            </form>
          ) : (
            <h1 className="min-w-0 truncate font-display text-3xl font-bold" title={group.name}>{group.name}</h1>
          )}
          <span className="flex -space-x-1.5">{group.members.slice(0, 8).map((m, i) => <SeatAvatar key={m.id} art={m.art} name={m.name} seat={i} size={28} ring />)}</span>
          <div className="ml-auto flex items-center gap-2">
            {live[0]
              ? <Link href={`/games/play/${live[0].id}`} className="btn-go rounded-full px-5 py-2 text-sm font-semibold">Back to the game</Link>
              : <Link href={`/games/new?group=${id}`} className="btn-go rounded-full px-5 py-2 text-sm font-semibold">Start a game</Link>}
            <MoreMenu
              label="Playgroup settings"
              items={[
                { label: 'Rename', onClick: () => setRenaming(true) },
                {
                  label: 'Delete playgroup…', danger: true,
                  confirm: `Delete “${group.name}” and all ${group.games} of its games? This can’t be undone.`,
                  onClick: async () => { await api.deletePlaygroup(id); router.push('/games'); },
                },
              ]}
            />
          </div>
        </div>
        {live[0] && (
          <p className="rounded-xl border border-[color-mix(in_srgb,var(--accent)_40%,var(--border))] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] px-4 py-2.5 text-sm">
            A game is still going: {live[0].seats.map((s) => s.name).join(', ')}, started {clock(live[0].startedAt)}.{' '}
            <Link href={`/games/play/${live[0].id}`} className="font-semibold text-[var(--accent)] underline">Pick it up</Link>
          </p>
        )}
      </div>

      <div role="tablist" className="flex gap-1 border-b border-[var(--border)]">
        {TABS.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} onClick={() => pick(t.id)}
            className={`relative px-3 pb-2 text-sm ${tab === t.id ? 'font-semibold text-[var(--foreground)] after:absolute after:inset-x-3 after:-bottom-px after:h-[2px] after:rounded-full after:bg-[var(--accent)]' : 'text-[var(--muted)]'}`}>
            {t.label}{t.id === 'games' && group.games ? <span className="ml-1 text-xs text-[var(--muted)]">{group.games}</span> : null}
          </button>
        ))}
      </div>

      {tab === 'stats' && <Stats page={page} players={players} setPlayers={setPlayers} />}
      {tab === 'games' && <Games games={games} groupId={id} />}
      {tab === 'players' && <Players group={group} reload={load} />}
    </div>
  );
}

function Stats({ page, players, setPlayers }: { page: api.GroupPage; players: number | undefined; setPlayers: (n: number | undefined) => void }) {
  const { stats, group } = page;
  const sizes = Object.keys(stats.podSizes).map(Number).sort((a, b) => a - b);
  if (!group.games) {
    return (
      <EmptyState title="No games yet" actions={<Link href={`/games/new?group=${group.id}`} className="btn-go rounded-full px-5 py-2 text-sm font-semibold">Start a game</Link>}>
        Play a game with the life counter and the standings, deck win rates and turn-order numbers fill in here.
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {sizes.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="mr-1 text-[var(--muted)]">Players</span>
          {[undefined, ...sizes].map((n) => (
            <button key={n ?? 'all'} type="button" aria-pressed={players === n} onClick={() => setPlayers(n)}
              className={`rounded-full border px-3 py-1 tabular-nums ${players === n ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]' : 'border-[var(--border)]'}`}>
              {n ?? 'All'} <span className="text-xs text-[var(--muted)]">{n ? stats.podSizes[n] : group.games}</span>
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Tile label="Games" value={String(stats.games)} />
        <Tile label="Avg game" value={stats.averageMs ? formatDuration(stats.averageMs) : '-'} />
        <Tile label="Avg rounds" value={stats.averageRounds ? String(stats.averageRounds) : '-'} hint={stats.averageRounds ? undefined : 'Tracked when turns are passed'} />
      </div>

      <Card title="Standings">
        <table className="w-full table-fixed text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-[var(--muted)]">
            <tr><th className="w-8 pb-2 font-medium">#</th><th className="pb-2 font-medium">Player</th><th className="w-28 pb-2 font-medium sm:w-48">Win rate</th><th className="w-16 pb-2 text-right font-medium max-sm:hidden">Games</th></tr>
          </thead>
          <tbody>
            {stats.standings.map((s, i) => (
              <tr key={s.memberId} className="border-t border-[var(--border)]">
                <td className="py-2.5 font-bold text-[var(--muted)]">{s.games ? i + 1 : ''}</td>
                <td className="py-2.5">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <SeatAvatar art={s.art} name={s.name} size={30} />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{s.name}</span>
                      {s.topDeck && <span className="block truncate text-xs text-[var(--muted)]">Plays {s.topDeck} most</span>}
                    </span>
                  </span>
                </td>
                <td className="py-2.5"><WinRate wins={s.wins} games={s.games} /></td>
                <td className="py-2.5 text-right tabular-nums text-[var(--muted)] max-sm:hidden">{s.games}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Decks" hint="Every deck played here, most played first.">
          <ul className="flex flex-col">
            {stats.decks.map((d) => (
              <li key={d.key} className="flex items-center gap-2.5 border-t border-[var(--border)] py-2.5 first:border-0 first:pt-0">
                <SeatAvatar art={d.commander?.art} name={d.name} size={34} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{d.name}</span>
                  <span className="block truncate text-xs text-[var(--muted)]">{d.player}{d.commander ? ` · ${d.commander.name.split(',')[0]}` : ''}</span>
                </span>
                <WinRate wins={d.wins} games={d.games} />
              </li>
            ))}
            {!stats.decks.length && <li className="text-sm text-[var(--muted)]">No decks were named in these games.</li>}
          </ul>
        </Card>

        <div className="flex flex-col gap-4">
          {stats.turnOrder && (
            <Card title="Does going first matter?" hint={`Win rate by turn order, across ${stats.turnOrder.games} games with ${stats.turnOrder.players} players.`}>
              <div className="flex h-40 items-end gap-3 pt-5">
                {stats.turnOrder.wins.map((w, i) => {
                  const rate = winRate(w, stats.turnOrder!.games);
                  return (
                    <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5" title={`${w} of ${stats.turnOrder!.games} games won going ${ordinal(i + 1)}`}>
                      <span className="text-xs font-bold tabular-nums">{rate}%</span>
                      <span className="w-full max-w-14 rounded-t-[4px] bg-[var(--accent)]" style={{ height: `${Math.max(2, rate)}%` }} />
                      <span className="text-xs text-[var(--muted)]">{ordinal(i + 1)}</span>
                    </div>
                  );
                })}
              </div>
              {(() => {
                const firsts = stats.standings.filter((s) => s.firstGames >= 3);
                if (!firsts.length) return null;
                return (
                  <ul className="mt-4 flex flex-col gap-1.5 border-t border-[var(--border)] pt-3 text-sm">
                    {firsts.map((s) => {
                      const going = winRate(s.firstWins, s.firstGames);
                      const other = winRate(s.wins - s.firstWins, s.games - s.firstGames);
                      return (
                        <li key={s.memberId} className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate">{s.name} <span className="text-xs text-[var(--muted)]">went first {s.firstGames}×</span></span>
                          <span className="tabular-nums">{going}% <span className="text-[var(--muted)]">vs</span> {other}%</span>
                          <span className={`w-14 text-right text-xs font-bold tabular-nums ${going >= other ? 'text-emerald-300' : 'text-red-300'}`}>{going >= other ? '+' : ''}{going - other} pts</span>
                        </li>
                      );
                    })}
                  </ul>
                );
              })()}
            </Card>
          )}
          {stats.highlights.length > 0 && (
            <Card title="Highlights">
              <ul className="grid gap-3 sm:grid-cols-2">
                {stats.highlights.map((h) => (
                  <li key={h.label} className="rounded-xl bg-white/[0.03] p-3">
                    <p className="text-xs uppercase tracking-wider text-[var(--muted)]">{h.label}</p>
                    <p className="font-display text-lg font-bold">{h.value}</p>
                    <p className="text-xs text-[var(--muted)]">{h.detail}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Games({ games, groupId }: { games: api.GameSummary[]; groupId: string }) {
  if (!games.length) {
    return (
      <EmptyState title="No games yet" actions={<Link href={`/games/new?group=${groupId}`} className="btn-go rounded-full px-5 py-2 text-sm font-semibold">Start a game</Link>}>
        Finished games show up here, newest first.
      </EmptyState>
    );
  }
  // Grouped by the day they were played.
  const days: Array<{ day: string; games: api.GameSummary[] }> = [];
  for (const g of games) {
    const day = shortDate(g.startedAt);
    if (days[days.length - 1]?.day === day) days[days.length - 1].games.push(g);
    else days.push({ day, games: [g] });
  }
  return (
    <div className="flex flex-col gap-5">
      {days.map((d) => (
        <section key={d.day} className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-[var(--muted)]">{d.day}</h2>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {d.games.map((g) => {
              const winner = g.seats.find((s) => s.won);
              return (
                <li key={g.id}>
                  <Link href={`/games/${g.id}`} className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 hover:border-[var(--accent)]">
                    <SeatAvatar art={winner?.commander?.art} name={winner?.name ?? '='} seat={winner?.seat} size={44} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{winner ? `${winner.name} won` : 'A draw'}</span>
                      <span className="block truncate text-xs text-[var(--muted)]">{winner?.deckName || 'No deck named'}</span>
                      <span className="mt-1 flex items-center gap-1.5">
                        <span className="flex -space-x-1.5">{g.seats.map((s) => <SeatAvatar key={s.seat} art={s.commander?.art} name={s.name} seat={s.seat} size={20} ring />)}</span>
                        <span className="text-xs text-[var(--muted)]">{g.seats.length}p</span>
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-xs text-[var(--muted)] tabular-nums">
                      {clock(g.startedAt)}
                      {g.endedAt && <span className="block">{formatDuration(Date.parse(g.endedAt) - Date.parse(g.startedAt))}</span>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Players({ group, reload }: { group: api.GroupSummary; reload: () => void }) {
  const [everyone, setEveryone] = useState<api.PersonCard[]>([]);
  const [guest, setGuest] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.peopleList().then((r) => setEveryone(r.people)).catch(() => {}); }, []);
  const inGroup = new Set(group.members.map((m) => m.profileId).filter(Boolean));
  const others = everyone.filter((p) => !inGroup.has(p.id));
  const add = async (who: { profileId: string } | { name: string }) => {
    setError(null);
    try { await api.addPlaygroupMember(group.id, who); setGuest(''); reload(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not add them'); }
  };
  return (
    <div className="flex flex-col gap-5">
      <ul className="grid gap-2 sm:grid-cols-2">
        {group.members.map((m, i) => (
          <li key={m.id} className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
            <SeatAvatar art={m.art} name={m.name} seat={i} size={36} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{m.name}</span>
              <span className="block text-xs text-[var(--muted)]">{m.profileId ? (m.profileId === group.createdBy ? 'Started this group' : 'On the app') : 'Guest'}</span>
            </span>
            <MoreMenu
              label={`More for ${m.name}`}
              items={[
                { label: 'Take out of the group…', danger: true, confirm: `Take ${m.name} out of ${group.name}? Their games stay in the stats.`, onClick: async () => { await api.removePlaygroupMember(group.id, m.id); reload(); } },
              ]}
            />
          </li>
        ))}
      </ul>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">Add someone</h2>
        {others.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {others.map((p) => (
              <button key={p.id} type="button" onClick={() => add({ profileId: p.id })} className="flex items-center gap-2 rounded-full border border-[var(--border)] py-1 pl-1 pr-3 text-sm hover:border-[var(--accent)]">
                <SeatAvatar art={p.art} name={p.name} size={26} /> ＋ {p.name}
              </button>
            ))}
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); if (guest.trim()) add({ name: guest }); }} className="flex max-w-md gap-2">
          <input value={guest} onChange={(e) => setGuest(e.target.value)} placeholder="A guest’s name - not on the app" maxLength={40}
            className="min-w-0 flex-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm outline-none focus:border-[var(--accent)]" />
          <button type="submit" disabled={!guest.trim()} className="rounded-full border border-[var(--border)] px-4 py-2 text-sm disabled:opacity-40">Add guest</button>
        </form>
        <p className="text-xs text-[var(--muted)]">Everyone in the group sees its games and can start one. When you start a game, each player picks from their own decks - only the deck’s name and commander are shown.</p>
        {error && <p className="text-sm text-red-300">{error}</p>}
      </section>
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 sm:p-4">
      <p className="truncate text-[11px] uppercase tracking-wider text-[var(--muted)] sm:text-xs">{label}</p>
      <p className="font-display text-xl font-bold tabular-nums sm:text-2xl">{value}</p>
      {hint && <p className="text-xs text-[var(--muted)]">{hint}</p>}
    </div>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-[var(--muted)]">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function ordinal(n: number) {
  return `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
}
