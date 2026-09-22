const CACHE_VERSION = 'spararama-shell-v1';
const SHELL_CACHE = CACHE_VERSION;
const APP_SHELL = ['/', '/manifest.webmanifest', '/spararama-icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== SHELL_CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.put('/', copy)));
          }
          return response;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (!response.ok || response.type !== 'basic') return response;
        const copy = response.clone();
        event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.put(request, copy)));
        return response;
      });
    })
  );
});
