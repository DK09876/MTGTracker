'use client';

/** The update banner's store (lib/reach.ts) as a React hook. */

import { useSyncExternalStore } from 'react';

import { onReach, reachState, type ReachState } from './reach';

const SERVER: ReachState = { down: false, updating: false, newer: false };

export const useReach = () => useSyncExternalStore(onReach, reachState, () => SERVER);

/** While the app is updating (a deploy waits for jobs, or the server is stopped), buttons that start new work are greyed out. */
export function useUpdating(): boolean {
  const r = useReach();
  return r.updating || r.down;
}

export const UPDATING_TITLE = 'The app is updating. This comes back in a moment.';
