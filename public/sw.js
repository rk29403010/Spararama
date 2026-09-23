const BUILD_ID = '__SPARARAMA_BUILD_ID__';
const SHELL_CACHE = `spararama-shell-${BUILD_ID}`;
const CACHE_PREFIX = 'spararama-shell-';
const CORE_ASSETS = [
  '/manifest.webmanifest',
  '/spararama-icon.svg',
  '/spararama-icon-192.png',
  '/spararama-icon-512.png',
  '/spararama-maskable-512.png',
  '/spararama-apple-touch-icon.png'
];

function isCacheable(response) {
  return response.ok
    && response.type === 'basic'
    && !String(response.headers.get('Cache-Control') || '').toLowerCase().includes('no-store');
}

async function primeAppShell() {
  const cache = await caches.open(SHELL_CACHE);
  const shellResponse = await fetch(new Request('/', { cache: 'reload' }));
  if (!isCacheable(shellResponse)) throw new Error('Spararama app shell was not cacheable.');

  const html = await shellResponse.clone().text();
  await cache.put('/', shellResponse);

  const linkedAssets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map(match => new URL(match[1], self.location.origin))
    .filter(url => url.origin === self.location.origin && !url.pathname.startsWith('/api/'))
    .map(url => `${url.pathname}${url.search}`);
  await cache.addAll([...new Set([...CORE_ASSETS, ...linkedAssets])]);
}

self.addEventListener('install', event => {
  event.waitUntil(primeAppShell());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key.startsWith(CACHE_PREFIX) && key !== SHELL_CACHE)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('range')) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (isCacheable(response)) {
            event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.put('/', response.clone())));
          }
          return response;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      const refreshed = fetch(request).then(response => {
        if (isCacheable(response)) {
          event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.put(request, response.clone())));
        }
        return response;
      });
      return cached || refreshed;
    })
  );
});