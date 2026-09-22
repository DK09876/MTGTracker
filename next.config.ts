import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Served from a subpath on the Pi's tailnet hostname, alongside LifeOS at
  // the root. Set at build time so links and assets carry the prefix; unset
  // in development so localhost:3001 works without it.
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
