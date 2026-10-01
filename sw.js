/*
 * Vanguard 25K Desk - service worker.
 *
 * - Navigations: network-first, cache fallback (updates arrive when online,
 *   the page still opens offline).
 * - Same-origin GET assets inside this site's scope: stale-while-revalidate.
 * - Cross-origin requests (api.github.com, fonts.googleapis.com,
 *   fonts.gstatic.com, ...) are never intercepted or cached.
 *
 * Bump CACHE when the precache list changes; old "vdesk-" caches are removed
 * on activate. Caches on *.github.io are shared by every project on the same
 * user site, so only caches with our own prefix are ever deleted.
 */
'use strict';

const CACHE_PREFIX = 'vdesk-';
const CACHE = CACHE_PREFIX + '202610012216';

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './maskable-512.png',
  './apple-touch-icon.png',
  './favicon-32.png',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // Add one by one so a single missing file cannot fail the whole install;
      // 'reload' bypasses the HTTP cache so we store the freshly deployed copy.
      Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined)
        )
      )
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Cross-origin: do not call respondWith, the browser goes straight to the network.
  if (url.origin !== self.location.origin) return;
  // Same origin but outside this site (e.g. another repo on the same github.io host).
  if (!req.url.startsWith(self.registration.scope)) return;
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req));
    return;
  }

  // Assets: explicit opt-outs (fetch(url, {cache: 'no-store'})) and
  // partial-content requests go straight to the network.
  if (req.cache === 'no-store' || req.cache === 'reload' || req.headers.has('range')) return;
  event.respondWith(staleWhileRevalidate(event, req));
});

function isCacheable(res) {
  return res && res.ok && res.type === 'basic' && !res.redirected;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (isCacheable(res)) {
      try { await cache.put(req, res.clone()); } catch (_) { /* quota etc. */ }
    }
    return res;
  } catch (err) {
    const cached =
      (await cache.match(req, { ignoreSearch: true })) ||
      (await cache.match('./')) ||
      (await cache.match('./index.html'));
    if (cached) return cached;
    return new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>Offline</title><body style="font:16px system-ui;background:#0c1117;color:#e6edf3;padding:24px">' +
        '<p>You are offline and this page has not been cached yet. Reconnect and reload.</p></body>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

async function staleWhileRevalidate(event, req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then(async (res) => {
      if (isCacheable(res)) {
        try { await cache.put(req, res.clone()); } catch (_) { /* quota etc. */ }
      }
      return res;
    })
    .catch(() => undefined);

  if (cached) {
    event.waitUntil(network); // keep the worker alive until the refresh is stored
    return cached;
  }
  const res = await network;
  return res || Response.error();
}
