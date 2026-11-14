/**
 * Looking up a card name Chat marked that the app couldn't find (handoff 10,
 * item 39): newer than the last weekly refresh, or misspelt. Only when the
 * owner hovers or taps the name; one lookup per name per page view (a second
 * hover waits on the first, or reads its answer); a failed one can be retried.
 * Pure: the page passes the lookup (the app's own card search by exact name).
 */

export type LookupState<T> = { status: 'idle' } | { status: 'loading' } | { status: 'found'; card: T } | { status: 'missing' };

export function cardLookup<T>(find: (name: string) => Promise<T | null>) {
  const known = new Map<string, LookupState<T>>();
  const pending = new Map<string, Promise<LookupState<T>>>();
  const key = (n: string) => n.split(' // ')[0].trim().toLowerCase();
  return {
    state: (name: string): LookupState<T> => known.get(key(name)) ?? { status: 'idle' },
    /** Look the name up, once: a found or a running lookup is reused; `retry` asks again after a miss. */
    look(name: string, retry = false): Promise<LookupState<T>> {
      const k = key(name);
      const had = known.get(k);
      if (had?.status === 'found' || (had?.status === 'missing' && !retry)) return Promise.resolve(had);
      const running = pending.get(k);
      if (running) return running;
      known.set(k, { status: 'loading' });
      const p = find(name).then((card): LookupState<T> => (card ? { status: 'found', card } : { status: 'missing' }), (): LookupState<T> => ({ status: 'missing' }))
        .then((s) => { known.set(k, s); pending.delete(k); return s; });
      pending.set(k, p);
      return p;
    },
  };
}

/** The search for one exact name, in the card search's syntax. */
export const exactName = (name: string) => `!"${name.replace(/"/g, '').trim()}"`;
