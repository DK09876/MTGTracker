'use client';

/**
 * Registers public/sw.js, which shows an offline page when the server cannot
 * be reached (see there). Production only: in development it would get in
 * the way of reloading.
 */

import { useEffect } from 'react';

export default function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    const base = process.env.NEXT_PUBLIC_MTG_BASE_PATH || '';
    navigator.serviceWorker.register(`${base}/sw.js`, { scope: `${base}/` }).catch(() => {
      /* without it the app still works; only the offline page is missing */
    });
  }, []);
  return null;
}
