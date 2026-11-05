'use client';

/**
 * Where the app's top bar ends, for anything that sticks just under it.
 * Measured from the bar itself (its height changes with the notch and the
 * screen), again when the window resizes.
 */

import { useSyncExternalStore } from 'react';

const read = () => Math.round(document.querySelector('body header')?.getBoundingClientRect().bottom ?? 57);

function subscribe(on: () => void) {
  window.addEventListener('resize', on);
  return () => window.removeEventListener('resize', on);
}

export function useNavBottom(): number {
  return useSyncExternalStore(subscribe, read, () => 57);
}
