'use client';

/**
 * The rules the cut list adds up, for this deck: switch one off, change how
 * much it counts, or write your own ("tagged Discard outlet: never cut").
 * Shown inside Tune → Cuts, under "The rules behind it".
 */

import { useState } from 'react';

import Tip from './Tip';
import * as api from '@/lib/api';
import { CUT_RULES, describeCustom, RULE_GROUPS, type CustomRule, type CutSettings } from '@/lib/cut-rules';

export default CutRules;

function CutRules({ listId, settings, tagNames, onSaved }: { listId: string; settings: CutSettings; tagNames: string[]; onSaved: () => void }) {
  const [draft, setDraft] = useState<CutSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<CustomRule>({ when: 'tag', value: tagNames[0] ?? '', then: 'protect' });

  const save = async (next: CutSettings) => {
    setDraft(next);
    setSaving(true);
    setError(null);
    try {
      setDraft((await api.saveCutSettings(listId, next)).settings);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the rules');
    } finally {
      setSaving(false);
    }
  };
  const setRule = (id: string, change: { on?: boolean; weight?: number }) => save({ ...draft, rules: { ...draft.rules, [id]: { ...draft.rules[id], ...change } } });

  return (
    <div data-tour="cut-rules" className="flex flex-col gap-4">
      <p className="max-w-3xl text-sm text-[var(--muted)]">
        The cut list is these rules added up. Switch one off, change how much it counts, or write your own. Saved for this deck.
        {saving && <span className="ml-2">Saving…</span>}
      </p>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {RULE_GROUPS.map((group) => (
        <section key={group} className="flex flex-col gap-1.5">
          <h4 data-section={group} className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{group}</h4>
          {CUT_RULES.filter((r) => r.group === group).map((r) => {
            const mine = draft.rules[r.id] ?? {};
            const on = mine.on ?? !r.offByDefault;
            const toggleOnly = r.protects || r.weight === 0;
            const weight = mine.weight ?? r.weight;
            return (
              <div key={r.id} className={`flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm ${on ? '' : 'opacity-60'}`}>
                <input type="checkbox" checked={on} onChange={(e) => setRule(r.id, { on: e.target.checked })} aria-label={`Use: ${r.label}`} />
                <span className="min-w-0 flex-[1_1_16rem]">
                  {r.label} <Tip label={`Why: ${r.label}`}>{r.why}</Tip>
                  <span className={`ml-2 text-xs ${r.toward === 'cut' && !toggleOnly ? 'text-[#ffb4a8]' : 'text-[#9fe0ad]'}`}>{r.protects ? 'never cut' : toggleOnly ? (on ? 'on' : 'off') : r.toward === 'cut' ? 'toward cutting' : 'toward keeping'}</span>
                </span>
                {!toggleOnly && (
                  <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
                    <input type="range" min={0} max={3} step={0.1} value={weight} disabled={!on} aria-label={`How much it counts: ${r.label}`}
                      onChange={(e) => setDraft({ ...draft, rules: { ...draft.rules, [r.id]: { ...mine, weight: Number(e.target.value) } } })}
                      onPointerUp={(e) => setRule(r.id, { weight: Number((e.target as HTMLInputElement).value) })}
                      onKeyUp={(e) => setRule(r.id, { weight: Number((e.target as HTMLInputElement).value) })} />
                    <span className="w-7 tabular-nums">{weight.toFixed(1)}</span>
                    {mine.weight !== undefined && mine.weight !== r.weight && <button onClick={() => setRule(r.id, { weight: r.weight })} className="text-[var(--accent)] hover:underline">reset</button>}
                  </label>
                )}
              </div>
            );
          })}
        </section>
      ))}

      <section className="flex flex-col gap-2">
        <h4 data-section="Your rules" className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Your rules</h4>
        {draft.custom.length === 0 && <p className="text-sm text-[var(--muted)]">None yet.</p>}
        {draft.custom.map((c, i) => (
          <div key={i} className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
            <span className="min-w-0 flex-1">{describeCustom(c).replace(/^Your rule: /, '')}</span>
            <button onClick={() => save({ ...draft, custom: draft.custom.filter((_, j) => j !== i) })} aria-label="Remove this rule" className="text-[var(--muted)] hover:text-red-400">×</button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-[var(--border)] px-3 py-2 text-sm">
          <span>When a card is</span>
          <select aria-label="Kind of rule" value={adding.when} onChange={(e) => setAdding({ ...adding, when: e.target.value as CustomRule['when'], value: e.target.value === 'tag' ? tagNames[0] ?? '' : '' })} className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1">
            <option value="tag">tagged</option><option value="role">in the role</option><option value="card">the card</option>
            <option value="mv-at-least">mana value at least</option><option value="mv-at-most">mana value at most</option>
          </select>
          {adding.when === 'tag' && tagNames.length ? (
            <select aria-label="Tag" value={adding.value} onChange={(e) => setAdding({ ...adding, value: e.target.value })} className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1">
              {tagNames.map((t) => <option key={t}>{t}</option>)}
            </select>
          ) : (
            <input aria-label="Value" value={adding.value} onChange={(e) => setAdding({ ...adding, value: e.target.value })}
              placeholder={adding.when === 'role' ? 'e.g. ramp' : adding.when === 'card' ? 'card name' : adding.when.startsWith('mv') ? '5' : 'tag name'}
              className="w-40 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1" />
          )}
          <span>→</span>
          <select aria-label="What happens" value={String(adding.then)} onChange={(e) => setAdding({ ...adding, then: e.target.value === 'protect' ? 'protect' : Number(e.target.value) })} className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1">
            <option value="protect">never cut it</option><option value="-1">much less likely to cut (−1)</option><option value="-0.5">less likely (−0.5)</option>
            <option value="0.5">more likely (+0.5)</option><option value="1">much more likely (+1)</option>
          </select>
          <button onClick={() => { if (adding.value.trim()) void save({ ...draft, custom: [...draft.custom, adding] }); }} disabled={!adding.value.trim()} className="rounded-full border border-[var(--border)] px-3 py-1 hover:bg-[var(--surface-hover)] disabled:opacity-50">Add</button>
        </div>
      </section>
      <div><button onClick={() => save({ rules: {}, custom: [] })} className="rounded-full border border-[var(--border)] px-4 py-1.5 text-sm hover:bg-[var(--surface-hover)]">Reset to defaults</button></div>
    </div>
  );
}

// --- Claude's review --------------------------------------------------------------

