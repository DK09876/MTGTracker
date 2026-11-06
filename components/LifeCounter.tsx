'use client';

/**
 * The life counter: one phone flat in the middle of the table, a panel per
 * player turned to face them. Tap the left half to lose life, the right to
 * gain; hold for ten. Commander damage, poison and going out are behind
 * each panel's ⚔. The player whose turn it is ends it from their panel.
 *
 * Everything is an event (lib/game-play.ts). The events are saved as they
 * happen, so a reload, a locked phone or a second device picks the game up
 * where it was.
 */

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import * as api from '@/lib/api';
import {
  addChange, deathReason, formatDuration, LETHAL_COMMANDER, LETHAL_POISON, MERGE_MS, playState, SEAT_COLOURS, seatLabels,
  type GameEvent, type PlayState,
} from '@/lib/game-play';

type Spot = { row: string; col: string; rot: 0 | 90 | 180 | -90 };

// Where each seat sits, clockwise round the table from the top-left; the
// sides face their players, a lone seat at the top faces across.
const LAYOUTS: Record<number, { rows: string; spots: Spot[] }> = {
  2: { rows: '1fr 1fr', spots: [{ row: '1', col: '1 / -1', rot: 180 }, { row: '2', col: '1 / -1', rot: 0 }] },
  3: { rows: '1fr 1.5fr', spots: [{ row: '1', col: '1 / -1', rot: 180 }, { row: '2', col: '2', rot: -90 }, { row: '2', col: '1', rot: 90 }] },
  4: { rows: '1fr 1fr', spots: [{ row: '1', col: '1', rot: 90 }, { row: '1', col: '2', rot: -90 }, { row: '2', col: '2', rot: -90 }, { row: '2', col: '1', rot: 90 }] },
  5: { rows: '0.8fr 1fr 1fr', spots: [{ row: '1', col: '1 / -1', rot: 180 }, { row: '2', col: '2', rot: -90 }, { row: '3', col: '2', rot: -90 }, { row: '3', col: '1', rot: 90 }, { row: '2', col: '1', rot: 90 }] },
  6: { rows: '1fr 1fr 1fr', spots: [{ row: '1', col: '1', rot: 90 }, { row: '1', col: '2', rot: -90 }, { row: '2', col: '2', rot: -90 }, { row: '3', col: '2', rot: -90 }, { row: '3', col: '1', rot: 90 }, { row: '2', col: '1', rot: 90 }] },
};

const backupKey = (id: string) => `mtg-game-${id}`;

export default function LifeCounter({ game: raw }: { game: api.Game }) {
  const router = useRouter();
  // Seats named so two of one player's are told apart everywhere: "DK · Azula".
  const game = useMemo(() => {
    const labels = seatLabels(raw.seats);
    return { ...raw, seats: raw.seats.map((s, i) => ({ ...s, name: labels[i] })) };
  }, [raw]);
  const n = game.seats.length;
  const [events, setEvents] = useState<GameEvent[]>(() => {
    // A copy kept on this phone wins if it has more than the server saw (it was offline).
    try {
      const kept = JSON.parse(localStorage.getItem(backupKey(game.id)) ?? 'null') as GameEvent[] | null;
      if (kept && kept.length > game.events.length) return kept;
    } catch { /* private mode: the server's copy is enough */ }
    return game.events;
  });
  const base = useRef(game.events.length);
  const [saving, setSaving] = useState<'saved' | 'saving' | 'offline'>('saved');
  const state = useMemo(() => playState(n, game.startingLife, game.firstSeat, events), [n, game.startingLife, game.firstSeat, events]);
  const [menu, setMenu] = useState(false);
  const [ending, setEnding] = useState(false);
  const [damageFor, setDamageFor] = useState<number | null>(null);
  const [splash, setSplash] = useState(game.events.length === 0);
  // A death the table said "not yet" to, until that seat's numbers change again.
  const [notYet, setNotYet] = useState<Record<number, string>>({});
  // The clock the screen reads: the "-3" beside a total fades by it, and the menu shows the time played.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  const [problem, alertLine] = useState<string | null>(null);

  // Keep the screen on while the game is up.
  useEffect(() => {
    let lock: { release(): Promise<void> } | null = null;
    const ask = () => (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } })
      .wakeLock?.request('screen').then((l) => { lock = l; }).catch(() => {});
    ask();
    const again = () => { if (document.visibilityState === 'visible') ask(); };
    document.addEventListener('visibilitychange', again);
    return () => { document.removeEventListener('visibilitychange', again); lock?.release().catch(() => {}); };
  }, []);

  // Save shortly after each change; keep a copy on the phone in case the network drops.
  useEffect(() => {
    try { localStorage.setItem(backupKey(game.id), JSON.stringify(events)); } catch { /* not kept locally */ }
    if (events.length === base.current && events === game.events) return;
    setSaving('saving');
    const timer = setTimeout(() => {
      api.saveGame(game.id, events, base.current).then((r) => {
        if ('conflict' in r) { base.current = r.conflict.length; setEvents(r.conflict); }
        else base.current = r.saved;
        setSaving('saved');
      }).catch(() => setSaving('offline'));
    }, 600);
    return () => clearTimeout(timer);
  }, [events, game.id, game.events]);

  const change = useCallback((e: GameEvent) => { setNow(e.t); setEvents((all) => addChange(all, e)); }, []);
  const undo = () => setEvents((all) => all.slice(0, -1));
  const bringBack = (s: number) => setEvents((all) => all.filter((e) => !(e.k === 'out' && e.s === s)));
  const knockOut = (s: number) => setEvents((all) => [...all, { k: 'out', s, t: Date.now() }]);

  const finish = async (winner: number | null) => {
    try {
      await api.finishGame(game.id, winner, events);
      try { localStorage.removeItem(backupKey(game.id)); } catch { /* fine */ }
      router.replace(`/games/${game.id}`);
    } catch (err) {
      alertLine(err instanceof Error ? err.message : 'Could not finish the game');
    }
  };

  const layout = LAYOUTS[n] ?? LAYOUTS[4];
  const alive = state.alive;
  const winnerReady = alive.length === 1 && n > 1;
  const started = events.length ? events[0].t : Date.parse(game.startedAt);

  return (
    <div className="fixed inset-0 z-[70] flex touch-manipulation select-none flex-col overscroll-none bg-black pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-white [-webkit-tap-highlight-color:transparent]">
      <div className="relative grid flex-1 grid-cols-2 gap-1.5 p-1.5" style={{ gridTemplateRows: layout.rows }}>
        {game.seats.map((seat, i) => (
          <Panel
            key={seat.seat}
            spot={layout.spots[i]}
            seat={seat}
            pilot={raw.seats[i].name}
            i={i}
            state={state}
            game={game}
            events={events}
            now={now}
            onChange={change}
            onDamage={() => setDamageFor(i)}
            onEndTurn={() => setEvents((all) => [...all, { k: 'turn', t: Date.now() }])}
            onOut={() => knockOut(i)}
            onBack={() => bringBack(i)}
            death={(() => { const r = deathReason(state.seats[i]); return r && notYet[i] !== r ? r : null; })()}
            onNotYet={(r) => setNotYet((x) => ({ ...x, [i]: r }))}
            damageOpen={damageFor === i}
            onCloseDamage={() => setDamageFor(null)}
          />
        ))}
        {/* The table's menu, where the panels meet. */}
        <button
          type="button"
          onClick={() => setMenu(true)}
          aria-label="Game menu"
          className="absolute left-1/2 top-1/2 z-10 grid h-14 w-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-4 border-black bg-[var(--surface)] text-[11px] font-bold leading-tight shadow-lg"
        >
          <span className="text-[var(--accent)]">R{state.round}</span>
          <span aria-hidden className="text-base leading-none">☰</span>
        </button>
      </div>

      {splash && (
        <Overlay onClose={() => setSplash(false)}>
          <p className="text-sm uppercase tracking-widest text-[var(--muted)]">Going first</p>
          <p className="font-display text-4xl font-extrabold" style={{ color: SEAT_COLOURS[game.firstSeat] }}>{game.seats[game.firstSeat].name}</p>
          <p className="text-sm text-[var(--muted)]">Tap the left of your panel to lose life, the right to gain. Hold for 10. ⚔ is commander damage and poison.</p>
          <button type="button" onClick={() => setSplash(false)} className="btn-go mt-2 rounded-full px-6 py-2.5 font-semibold">Start</button>
        </Overlay>
      )}

      {winnerReady && !ending && (
        <Overlay>
          <p className="text-sm uppercase tracking-widest text-[var(--muted)]">Last one standing</p>
          <p className="font-display text-4xl font-extrabold" style={{ color: SEAT_COLOURS[alive[0]] }}>{game.seats[alive[0]].name} wins</p>
          <p className="text-sm text-[var(--muted)]">{formatDuration(now - started)} · round {state.round}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={undo} className="rounded-full border border-[var(--border)] px-5 py-2.5">Undo</button>
            <button type="button" onClick={() => finish(alive[0])} className="btn-go rounded-full px-6 py-2.5 font-semibold">Save the game</button>
          </div>
          {problem && <p className="text-sm text-red-300">{problem}</p>}
        </Overlay>
      )}

      {menu && (
        <Overlay onClose={() => setMenu(false)}>
          <p className="font-display text-2xl font-bold">Round {state.round} · {formatDuration(now - started)}</p>
          <p className="text-sm text-[var(--muted)]">{game.seats[state.active].name}’s turn · {saving === 'saved' ? 'Saved' : saving === 'saving' ? 'Saving…' : 'Not saved - no connection. Kept on this phone.'}</p>
          <div className="mt-2 grid w-full max-w-xs gap-2">
            <button type="button" disabled={!events.length} onClick={undo} className="rounded-xl border border-[var(--border)] px-4 py-3 text-left disabled:opacity-40">
              Undo <span className="text-[var(--muted)]">{describe(events[events.length - 1], game)}</span>
            </button>
            <button type="button" onClick={() => { setMenu(false); setEnding(true); }} className="rounded-xl border border-[var(--border)] px-4 py-3 text-left">End the game…</button>
            <button type="button" onClick={() => router.push(`/games/groups/${game.groupId}`)} className="rounded-xl border border-[var(--border)] px-4 py-3 text-left">
              Leave for now <span className="text-[var(--muted)]">- the game waits</span>
            </button>
            <button type="button" onClick={() => setMenu(false)} className="btn-go rounded-xl px-4 py-3 font-semibold">Back to the game</button>
          </div>
        </Overlay>
      )}

      {ending && (
        <Overlay onClose={() => setEnding(false)}>
          <p className="font-display text-2xl font-bold">Who won?</p>
          <div className="mt-1 grid w-full max-w-xs gap-2">
            {game.seats.map((s, i) => (
              <button key={s.seat} type="button" onClick={() => finish(i)} className="flex items-center gap-3 rounded-xl border border-[var(--border)] px-4 py-3 text-left">
                <span aria-hidden className="h-3 w-3 rounded-full" style={{ background: SEAT_COLOURS[i] }} />
                <span className="flex-1">{s.name}</span>
                {state.seats[i].out && <span className="text-xs text-[var(--muted)]">out</span>}
              </button>
            ))}
            <button type="button" onClick={() => finish(null)} className="rounded-xl border border-[var(--border)] px-4 py-3 text-left">Nobody - a draw</button>
            <button type="button" onClick={() => setEnding(false)} className="rounded-xl px-4 py-3 text-[var(--muted)]">Keep playing</button>
          </div>
          {problem && <p className="text-sm text-red-300">{problem}</p>}
        </Overlay>
      )}
    </div>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-black/80 p-6 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="flex w-full max-w-sm flex-col items-center gap-2 rounded-3xl border border-[var(--border)] bg-[var(--background)] p-6 text-center">{children}</div>
    </div>
  );
}

/** What undo would take back, in a few words. */
function describe(e: GameEvent | undefined, game: api.Game): string {
  if (!e) return '';
  const who = 's' in e ? game.seats[e.s]?.name : '';
  const sign = (d: number) => (d > 0 ? `+${d}` : `${d}`);
  if (e.k === 'life') return `${who} ${sign(e.d)}`;
  if (e.k === 'cmd') return `${who} ${sign(e.d)} from ${game.seats[e.from]?.name}`;
  if (e.k === 'poison') return `${who} ${sign(e.d)} poison`;
  if (e.k === 'out') return `${who} out`;
  return 'turn passed';
}

function Panel({ spot, seat, pilot, i, state, game, events, now, onChange, onDamage, onEndTurn, onOut, onBack, death, onNotYet, damageOpen, onCloseDamage }: {
  spot: Spot; seat: api.Seat; pilot: string; i: number; state: PlayState; game: api.Game; events: GameEvent[]; now: number;
  onChange: (e: GameEvent) => void; onDamage: () => void; onEndTurn: () => void; onOut: () => void; onBack: () => void;
  death: string | null; onNotYet: (reason: string) => void; damageOpen: boolean; onCloseDamage: () => void;
}) {
  const me = state.seats[i];
  const colour = SEAT_COLOURS[i];
  const turned = spot.rot === 90 || spot.rot === -90;
  const active = state.active === i && !me.out;
  const last = events[events.length - 1];
  const delta = last && last.k === 'life' && last.s === i && now - last.t < MERGE_MS ? last.d : null;
  const cmdTaken = Object.entries(me.cmd).filter(([, d]) => d > 0);
  const art = seat.commander?.art;

  const inner: CSSProperties = {
    width: turned ? '100cqh' : '100cqw',
    height: turned ? '100cqw' : '100cqh',
    transform: `translate(-50%, -50%) rotate(${spot.rot}deg)`,
  };

  return (
    <section
      aria-label={`${seat.name}: ${me.life} life`}
      className="relative overflow-hidden rounded-2xl [container-type:size]"
      style={{ gridRow: spot.row, gridColumn: spot.col, boxShadow: active ? `inset 0 0 0 3px ${colour}` : undefined }}
    >
      <div className="absolute left-1/2 top-1/2 [container-type:size]" style={inner}>
        {/* The commander's art, dimmed, or the seat's colour. */}
        <div aria-hidden className="absolute inset-0" style={{ background: `linear-gradient(160deg, color-mix(in srgb, ${colour} 55%, #000), #0b0b0b)` }} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {art && <img src={art} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover opacity-45" />}
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/40" />

        {/* Tap halves: left loses, right gains. */}
        {!me.out && (
          <div className="absolute inset-0 grid grid-cols-2">
            <Tapper label={`${seat.name} loses life`} onStep={(d) => onChange({ k: 'life', s: i, d: -d, t: Date.now() })} side="−" />
            <Tapper label={`${seat.name} gains life`} onStep={(d) => onChange({ k: 'life', s: i, d, t: Date.now() })} side="+" />
          </div>
        )}

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className={`font-display font-extrabold tabular-nums leading-none ${me.out ? 'opacity-30' : ''}`} style={{ fontSize: 'min(46cqh, 34cqw)' }}>{me.life}</span>
          {delta !== null && (
            <span className="absolute font-bold tabular-nums" style={{ fontSize: 'min(12cqh, 9cqw)', top: '14%', color: delta < 0 ? '#ff8a80' : '#9be7a8' }}>
              {delta > 0 ? `+${delta}` : delta}
            </span>
          )}
        </div>

        {/* Top strip: what has been taken so far, and the ⚔ button. */}
        <div className="pointer-events-none absolute inset-x-2 top-2 flex items-start gap-1.5">
          <div className="flex min-w-0 flex-1 flex-wrap gap-1">
            {me.poison > 0 && <Chip tone={me.poison >= LETHAL_POISON ? 'bad' : undefined}>☠ {me.poison}</Chip>}
            {cmdTaken.map(([from, d]) => (
              <Chip key={from} tone={d >= LETHAL_COMMANDER ? 'bad' : undefined}>
                <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: SEAT_COLOURS[Number(from)] }} /> {d}
                <span className="sr-only"> commander damage from {game.seats[Number(from)].name}</span>
              </Chip>
            ))}
          </div>
          {!me.out && (
            <button type="button" onClick={onDamage} aria-label={`Commander damage and poison for ${seat.name}`} className="pointer-events-auto relative z-[1] rounded-full bg-black/55 px-2.5 py-1.5 text-sm backdrop-blur">⚔</button>
          )}
        </div>

        {/* Bottom: who, what they are playing, and their turn. */}
        <div className="pointer-events-none absolute inset-x-2 bottom-2 flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold"><span aria-hidden className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: colour }} />{pilot}</p>
            {seat.deckName && <p className="truncate text-[11px] text-white/70">{seat.deckName}{seat.deckOwner ? ` · ${seat.deckOwner.name}’s` : ''}</p>}
          </div>
          {active && (
            <button type="button" onClick={onEndTurn} className="pointer-events-auto relative z-[1] shrink-0 rounded-full px-3 py-1.5 text-xs font-bold text-black" style={{ background: colour }}>
              End turn ▸
            </button>
          )}
        </div>

        {me.out && (
          <div className="absolute inset-0 grid place-items-center bg-black/60">
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="font-display text-xl font-bold">Out</p>
              <p className="text-xs text-white/70">{ordinal(me.outOrder ?? 0)} out</p>
              <button type="button" onClick={onBack} className="rounded-full border border-white/30 px-3 py-1 text-xs">Bring back</button>
            </div>
          </div>
        )}

        {death && !damageOpen && (
          <div className="absolute inset-0 z-[2] grid place-items-center bg-black/75 p-3">
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="font-display text-lg font-bold">{death}</p>
              <p className="text-xs text-white/70">Is {seat.name} out?</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => onNotYet(death)} className="rounded-full border border-white/30 px-3 py-1.5 text-sm">Not yet</button>
                <button type="button" onClick={onOut} className="rounded-full bg-red-500 px-3 py-1.5 text-sm font-semibold">Out</button>
              </div>
            </div>
          </div>
        )}

        {damageOpen && <DamageSheet i={i} state={state} game={game} onChange={onChange} onOut={() => { onOut(); onCloseDamage(); }} onClose={onCloseDamage} />}
      </div>
    </section>
  );
}

/** Commander damage from each opponent, poison, and going out - for one player, on their own panel. */
function DamageSheet({ i, state, game, onChange, onOut, onClose }: {
  i: number; state: PlayState; game: api.Game; onChange: (e: GameEvent) => void; onOut: () => void; onClose: () => void;
}) {
  const me = state.seats[i];
  const rows = game.seats.map((s, from) => ({ s, from })).filter((x) => x.from !== i);
  return (
    <div className="absolute inset-0 z-[3] flex flex-col gap-1.5 overflow-y-auto bg-[#0d0c0b] p-2.5 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate font-semibold">Damage to {game.seats[i].name}</p>
        <button type="button" onClick={onClose} className="shrink-0 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold">Done</button>
      </div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(9.5rem, 1fr))' }}>
        {rows.map(({ s, from }) => (
          <Stepper
            key={from}
            label={<><span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: SEAT_COLOURS[from] }} /> <span className="truncate">{s.name}</span></>}
            value={me.cmd[from] ?? 0}
            lethal={(me.cmd[from] ?? 0) >= LETHAL_COMMANDER}
            onStep={(d) => onChange({ k: 'cmd', s: i, from, d, t: Date.now() })}
          />
        ))}
        <Stepper label={<span>☠ Poison</span>} value={me.poison} lethal={me.poison >= LETHAL_POISON} onStep={(d) => onChange({ k: 'poison', s: i, d, t: Date.now() })} />
      </div>
      <button type="button" onClick={onOut} className="mt-auto self-start rounded-full border border-red-400/50 px-3 py-1 text-xs text-red-200">Out of the game</button>
    </div>
  );
}

function Stepper({ label, value, lethal, onStep }: { label: React.ReactNode; value: number; lethal: boolean; onStep: (d: number) => void }) {
  return (
    <div className={`flex items-center gap-1 rounded-xl border px-1.5 py-1 ${lethal ? 'border-red-400/60 bg-red-500/15' : 'border-white/10 bg-white/5'}`}>
      <span className="flex min-w-0 flex-1 items-center gap-1 text-xs">{label}</span>
      <button type="button" aria-label="Less" onClick={() => onStep(-1)} disabled={value <= 0} className="h-8 w-8 rounded-lg bg-white/10 text-lg leading-none disabled:opacity-30">−</button>
      <span className="w-7 text-center font-bold tabular-nums">{value}</span>
      <button type="button" aria-label="More" onClick={() => onStep(1)} className="h-8 w-8 rounded-lg bg-white/10 text-lg leading-none">+</button>
    </div>
  );
}

function Chip({ children, tone }: { children: React.ReactNode; tone?: 'bad' }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums backdrop-blur ${tone === 'bad' ? 'bg-red-500/70' : 'bg-black/55'}`}>{children}</span>;
}

/** Half a panel: a tap is one, holding steps by ten. */
function Tapper({ label, onStep, side }: { label: string; onStep: (d: number) => void; side: string }) {
  const hold = useRef<{ timer: ReturnType<typeof setTimeout> | null; held: boolean }>({ timer: null, held: false });
  const stop = () => { if (hold.current.timer) clearTimeout(hold.current.timer); hold.current.timer = null; };
  const repeat = () => { hold.current.held = true; onStep(10); hold.current.timer = setTimeout(repeat, 700); };
  return (
    <button
      type="button"
      aria-label={label}
      className="group relative flex items-center outline-none active:bg-white/[0.06]"
      style={{ justifyContent: side === '+' ? 'flex-end' : 'flex-start' }}
      onPointerDown={() => { hold.current.held = false; stop(); hold.current.timer = setTimeout(repeat, 500); }}
      onPointerUp={() => { stop(); if (!hold.current.held) onStep(1); }}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      // A keyboard press is one tap.
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onStep(1); } }}
    >
      <span aria-hidden className="px-[8cqw] font-bold text-white/35" style={{ fontSize: 'min(14cqh, 10cqw)' }}>{side}</span>
    </button>
  );
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
