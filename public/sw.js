/* JARVIS service worker.
 * Strategy: precache the shell, then network-first for navigations (so a deploy is
 * picked up) and stale-while-revalidate for hashed build assets.
 * Deliberately never caches model or tool API responses - those are live data, and
 * serving a stale one would be a fabricated result.
 */
const VERSION = 'jarvis-v1';
const SHELL = `${VERSION}-shell`;
const RUNTIME = `${VERSION}-runtime`;
const PRECACHE = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];

const NEVER_CACHE = [
  'api.groq.com', 'api.openai.com', 'api.anthropic.com', 'openrouter.ai',
  'generativelanguage.googleapis.com', 'text.pollinations.ai', 'api.duckduckgo.com',
  'en.wikipedia.org', 'api.open-meteo.com', 'geocoding-api.open-meteo.com', '.supabase.co',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (NEVER_CACHE.some((h) => url.hostname.includes(h))) return;
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || new Response('Offline', { status: 503 }))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(RUNTIME).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
