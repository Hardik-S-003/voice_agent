// sw.js - PWA service worker for AVA
// Network-first for HTML and JS to prevent stale reloads, with safe precache of static assets

const CACHE_NAME = 'ava-cache-v3';

// Keep only non-code, static assets in precache
const FILES_TO_CACHE = [
  '/static/manifest.json',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512-maskable.png',
  '/static/screenshot-wide.png',
  '/static/screenshot-normal.png',
  '/static/fallback.mp3'
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

// Helper: network-first strategy
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
    return response;
  } catch (_) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw _;
  }
}

// Helper: stale-while-revalidate strategy
async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const fetchPromise = fetch(request)
    .then(async (response) => {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return cached || fetchPromise;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Network-first for top-level navigations (HTML)
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  // Network-first for JS and CSS to always pick up new code on normal reloads
  if (['script', 'style'].includes(request.destination)) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Stale-while-revalidate for other static assets (images, audio, icons, etc.)
  event.respondWith(staleWhileRevalidate(request));
});