/* Gramını Büyüt — service worker (app shell cache, çevrimdışı çalışma) */

const CACHE_NAME = 'gramini-buyut-v47';

// data/market.json kasıtlı olarak APP_SHELL'de değil ve fetch ile yakalanmaz.
const APP_SHELL = [
  './',
  './index.html',
  './styles.css?v=39',
  './inspiration-cards.js?v=2',
  './app.js?v=41',
  './manifest.webmanifest',
  './favicon.ico',
  './icons/favicon.ico',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable.png',
  './icons/apple-touch-icon.png',
];

function isMarketJsonRequest(url) {
  return url.pathname.endsWith('/data/market.json');
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // market.json: SW bypass — tarayıcı doğrudan ağdan okur, cache'e yazılmaz.
  if (isMarketJsonRequest(url)) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html')))
  );
});
