// sw.js - PWA service worker for AVA
// Immediate activation, pre-caching core assets, and offline-first fetch

const CACHE_NAME = 'ava-cache-v2';
// Add screenshots and fallback audio for a better offline experience
const FILES_TO_CACHE = [
  '/',
  '/static/manifest.json',
  '/static/script.js',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512-maskable.png',
  '/static/screenshot-wide.png',
  '/static/screenshot-normal.png',
  '/static/fallback.mp3' // Cache the fallback audio
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(FILES_TO_CACHE))
  );
  // Activate immediately after installation
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))
    )
  );
  // Take control of all open pages
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});