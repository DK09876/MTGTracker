import type { MetadataRoute } from 'next';

/**
 * What a phone needs to keep the app on its home screen and open it full
 * screen, like an app rather than a browser tab. iOS reads the name and
 * display mode from here, and its icon from the apple-touch-icon in layout.
 */

const base = process.env.MTG_BASE_PATH || '';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'MTG Tracker',
    short_name: 'MTG',
    description: 'Search Magic cards, build Commander decks and keep lists.',
    id: `${base}/`,
    start_url: `${base}/`,
    scope: `${base}/`,
    display: 'standalone',
    background_color: '#14120f',
    theme_color: '#14120f',
    icons: [
      { src: `${base}/icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
      { src: `${base}/icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
      { src: `${base}/icons/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
