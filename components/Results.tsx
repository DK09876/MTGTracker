'use client';

/**
 * The answer to a search, as views.
 *
 * With a commander named there are three, as tabs, each answering its own
 * question:
 *
 *   Played in <commander> decks   what its decks actually run (EDHREC)
 *   All matching cards            everything that fits (Scryfall)
 *   Combos                        what goes infinite (Commander Spellbook)
 *
 * Without one there is only the view the search was for.
 */

import CardTile from './CardTile';
import ComboList from './ComboList';
import type { CardStats } from '@/lib/edhrec';
import type { EdhrecView } from '@/lib/interpret';
import type { ScryfallCard } from '@/lib/scryfall';
import { parseSortKey, SORT_OPTIONS, sortKey, sortLabel, type Sort } from '@/lib/sort';
import type { Combo } from '@/lib/spellbook';

export type Tab = 'edhrec' | 'cards' | 'combos';

/** What the page has for each view; undefined means not loaded yet. */
export interface Views {
  cards?: { cards: ScryfallCard[]; total: number; stats?: Record<string, CardStats>; sort?: Sort };
  /** null: EDHREC has nothing for this commander. */
  edhrec?: EdhrecView | null;
  combos?: { combos: Combo[]; cards: ScryfallCard[]; note?: string };
}

interface Props {
  views: Views;
  /** Set when the search named a commander, which is what brings the tabs. */
  commander?: string;
  tab: Tab;
  onTab: (tab: Tab) => void;
  loading: boolean;
  inLists: Record<string, string[]>;
  onSort: (sort: Sort) => void;
  onSelect: (card: ScryfallCard) => void;
  onAdd: (card: ScryfallCard) => void;
}

const short = (name: string) => name.split(',')[0];

export default function Results({ views, commander, tab, onTab, loading, inLists, onSort, onSelect, onAdd }: Props) {
  const grid = { inLists, onSelect, onAdd };

  const tabs: Array<{ id: Tab; label: string; count?: number }> = commander
    ? [
      { id: 'edhrec', label: `Played in ${short(commander)} decks`, count: views.edhrec?.cards.length },
      { id: 'cards', label: 'All matching cards', count: views.cards?.total },
      { id: 'combos', label: 'Combos', count: views.combos?.combos.length },
    ]
    : [];

  return (
    <div className="mt-6">
      {tabs.length > 0 && (
        <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-[var(--border)]">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => onTab(t.id)}
              className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
                tab === t.id
                  ? 'border-[var(--accent)] text-[var(--foreground)]'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--foreground)]'
              }`}
            >
              {t.label}
              {t.count !== undefined && <span className="ml-1.5 text-xs text-[var(--muted)]">{t.count.toLocaleString()}</span>}
            </button>
          ))}
        </div>
      )}

      {loading && <p className="mt-8 text-center text-[var(--muted)]">Loading…</p>}

      {!loading && tab === 'edhrec' && (
        views.edhrec
          ? <EdhrecTab view={views.edhrec} {...grid} />
          : <p className="mt-8 text-center text-[var(--muted)]">
            EDHREC has no data for {commander ?? 'this commander'} yet — try <button className="underline" onClick={() => onTab('cards')}>All matching cards</button>.
          </p>
      )}

      {!loading && tab === 'cards' && views.cards && (
        views.cards.cards.length
          ? (
            <>
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[var(--muted)]">
                <p className="min-w-0 flex-1">
                  {views.cards.total.toLocaleString()} match{views.cards.total === 1 ? '' : 'es'}
                  {views.cards.cards.length < views.cards.total && <> · showing the first {views.cards.cards.length}</>}
                </p>
                {views.cards.sort && <SortMenu sort={views.cards.sort} onChange={onSort} />}
              </div>
              <CardGrid cards={views.cards.cards} stats={views.cards.stats} commander={commander} {...grid} />
            </>
          )
          : <p className="mt-8 text-center text-[var(--muted)]">No cards matched that search.</p>
      )}

      {!loading && tab === 'combos' && views.combos && (
        views.combos.combos.length
          ? <ComboList combos={views.combos.combos} cards={views.combos.cards} anchor={anchorOf(views.combos.combos)} {...grid} />
          : <p className="mt-8 text-center text-[var(--muted)]">{views.combos.note ?? 'No combos found.'}</p>
      )}
    </div>
  );
}

function EdhrecTab({ view, inLists, onSelect, onAdd }: { view: EdhrecView } & Pick<Props, 'inLists' | 'onSelect' | 'onAdd'>) {
  const byId = new Map(view.cards.map((c) => [c.id, c]));
  return (
    <div>
      <p className="mt-4 text-sm text-[var(--muted)]">
        What {view.decks.toLocaleString()} {short(view.commander)} decks on EDHREC play
        {view.filtered ? ', narrowed to your search' : ''}.{' '}
        <a href={view.url} target="_blank" rel="noreferrer" className="underline hover:text-[var(--foreground)]">EDHREC ↗</a>
      </p>
      {view.cards.length === 0 && (
        <p className="mt-8 text-center text-[var(--muted)]">
          None of the cards {short(view.commander)} decks play match this search — see All matching cards.
        </p>
      )}
      {view.sections.map((section) => (
        <section key={section.header} className="mt-6">
          {(view.sections.length > 1) && <h3 className="mb-2 font-medium">{section.header}</h3>}
          <CardGrid
            cards={section.ids.map((id) => byId.get(id)).filter((c): c is ScryfallCard => !!c)}
            stats={view.stats}
            commander={view.commander}
            inLists={inLists}
            onSelect={onSelect}
            onAdd={onAdd}
          />
        </section>
      ))}
    </div>
  );
}

function CardGrid({ cards, stats, commander, inLists, onSelect, onAdd }: {
  cards: ScryfallCard[];
  stats?: Record<string, CardStats>;
  commander?: string;
} & Pick<Props, 'inLists' | 'onSelect' | 'onAdd'>) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {cards.map((card) => {
        const s = stats?.[card.id];
        return (
          <CardTile
            key={card.id}
            card={card}
            inLists={inLists[card.id]}
            onSelect={onSelect}
            onAdd={onAdd}
            footer={s && commander && (
              <p className="text-xs text-[var(--muted)]">
                In {Math.round(s.inclusion * 100)}% of {short(commander)} decks
              </p>
            )}
          />
        );
      })}
    </div>
  );
}

/**
 * The order results are in. Changing it re-runs the search with Scryfall
 * sorting, because only the first page is on screen.
 */
function SortMenu({ sort, onChange }: { sort: Sort; onChange: (sort: Sort) => void }) {
  const options = SORT_OPTIONS.map((o) => ({ sort: o as Sort, label: o.label }));
  // An order typed as syntax that the menu does not list still shows.
  if (!options.some((o) => sortKey(o.sort) === sortKey(sort))) options.push({ sort, label: sortLabel(sort) });

  return (
    <label className="flex items-center gap-2">
      <span>Sort</span>
      <select
        value={sortKey(sort)}
        onChange={(e) => { const next = parseSortKey(e.target.value); if (next) onChange(next); }}
        className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
      >
        {options.map((o) => (
          <option key={sortKey(o.sort)} value={sortKey(o.sort)}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

/** The one card every combo shares, if there is one - the commander or the card asked about. */
function anchorOf(combos: Combo[]): string | undefined {
  const [first, ...rest] = combos;
  return first?.cards.find((name) => rest.every((c) => c.cards.includes(name)));
}
