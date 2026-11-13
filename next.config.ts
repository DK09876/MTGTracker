import { execSync } from 'child_process';

import type { NextConfig } from 'next';

/**
 * This build's id (handoff 9, Part B): the commit, so an open tab can tell the
 * server now runs a newer version and offer a refresh. MTG_BUILD_ID wins (the
 * deploy script sets it); outside a git checkout, the time of the build.
 */
const BUILD = process.env.MTG_BUILD_ID || (() => {
  try { return execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return `t${Date.now()}`; }
})();

const nextConfig: NextConfig = {
  // Optional subpath support. Unset in normal use - the Pi serves this on its
  // own tailnet port, which avoids the prefix entirely. Kept because it is the
  // only way to share a hostname, and because unsetting it later is a rebuild.
  basePath: process.env.MTG_BASE_PATH || undefined,

  // The client builds its own API URLs and basePath does not apply to fetch,
  // so the prefix has to reach the browser explicitly.
  env: {
    NEXT_PUBLIC_MTG_BASE_PATH: process.env.MTG_BASE_PATH || '',
    NEXT_PUBLIC_MTG_BUILD: BUILD,
  },
  generateBuildId: async () => BUILD,

  // Every answer from the app's API says it is the app's, and which build: a 502, 503 or 504 without the mark
  // came from in front of the app (it is stopped for a deploy), and a new build id means a new version is out.
  async headers() {
    return [{ source: '/api/:path*', headers: [{ key: 'x-mtg', value: '1' }, { key: 'x-mtg-build', value: BUILD }] }];
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
