/*
 * The app's service worker, and all it does: when a page cannot load - the
 * phone is offline, or Tailscale is off - show a page that says so with a
 * "Try again" button, rather than Safari's error, which a home-screen app has
 * no way out of. Nothing else is cached: decks and search always come fresh
 * from the server, so an update is never hidden behind an old copy.
 */

const CACHE = 'mtg-offline-v1';
const OFFLINE = new URL('offline.html', self.registration.scope).href;
const ICON = new URL('icons/apple-touch-icon.png', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([OFFLINE, ICON])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE)));
  } else if (request.url === ICON) {
    event.respondWith(fetch(request).catch(() => caches.match(ICON)));
  }
});
