import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Optional subpath support. Unset in normal use - the Pi serves this on its
  // own tailnet port, which avoids the prefix entirely. Kept because it is the
  // only way to share a hostname, and because unsetting it later is a rebuild.
  basePath: process.env.MTG_BASE_PATH || undefined,

  // The client builds its own API URLs and basePath does not apply to fetch,
  // so the prefix has to reach the browser explicitly.
  env: {
    NEXT_PUBLIC_MTG_BASE_PATH: process.env.MTG_BASE_PATH || '',
  },

  // node-sqlite3-wasm loads a .wasm file relative to its own package path.
  // Bundling rewrites that path and the file goes missing at runtime.
  serverExternalPackages: ['node-sqlite3-wasm'],

  images: {
    remotePatterns: [
      // Scryfall serves every card image from here.
      { protocol: 'https', hostname: 'cards.scryfall.io', pathname: '/**' },
    ],
  },
};

export default nextConfig;
