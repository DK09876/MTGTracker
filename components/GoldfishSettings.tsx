'use client';

/**
 * How the goldfish plays, all of it the owner's to set: how many games and
 * turns, play or draw, the keep rule and mulligans, the autopilot's order,
 * and the goals it scores - including "a card tagged X in hand (or cast) by
 * turn N". Saved with the deck, with named presets.
 */

import { useState } from 'react';

import KeepRule from './KeepRule';
import Tip from './Tip';
import type { ListedCard } from '@/lib/db';
import { describeCheck, type Check, type GoldfishSettings, type PlayStep } from '@/lib/goldfish';

interface Props {
  settings: GoldfishSettings;
  presets: Array<{ name: string; settings: GoldfishSettings }>;
  cards: ListedCard[];
  cardTags: Record<string, string[]>;
  tagNames: string[];
  hasCommander: boolean;
  onChange: (settings: GoldfishSettings) => void;
  onPresets: (presets: Array<{ name: string; settings: GoldfishSettings }>) => void;
}

const select = 'rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1';
const row = 'flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--background)]/40 px-3 py-2';
const stepName = (s: PlayStep) => (s.kind === 'mana' ? 'Ramp and mana rocks' : s.kind === 'commander' ? 'The commander, as soon as it can'
  : s.kind === 'tag' ? `Cards tagged ${s.tag}` : s.kind === 'biggest' ? 'The biggest spell it can pay for' : 'The cheapest spell first');

export default function GoldfishSettings({ settings, presets, cards, cardTags, tagNames, hasCommander, onChange, onPresets }: Props) {
  const [presetName, setPresetName] = useState('');
  const [newStep, setNewStep] = useState(tagNames[0] ?? '');
  const set = (patch: Partial<GoldfishSettings>) => onChange({ ...settings, ...patch });
  const move = (i: number, by: number) => {
    const order = [...settings.order];
    const [x] = order.splice(i, 1);
    order.splice(i + by, 0, x);
    set({ order });
  };
  const setCheck = (i: number, c: Check) => set({ checks: settings.checks.map((x, j) => (j === i ? c : x)) });
  const turns = Array.from({ length: 10 }, (_, i) => i + 1);

  return (
    <div data-tour="goldfish-settings" className="flex flex-col gap-5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Preset" className={select} value="" onChange={(e) => { const p = presets.find((x) => x.name === e.target.value); if (p) onChange(p.settings); }}>
          <option value="">{presets.length ? 'Load a preset…' : 'No presets yet'}</option>
          {presets.map((p) => <option key={p.name}>{p.name}</option>)}
        </select>
        <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Preset name" aria-label="Preset name" className={`${select} w-36`} />
        <button type="button" disabled={!presetName.trim()} onClick={() => { onPresets([...presets.filter((p) => p.name !== presetName.trim()), { name: presetName.trim(), settings }]); setPresetName(''); }}
          className="rounded-full border border-[var(--border)] px-3 py-1 hover:bg-[var(--surface-hover)] disabled:opacity-50">Save as preset</button>
        {presets.length > 0 && (
          <select aria-label="Delete a preset" className={select} value="" onChange={(e) => onPresets(presets.filter((p) => p.name !== e.target.value))}>
            <option value="">Delete a preset…</option>
            {presets.map((p) => <option key={p.name}>{p.name}</option>)}
          </select>
        )}
      </div>

      <section className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">The games</h4>
        <div className={row}>
          <span>Play</span>
          <select aria-label="Games" className={select} value={settings.games} onChange={(e) => set({ games: Number(e.target.value) })}>
            {[500, 1000, 2000, 5000, 10000].map((n) => <option key={n} value={n}>{n.toLocaleString()}</option>)}
          </select>
          <span>games of</span>
          <select aria-label="Turns" className={select} value={settings.turns} onChange={(e) => set({ turns: Number(e.target.value) })}>
            {[4, 5, 6, 7, 8, 9, 10, 12].map((n) => <option key={n}>{n}</option>)}
          </select>
          <span>turns, and I</span>
          <select aria-label="Play or draw" className={select} value={settings.drawFirst ? 'draw' : 'play'} onChange={(e) => set({ drawFirst: e.target.value === 'draw' })}>
            <option value="draw">draw on turn one (multiplayer)</option><option value="play">skip the first draw</option>
          </select>
          <Tip label="About the games">More games give steadier numbers; 2,000 is enough to see a change of a couple of points. In multiplayer Commander nobody skips the first draw.</Tip>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Mulligans</h4>
        <div className={row}>
          <KeepRule rule={settings.keep} cards={cards} cardTags={cardTags} tagNames={tagNames} mulligans={settings.maxMulligans} onChange={(keep) => set({ keep })} />
        </div>
        <div className={row}>
          <span>Mulligan at most</span>
          <select aria-label="Most mulligans" className={select} value={settings.maxMulligans} onChange={(e) => set({ maxMulligans: Number(e.target.value) })}>
            {[0, 1, 2, 3, 4].map((n) => <option key={n}>{n}</option>)}
          </select>
          <span>times; the first is</span>
          <select aria-label="First mulligan" className={select} value={settings.freeFirst ? 'free' : 'paid'} onChange={(e) => set({ freeFirst: e.target.value === 'free' })}>
            <option value="free">free</option><option value="paid">not free</option>
          </select>
          <span>; put back</span>
          <select aria-label="What goes to the bottom" className={select} value={settings.bottom} onChange={(e) => set({ bottom: e.target.value as GoldfishSettings['bottom'] })}>
            <option value="expensive">the most expensive spells</option><option value="lands">extra lands first</option>
          </select>
          <Tip label="About mulligans">London mulligan: draw a fresh seven, then put a card on the bottom for each mulligan. In multiplayer Commander the first one usually costs nothing.</Tip>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          What it plays first <Tip label="About the play order">Each turn it plays a land, then casts what it can pay for, in this order - the first step a card fits decides its place. Put your engine&apos;s tag above the biggest spell to see how fast it comes online.</Tip>
        </h4>
        <ol className="flex flex-col gap-1.5">
          {settings.order.map((s, i) => (
            <li key={`${s.kind}-${i}`} className={row}>
              <span className="w-5 tabular-nums text-[var(--muted)]">{i + 1}</span>
              <span className="min-w-0 flex-1">{stepName(s)}</span>
              <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="rounded border border-[var(--border)] px-2 disabled:opacity-30">↑</button>
              <button type="button" aria-label="Move down" disabled={i === settings.order.length - 1} onClick={() => move(i, 1)} className="rounded border border-[var(--border)] px-2 disabled:opacity-30">↓</button>
              {settings.order.length > 1 && <button type="button" aria-label="Remove this step" onClick={() => set({ order: settings.order.filter((_, j) => j !== i) })} className="text-[var(--muted)] hover:text-red-400">×</button>}
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Tag to add to the order" className={select} value={newStep} onChange={(e) => setNewStep(e.target.value)}>
            {tagNames.map((t) => <option key={t}>{t}</option>)}
          </select>
          <button type="button" disabled={!newStep} onClick={() => set({ order: [...settings.order.slice(0, -1), { kind: 'tag', tag: newStep }, ...settings.order.slice(-1)] })}
            className="rounded-full border border-[var(--border)] px-3 py-1 hover:bg-[var(--surface-hover)] disabled:opacity-50">＋ Cast cards with this tag early</button>
          {!settings.order.some((s) => s.kind === 'commander') && hasCommander && (
            <button type="button" onClick={() => set({ order: [{ kind: 'commander' }, ...settings.order] })} className="rounded-full border border-[var(--border)] px-3 py-1">＋ The commander</button>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          Goals and cards by turn <Tip label="About goals">Each one is checked in every game and gets its own share. Tick &quot;good start&quot; on the ones that matter most: the results show how often a game hits all of those, and Best hand looks for the seven that hits them most.</Tip>
        </h4>
        {settings.checks.map((c, i) => (
          <div key={i} className={row}>
            {c.kind === 'commander' ? (
              <>Commander out by turn <select aria-label="Turn" className={select} value={c.turn} onChange={(e) => setCheck(i, { ...c, turn: Number(e.target.value) })}>{turns.map((t) => <option key={t}>{t}</option>)}</select></>
            ) : c.kind === 'mana' ? (
              <>At least <select aria-label="Mana" className={select} value={c.amount} onChange={(e) => setCheck(i, { ...c, amount: Number(e.target.value) })}>{turns.map((t) => <option key={t}>{t}</option>)}</select>
                mana on turn <select aria-label="Turn" className={select} value={c.turn} onChange={(e) => setCheck(i, { ...c, turn: Number(e.target.value) })}>{turns.map((t) => <option key={t}>{t}</option>)}</select></>
            ) : (
              <>A card tagged <select aria-label="Tag" className={select} value={c.tag ?? ''} onChange={(e) => setCheck(i, { ...c, tag: e.target.value, name: undefined })}>{[...new Set([c.tag ?? '', ...tagNames])].filter(Boolean).map((t) => <option key={t}>{t}</option>)}</select>
                <select aria-label="In hand or cast" className={select} value={c.how} onChange={(e) => setCheck(i, { ...c, how: e.target.value as 'hand' | 'cast' })}><option value="hand">in hand</option><option value="cast">cast</option></select>
                by turn <select aria-label="Turn" className={select} value={c.turn} onChange={(e) => setCheck(i, { ...c, turn: Number(e.target.value) })}>{turns.map((t) => <option key={t}>{t}</option>)}</select></>
            )}
            <label className="ml-auto flex items-center gap-1.5 text-xs"><input type="checkbox" checked={!!c.good} onChange={(e) => setCheck(i, { ...c, good: e.target.checked })} /> good start</label>
            <button type="button" aria-label={`Remove: ${describeCheck(c)}`} onClick={() => set({ checks: settings.checks.filter((_, j) => j !== i) })} className="text-[var(--muted)] hover:text-red-400">×</button>
          </div>
        ))}
        {settings.checks.length < 8 && (
          <div className="flex flex-wrap gap-2">
            {hasCommander && <button type="button" onClick={() => set({ checks: [...settings.checks, { kind: 'commander', turn: 5, good: true }] })} className="rounded-full border border-[var(--border)] px-3 py-1 hover:bg-[var(--surface-hover)]">＋ Commander by a turn</button>}
            <button type="button" onClick={() => set({ checks: [...settings.checks, { kind: 'mana', amount: 5, turn: 5 }] })} className="rounded-full border border-[var(--border)] px-3 py-1 hover:bg-[var(--surface-hover)]">＋ Mana by a turn</button>
            {tagNames.length > 0 && <button type="button" onClick={() => set({ checks: [...settings.checks, { kind: 'card', tag: tagNames[0], how: 'hand', turn: 3 }] })} className="rounded-full border border-[var(--border)] px-3 py-1 hover:bg-[var(--surface-hover)]">＋ A tagged card by a turn</button>}
          </div>
        )}
      </section>
    </div>
  );
}
