/* Gramını Büyüt — service worker (app shell cache, çevrimdışı çalışma) */

const CACHE_NAME = 'gramini-buyut-v29';

// data/market.json kasıtlı olarak APP_SHELL'de değil.
// Fiyat dosyası network-first ile mümkün olduğunca güncel kalır; offline'da son cache kullanılır.
const APP_SHELL = [
  './',
  './index.html',
  './styles.css?v=24',
  './app.js?v=28',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable.png',
  './icons/apple-touch-icon.png',
];

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

// Sadece aynı-origin GET istekleri: network-first.
// Çevrimiçiyken her zaman güncel kod ve market.json; çevrimdışıyken cache fallback.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

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
