const CACHE = 'mate-louis-v2';

self.addEventListener('install', (event) => {
  // Skip pre-caching specific filenames since Vite hashes them in production.
  // Instead, use runtime caching (cache-on-fetch) strategy.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Don't cache API calls or Firebase requests
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/') ||
      url.hostname.includes('firebase') ||
      url.hostname.includes('googleapis')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
